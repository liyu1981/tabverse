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
		// --- accounts (adr/0012) ---
		// One row per external login (github, google, a self hosted OIDC
		// server) attached to a sync account. A person may have several.
		`CREATE TABLE IF NOT EXISTS identities (
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			provider   TEXT NOT NULL,
			subject    TEXT NOT NULL,
			email      TEXT,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (provider, subject)
		)`,
		`CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id)`,
		// Verification and reset links. Only the hash is stored, and
		// used_at makes a link single use.
		`CREATE TABLE IF NOT EXISTS email_tokens (
			purpose    TEXT NOT NULL,
			token_hash TEXT NOT NULL,
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			used_at    INTEGER
		)`,
		`CREATE INDEX IF NOT EXISTS email_tokens_hash ON email_tokens(purpose, token_hash)`,
		// Redeemed sign-in links, so "works once" survives a restart and holds
		// across replicas (ADR 0021).
		//
		// Its own table rather than email_tokens: that one has a NOT NULL
		// foreign key to users, and a link is redeemed *before* the session
		// resolves to an account - at redemption time all there is is a hash.
		`CREATE TABLE IF NOT EXISTS verif_tokens (
			token_hash TEXT PRIMARY KEY,
			used_at    INTEGER NOT NULL,
			expires_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS verif_tokens_expiry ON verif_tokens(expires_at)`,
		// Subjects whose account was deleted. A session outlives its account, and
		// without these a stale session would register a brand new one on its
		// next request.
		`CREATE TABLE IF NOT EXISTS retired_subjects (
			provider TEXT NOT NULL,
			subject  TEXT NOT NULL,
			at       INTEGER NOT NULL,
			PRIMARY KEY (provider, subject)
		)`,
		// "Who did what", including every impersonation, in and out. Never
		// pruned automatically: it is the record of who had access.
		`CREATE TABLE IF NOT EXISTS audit_log (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			action        TEXT NOT NULL,
			target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			at            INTEGER NOT NULL,
			ip            TEXT,
			detail        TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at DESC)`,
		// Server wide values generated on first boot, so a self hosted
		// deployment works with no configuration.
		`CREATE TABLE IF NOT EXISTS server_secrets (
			name       TEXT PRIMARY KEY,
			value      TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
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
	// Additive migrations, run outside the schema transaction because SQLite
	// has no "ADD COLUMN IF NOT EXISTS" and DDL cannot be rolled back usefully
	// here. A duplicate is the expected result of running against a database
	// that already has the change, so it is not an error.
	for _, col := range []addColumn{
		// When a device token was last seen, for the console's device list.
		{table: "tokens", column: "last_used", decl: "INTEGER NOT NULL DEFAULT 0"},
		// Archived = retired by an operator (ADR 0011). Not a deletion: the
		// rows stay, keep syncing to the user's devices, and can be brought
		// back. Only the console hides them.
		{table: "tokens", column: "archived_at", decl: "INTEGER"},
		{table: "devices", column: "archived_at", decl: "INTEGER"},
		{table: "records", column: "archived_at", decl: "INTEGER"},
		// --- accounts (adr/0012) ---
		// The web console's login, as opposed to the extension's device token.
		{table: "users", column: "email", decl: "TEXT"},
		{table: "users", column: "email_verified_at", decl: "INTEGER"},
		{table: "users", column: "password_hash", decl: "TEXT"},
		// 'user' | 'admin'. NULL on every account that predates this column,
		// which reads as 'user'.
		{table: "users", column: "role", decl: "TEXT"},
		{table: "users", column: "disabled_at", decl: "INTEGER"},
		// Revocation cut-off for stateless session tokens: any session issued
		// before this instant is rejected, which is what makes "sign out
		// everywhere" and "revoke on password change" possible without keeping
		// a session table (the JWT is still self contained).
		{table: "users", column: "tokens_valid_after", decl: "INTEGER NOT NULL DEFAULT 0"},
	} {
		if _, err := s.addColumn(ctx, col.table, col.column, col.decl); err != nil {
			return err
		}
	}
	for _, stmt := range []string{
		// The console lists a user's records "archived last" by default.
		`CREATE INDEX IF NOT EXISTS records_archived ON records(user_id, archived_at)`,
		// A login is by email; the sync path never looks accounts up.
		`CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL`,
	} {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migration %q: %w", stmt, err)
		}
	}
	return nil
}

// addColumn is one additive migration step. It reports whether the column was
// added, so a caller can tell a fresh database from an existing one.
type addColumn struct {
	table  string
	column string
	decl   string
}

func (s *Store) addColumn(ctx context.Context, table, column, decl string) (bool, error) {
	stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, decl)
	if _, err := s.db.ExecContext(ctx, stmt); err != nil {
		if strings.Contains(err.Error(), "duplicate column name") {
			return false, nil
		}
		return false, fmt.Errorf("migration %q: %w", stmt, err)
	}
	return true, nil
}

func nowMS() int64 { return time.Now().UnixMilli() }
