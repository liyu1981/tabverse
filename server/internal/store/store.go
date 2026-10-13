package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure Go SQLite driver (no cgo -> easy cross compile)
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

// Store wraps the central SQLite database: accounts, devices, tokens,
// invites, the account tables and the counter cache. User *content* lives in a
// separate file per account, reached through the users pool (ADR 0027).
//
// Schema notes:
//   - The central database holds no records; `records` and `records_fts` are
//     per-user (see UserDB).
//   - A user's revision sequence lives beside its records, in that file's
//     `user_meta` table, so a push writes both in one transaction.
type Store struct {
	db    *sql.DB
	users *UserDBs
}

// Defaults for the per-user content pool. The cap is the file-descriptor
// budget - three descriptors per open WAL file (ADR 0027) - so it stays well
// below RLIMIT_NOFILE minus the socket reserve.
const (
	defaultMaxOpenUserDBs    = 64
	defaultUserDBAcquireWait = 250 * time.Millisecond
)

// Options tune Open. The zero value uses the defaults: a `users/` directory
// beside the central file and a 64-handle pool.
type Options struct {
	// UsersDir is where per-user content databases live.
	UsersDir string
	// MaxOpenUserDBs caps the number of open content files.
	MaxOpenUserDBs int
	// AcquireWait is how long an acquire waits for a slot before ErrBusy.
	AcquireWait time.Duration
}

// Open opens (creating if needed) the central database at path and runs
// migrations. Per-user content files live under a `users/` directory beside it
// unless Options.UsersDir overrides where.
func Open(path string, opts ...Options) (*Store, error) {
	var opt Options
	if len(opts) > 0 {
		opt = opts[0]
	}
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
	usersDir := opt.UsersDir
	if usersDir == "" {
		usersDir = filepath.Join(filepath.Dir(path), "users")
	}
	users, err := NewUserDBs(usersDir, opt.MaxOpenUserDBs, opt.AcquireWait)
	if err != nil {
		db.Close()
		return nil, err
	}
	s.users = users
	return s, nil
}

// contentDB acquires the per-user content database for one account. Callers
// must invoke the returned release func (defer). Handlers translate ErrBusy
// into 503 + Retry-After.
func (s *Store) contentDB(ctx context.Context, userID string) (*UserDB, func(), error) {
	return s.users.Acquire(ctx, userID)
}

// Close closes the central database and every open content file.
func (s *Store) Close() error {
	var firstErr error
	if s.users != nil {
		if err := s.users.Close(); err != nil {
			firstErr = err
		}
	}
	if err := s.db.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

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
		// Operator-created invitations to register an address. Keyed by the
		// address, because the account does not exist yet - unlike `invites`
		// above, which is a pairing code for one that does. Empty `code_hash`
		// means the invited address is the whole gate; a non-empty one is a code
		// the registrant must also supply. `used_at`/`expires_at` of 0 mean
		// unused/no expiry. `code` is the code in the clear, kept so the
		// invitation message can be rendered at any time (the hash alone cannot
		// reproduce it).
		`CREATE TABLE IF NOT EXISTS registration_invites (
			email      TEXT PRIMARY KEY,
			code_hash  TEXT NOT NULL DEFAULT '',
			invited_by TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL DEFAULT 0,
			used_at    INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS registration_invites_live ON registration_invites(used_at, expires_at)`,
		// `records` and `records_fts` are not defined here: user content lives in
		// the per-user files (ADR 0027).
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
		// The counter cache (ADR 0026). Exact values stay in the central tables;
		// the record-derived tallies are recomputed from the content files in the
		// background, so the console read path never fans out over user files.
		`CREATE TABLE IF NOT EXISTS user_counters (
			user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			rev_seq          INTEGER NOT NULL DEFAULT 0,
			record_count     INTEGER NOT NULL DEFAULT 0,
			last_activity    INTEGER NOT NULL DEFAULT 0,
			live_records     INTEGER NOT NULL DEFAULT 0,
			tombstones       INTEGER NOT NULL DEFAULT 0,
			archived_records INTEGER NOT NULL DEFAULT 0,
			updated_at       INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS counter_dirty (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			at      INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS user_entity_counts (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			entity  TEXT NOT NULL,
			n       INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (user_id, entity)
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
		// --- accounts (adr/0012) ---
		// The web console's login, as opposed to the extension's device token.
		{table: "users", column: "email", decl: "TEXT"},
		{table: "users", column: "email_verified_at", decl: "INTEGER"},
		{table: "users", column: "password_hash", decl: "TEXT"},
		// 'user' | 'admin'. NULL on every account that predates this column,
		// which reads as 'user'.
		{table: "users", column: "role", decl: "TEXT"},
		{table: "users", column: "disabled_at", decl: "INTEGER"},
		// Set when an account was created from a login with no invitation yet
		// (an invite-only server). It can sign in, but the console shows the
		// "request received" notice until an operator invites it.
		{table: "users", column: "pending_at", decl: "INTEGER NOT NULL DEFAULT 0"},
		// When the person accepted the user agreement while registering. 0 means
		// no account has agreed yet (it predates the registration split).
		{table: "users", column: "terms_accepted_at", decl: "INTEGER NOT NULL DEFAULT 0"},
		// The invitation code in the clear, so the message can be rendered on
		// demand (the hash alone cannot reproduce it).
		{table: "registration_invites", column: "code", decl: "TEXT NOT NULL DEFAULT ''"},
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
