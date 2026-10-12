package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// ErrInviteRequired is returned when a *new* account is being created on an
// invite-only server and no live invitation covers the address. An existing
// account is never refused, so a sign-in is unaffected.
var ErrInviteRequired = errors.New("registration invite required")

// RegistrationInvite is one operator-created invitation to register an address.
type RegistrationInvite struct {
	// Email is the invited address, lower-cased: the key.
	Email string `json:"email"`
	// InvitedBy is the operator's user id.
	InvitedBy string `json:"invited_by"`
	CreatedAt int64  `json:"created_at"`
	// ExpiresAt is unix ms; 0 means no expiry.
	ExpiresAt int64 `json:"expires_at"`
	// UsedAt is unix ms when the account was created; 0 means not yet.
	UsedAt int64 `json:"used_at"`
	// HasCode reports whether a code is also required to register.
	HasCode bool `json:"has_code"`
}

// Live reports whether the invite may still be used at time `now` (unix ms).
func (i RegistrationInvite) Live(now int64) bool {
	return i.UsedAt == 0 && (i.ExpiresAt == 0 || i.ExpiresAt > now)
}

func normalizeInviteEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// CreateRegistrationInvite upserts an invitation for an address. Re-inviting
// the same address refreshes it (a new code, a new expiry, unused again)
// rather than stacking rows, because the address is the key.
func (s *Store) CreateRegistrationInvite(ctx context.Context, email, codeHash, invitedBy string, ttlMS int64) (RegistrationInvite, error) {
	email = normalizeInviteEmail(email)
	if email == "" {
		return RegistrationInvite{}, errors.New("email is required")
	}
	now := nowMS()
	expires := int64(0)
	if ttlMS > 0 {
		expires = now + ttlMS
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO registration_invites (email, code_hash, invited_by, created_at, expires_at, used_at)
		VALUES (?, ?, ?, ?, ?, 0)
		ON CONFLICT(email) DO UPDATE SET
			code_hash  = excluded.code_hash,
			invited_by = excluded.invited_by,
			created_at = excluded.created_at,
			expires_at = excluded.expires_at,
			used_at    = 0`,
		email, codeHash, invitedBy, now, expires); err != nil {
		return RegistrationInvite{}, err
	}
	return RegistrationInvite{
		Email: email, InvitedBy: invitedBy, CreatedAt: now,
		ExpiresAt: expires, HasCode: codeHash != "",
	}, nil
}

// ListRegistrationInvites returns every invite, newest first, so the console
// can show pending, used and expired in one list.
func (s *Store) ListRegistrationInvites(ctx context.Context) ([]RegistrationInvite, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT email, invited_by, created_at, expires_at, used_at, code_hash
		FROM registration_invites ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RegistrationInvite{}
	for rows.Next() {
		var inv RegistrationInvite
		var codeHash string
		if err := rows.Scan(&inv.Email, &inv.InvitedBy, &inv.CreatedAt,
			&inv.ExpiresAt, &inv.UsedAt, &codeHash); err != nil {
			return nil, err
		}
		inv.HasCode = codeHash != ""
		out = append(out, inv)
	}
	return out, rows.Err()
}

// RegistrationInviteFor returns one invite, or ErrNotFound.
func (s *Store) RegistrationInviteFor(ctx context.Context, email string) (RegistrationInvite, error) {
	var inv RegistrationInvite
	var codeHash string
	err := s.db.QueryRowContext(ctx, `
		SELECT email, invited_by, created_at, expires_at, used_at, code_hash
		FROM registration_invites WHERE email = ?`, normalizeInviteEmail(email)).
		Scan(&inv.Email, &inv.InvitedBy, &inv.CreatedAt, &inv.ExpiresAt, &inv.UsedAt, &codeHash)
	if errors.Is(err, sql.ErrNoRows) {
		return RegistrationInvite{}, ErrNotFound
	}
	if err != nil {
		return RegistrationInvite{}, err
	}
	inv.HasCode = codeHash != ""
	return inv, nil
}

// RevokeRegistrationInvite removes an invitation. Removing it (rather than
// marking it) is the honest answer to "un-invite": nothing is left to check.
func (s *Store) RevokeRegistrationInvite(ctx context.Context, email string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM registration_invites WHERE email = ?`, normalizeInviteEmail(email))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetRegistrationInviteCode replaces an invite's code hash. That is what a
// re-send does: the old code is not recoverable (only its hash is stored), so a
// fresh one is minted and the previous one stops working.
func (s *Store) SetRegistrationInviteCode(ctx context.Context, email, codeHash string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE registration_invites SET code_hash = ? WHERE email = ?`,
		codeHash, normalizeInviteEmail(email))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RegistrationPolicy is what a registration has to satisfy to create a *new*
// account. It is passed into UpsertIdentity so the check and the insert are one
// transaction - two registrations racing on one invitation cannot both pass.
type RegistrationPolicy struct {
	// RequireInvite is the server's `TABVERSED_REGISTRATION_REQUIRES_INVITE`.
	RequireInvite bool
	// CodeHash is the sha256 of a code the registrant supplied, "" when none.
	CodeHash string
	// CreatePending says what to do when the invite is required and missing:
	// true records a *pending* account (a social login, which proves the
	// address) so the person can sign in and be told to wait; false refuses
	// with ErrInviteRequired (the email path).
	CreatePending bool
}

// consumeRegistrationInviteTx checks a live invite in tx and, when it is valid,
// marks it used. It returns false when there is no usable invite (missing,
// already used, expired, or a required code that does not match).
func consumeRegistrationInviteTx(ctx context.Context, tx *sql.Tx, email, codeHash string) (bool, error) {
	email = normalizeInviteEmail(email)
	if email == "" {
		return false, nil
	}
	var storedHash string
	var usedAt, expiresAt int64
	err := tx.QueryRowContext(ctx, `
		SELECT code_hash, used_at, expires_at FROM registration_invites WHERE email = ?`, email).
		Scan(&storedHash, &usedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	now := nowMS()
	if usedAt != 0 || (expiresAt != 0 && expiresAt <= now) {
		return false, nil
	}
	// A code is required only when the invite carries one; an invited address
	// with no code is the whole gate.
	if storedHash != "" && storedHash != codeHash {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE registration_invites SET used_at = ? WHERE email = ?`, now, email); err != nil {
		return false, err
	}
	return true, nil
}
