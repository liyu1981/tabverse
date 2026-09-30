package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// CreateUser inserts a new user. It fails if one already exists (single
// account per deployment for v1; multiple devices pair into it).
func (s *Store) CreateUser(ctx context.Context, id, name string) (User, error) {
	now := nowMS()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)`, id, name, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "constraint") {
			return User{}, fmt.Errorf("users already bootstrapped: %w", err)
		}
		return User{}, err
	}
	return User{ID: id, Name: name, CreatedAt: unixMS(now)}, nil
}

// CountUsers reports how many accounts exist; used to gate bootstrap.
func (s *Store) CountUsers(ctx context.Context) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// GetUser returns the single user of this deployment.
func (s *Store) GetUser(ctx context.Context, id string) (User, error) {
	var u User
	var createdAt int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Name, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	u.CreatedAt = unixMS(createdAt)
	return u, nil
}

func (s *Store) CreateDevice(ctx context.Context, id, userID, name string) (Device, error) {
	now := nowMS()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO devices (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
		id, userID, name, now)
	if err != nil {
		return Device{}, err
	}
	return Device{ID: id, UserID: userID, Name: name, CreatedAt: unixMS(now)}, nil
}

// CreateToken stores the hash of a freshly issued token.
func (s *Store) CreateToken(ctx context.Context, hash, userID, deviceID string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO tokens (hash, user_id, device_id, created_at) VALUES (?, ?, ?, ?)`,
		hash, userID, deviceID, nowMS())
	return err
}

// LookupToken resolves a presented token hash into its owner.
// Returns ErrNotFound for unknown or revoked tokens.
func (s *Store) LookupToken(ctx context.Context, hash string) (userID, deviceID string, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT user_id, device_id FROM tokens WHERE hash = ? AND revoked = 0`, hash).
		Scan(&userID, &deviceID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return userID, deviceID, err
}

// CreateInvite mints a single use pairing code for the given user.
func (s *Store) CreateInvite(ctx context.Context, codeHash, userID string, ttlMS int64) (expiresAtMS int64, err error) {
	now := nowMS()
	expires := now + ttlMS
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO invites (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		codeHash, userID, now, expires)
	return expires, err
}

// ConsumeInvite atomically marks an invite as used. It returns the owning
// user id, ErrNotFound for unknown/expired/already used codes.
func (s *Store) ConsumeInvite(ctx context.Context, codeHash string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var userID string
	var expiresAt int64
	var usedAt sql.NullInt64
	err = tx.QueryRowContext(ctx,
		`SELECT user_id, expires_at, used_at FROM invites WHERE code_hash = ?`, codeHash).
		Scan(&userID, &expiresAt, &usedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if usedAt.Valid || expiresAt < nowMS() {
		return "", ErrNotFound
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE invites SET used_at = ? WHERE code_hash = ?`, nowMS(), codeHash); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return userID, nil
}

// nextRev must be called inside a transaction: it bumps and returns the
// per user revision sequence.
func nextRev(ctx context.Context, tx *sql.Tx, userID string) (int64, error) {
	if _, err := tx.ExecContext(ctx,
		`UPDATE users SET rev_seq = rev_seq + 1 WHERE id = ?`, userID); err != nil {
		return 0, err
	}
	var rev int64
	if err := tx.QueryRowContext(ctx,
		`SELECT rev_seq FROM users WHERE id = ?`, userID).Scan(&rev); err != nil {
		return 0, err
	}
	return rev, nil
}

// AllUserIDs lists every account (single account per deployment in v1, but
// the retention sweep is written for N).
func (s *Store) AllUserIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM users`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ServerRev returns the current revision sequence for a user.
func (s *Store) ServerRev(ctx context.Context, userID string) (int64, error) {
	var rev int64
	err := s.db.QueryRowContext(ctx, `SELECT rev_seq FROM users WHERE id = ?`, userID).Scan(&rev)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return rev, err
}

// newID mints an identifier with the given prefix. It is the same shape the API
// layer uses, kept here so account creation (which happens inside a store
// transaction) can mint ids without importing the API package.
func newID(prefix string) string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		// crypto/rand failure is not recoverable, and an id is not optional.
		panic(err)
	}
	return prefix + hex.EncodeToString(raw)
}
