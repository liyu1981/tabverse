package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// A UserDB is one account's content database: the sync source of truth
// (`records`, `records_fts`) and the per-user revision counter that numbers it.
// Everything account-level - `users`, `devices`, `tokens`, `invites` - stays
// in the central Store, so this file is the unit that can be isolated,
// encrypted, backed up, moved or deleted per account (ADR 0027).
//
// A UserDB is created by the UserDBs pool and never opened directly.
type UserDB struct {
	id string
	db *sql.DB
}

// openUserDB opens (creating if needed) one account's content database at path
// and applies its schema. The caller owns it and must Close it when evicting
// from the pool.
func openUserDB(id, path string) (*UserDB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open user db %s: %w", id, err)
	}
	// One connection per user file, same reason as the central store: it is
	// the only writer, so a deferred read-then-write cannot hit SQLITE_BUSY.
	// This connection is what the pool's cap counts, and what eviction closes.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(time.Hour)

	u := &UserDB{id: id, db: db}
	if err := u.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return u, nil
}

// Close closes the handle and releases its three file descriptors (the file,
// its -wal and its -shm).
func (u *UserDB) Close() error { return u.db.Close() }

// ID is the account this content database belongs to.
func (u *UserDB) ID() string { return u.id }

// migrate builds the content schema. It is idempotent and additive, the same
// approach as the central store's migrate: a fresh file gets the full table and
// an existing one keeps its rows. `user_id` is kept in every key even though a
// file now holds exactly one account, so the SQL paths stay the ones the sync
// protocol already proved.
func (u *UserDB) migrate(ctx context.Context) error {
	schema := []string{
		`CREATE TABLE IF NOT EXISTS records (
			user_id     TEXT NOT NULL,
			entity      TEXT NOT NULL,
			id          TEXT NOT NULL,
			device_id   TEXT NOT NULL DEFAULT '',
			rev         INTEGER NOT NULL,
			deleted     INTEGER NOT NULL DEFAULT 0,
			updated_at  INTEGER NOT NULL,
			payload     TEXT NOT NULL DEFAULT '',
			server_at   INTEGER NOT NULL,
			archived_at INTEGER,
			PRIMARY KEY (user_id, entity, id)
		)`,
		`CREATE INDEX IF NOT EXISTS records_user_rev ON records(user_id, rev)`,
		`CREATE INDEX IF NOT EXISTS records_archived ON records(user_id, archived_at)`,
		// The per-user revision sequence, beside the records it numbers so a
		// push writes both in one transaction (ADR 0027).
		`CREATE TABLE IF NOT EXISTS user_meta (
			user_id TEXT PRIMARY KEY,
			rev_seq INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
			entity UNINDEXED,
			user_id UNINDEXED,
			record_id UNINDEXED,
			body,
			tokenize = 'unicode61 remove_diacritics 2'
		)`,
	}
	tx, err := u.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin user migration: %w", err)
	}
	defer tx.Rollback()
	for _, stmt := range schema {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("user migration statement %q: %w", stmt, err)
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO user_meta (user_id, rev_seq) VALUES (?, 0)`, u.id); err != nil {
		return fmt.Errorf("user migration meta row: %w", err)
	}
	return tx.Commit()
}
