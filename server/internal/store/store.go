package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure Go SQLite driver (no cgo -> easy cross compile)
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

// Store wraps the SQLite database.
//
// Schema notes:
//   - records is the sync source of truth: one row per (user, entity, id),
//     with a per-user monotonically increasing rev assigned on every write.
//   - records_fts is a standalone FTS5 table mirroring record text content;
//     it is maintained inside the same transaction as records.
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the database at path and runs migrations.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// Exactly one connection: SQLite has a single writer anyway, and
	// serializing connections avoids SQLITE_BUSY on the deferred read-then-
	// write transactions used by the LWW conflict check. WAL still lets the
	// OS serve concurrent readers at the filesystem level if this ever grows.
	// All query paths release their rows before issuing the next statement,
	// so a single connection can never self-deadlock.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(time.Hour)

	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// DB exposes the raw handle for tests.
func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) migrate(ctx context.Context) error {
	schema := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id         TEXT PRIMARY KEY,
			name       TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			rev_seq    INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS devices (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name       TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id)`,
		`CREATE TABLE IF NOT EXISTS tokens (
			hash       TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			revoked    INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id)`,
		`CREATE TABLE IF NOT EXISTS invites (
			code_hash  TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			used_at    INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS records (
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			entity     TEXT NOT NULL,
			id         TEXT NOT NULL,
			device_id  TEXT NOT NULL DEFAULT '',
			rev        INTEGER NOT NULL,
			deleted    INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			payload    TEXT NOT NULL DEFAULT '',
			server_at  INTEGER NOT NULL,
			PRIMARY KEY (user_id, entity, id)
		)`,
		`CREATE INDEX IF NOT EXISTS records_user_rev ON records(user_id, rev)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
			entity UNINDEXED,
			user_id UNINDEXED,
			record_id UNINDEXED,
			body,
			tokenize = 'unicode61 remove_diacritics 2'
		)`,
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback()
	for _, stmt := range schema {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migration statement %q: %w", stmt, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	// Additive migrations: SQLite has no "ADD COLUMN IF NOT EXISTS", so each
	// one is attempted outside the schema transaction and a duplicate column
	// error is the expected result of running it against a database that
	// already has it.
	for _, stmt := range []string{
		// When a device token was last seen, for the console's device list.
		`ALTER TABLE tokens ADD COLUMN last_used INTEGER NOT NULL DEFAULT 0`,
	} {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			if strings.Contains(err.Error(), "duplicate column name") {
				continue
			}
			return fmt.Errorf("migration %q: %w", stmt, err)
		}
	}
	return nil
}

func nowMS() int64 { return time.Now().UnixMilli() }
