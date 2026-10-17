package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

// Membership is the credit-funded lease of adr/0032. It is deliberately small:
// a lease end, a balance, an exemption flag and the lifecycle stamps that make
// the worker idempotent. The *status* is never stored - it is computed from
// these timestamps, so it cannot drift from them.
type Membership struct {
	UserID          string
	ExpiresAt       int64 // unix ms; lease end. 0 = never opened.
	Credits         int64 // cached balance; membership_ledger is authoritative.
	Unlimited       bool
	CreatedAt       int64
	UpdatedAt       int64
	LastRenewedAt   int64
	TrialGrantedAt  int64 // the single onboarding grant, once per account.
	ExpiredAt       int64 // first instant observed expired.
	ExpiredNotified int64
	PurgeWarnedAt   int64
}

// LedgerEntry is one append-only movement of credits.
type LedgerEntry struct {
	ID          int64  `json:"id"`
	UserID      string `json:"user_id"`
	Delta       int64  `json:"delta"`
	Balance     int64  `json:"balance"`
	Reason      string `json:"reason"`
	ActorUserID string `json:"actor_user_id,omitempty"`
	At          int64  `json:"at"`
	Detail      string `json:"detail,omitempty"`
}

// MembershipSummary is a directory row: the account, plus its lease and balance.
type MembershipSummary struct {
	UserID         string `json:"user_id"`
	Name           string `json:"name"`
	Email          string `json:"email"`
	Role           string `json:"role"`
	ExpiresAt      int64  `json:"expires_at"`
	Credits        int64  `json:"credits"`
	Unlimited      bool   `json:"unlimited"`
	TrialGrantedAt int64  `json:"trial_granted_at"`
	ExpiredAt      int64  `json:"expired_at"`
}

// Ledger reasons. Kept as constants so a typo in a caller is a compile error.
const (
	ReasonTrial      = "trial"
	ReasonGrant      = "grant"
	ReasonPeriod     = "period"
	ReasonAdjustment = "adjustment"
	ReasonRefund     = "refund"
	ReasonPurchase   = "purchase"
)

// ErrInsufficientCredits is returned when a period cannot be opened because the
// balance cannot pay for it.
var ErrInsufficientCredits = errors.New("insufficient credits")

const membershipCols = `user_id, expires_at, credits, unlimited, created_at, updated_at,
	last_renewed_at, trial_granted_at, expired_at, expired_notified_at, purge_warned_at`

type membershipScanner interface {
	Scan(dest ...any) error
}

func scanMembership(row membershipScanner) (Membership, error) {
	var m Membership
	var unlimited int
	err := row.Scan(&m.UserID, &m.ExpiresAt, &m.Credits, &unlimited, &m.CreatedAt,
		&m.UpdatedAt, &m.LastRenewedAt, &m.TrialGrantedAt, &m.ExpiredAt,
		&m.ExpiredNotified, &m.PurgeWarnedAt)
	m.Unlimited = unlimited != 0
	return m, err
}

// Membership returns an account's membership, or ErrNotFound when it has none
// (an account that predates the switch, before the enrollment sweep reaches it).
func (s *Store) Membership(ctx context.Context, userID string) (Membership, error) {
	m, err := scanMembership(s.db.QueryRowContext(ctx,
		`SELECT `+membershipCols+` FROM memberships WHERE user_id = ?`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Membership{}, ErrNotFound
	}
	return m, err
}

// ensureMembershipTx creates an empty membership row if the account has none and
// returns it. Called inside a transaction by every writer.
func ensureMembershipTx(ctx context.Context, tx *sql.Tx, userID string) (Membership, error) {
	now := nowMS()
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO memberships (user_id, created_at, updated_at) VALUES (?, ?, ?)`,
		userID, now, now); err != nil {
		return Membership{}, err
	}
	return scanMembership(tx.QueryRowContext(ctx,
		`SELECT `+membershipCols+` FROM memberships WHERE user_id = ?`, userID))
}

func appendLedgerTx(ctx context.Context, tx *sql.Tx, userID string, delta, balance int64, reason, actor, detail string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO membership_ledger (user_id, delta, balance, reason, actor_user_id, at, detail)
		VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''))`,
		userID, delta, balance, reason, actor, nowMS(), detail)
	return err
}

// GrantTrial is the single onboarding grant: it runs at most once per account.
// It credits the trial amount, opens the first period from it when it can pay,
// and stamps trial_granted_at so a retry, an admin reset, a switch toggled off
// and on, or a worker re-run grants nothing further.
func (s *Store) GrantTrial(ctx context.Context, userID string, trialCredits, price, periodMS int64) (Membership, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Membership{}, err
	}
	defer tx.Rollback()

	m, err := ensureMembershipTx(ctx, tx, userID)
	if err != nil {
		return Membership{}, err
	}
	if m.TrialGrantedAt != 0 {
		return m, tx.Commit()
	}
	now := nowMS()
	m.TrialGrantedAt = now
	m.UpdatedAt = now
	if trialCredits > 0 {
		m.Credits += trialCredits
		if err := appendLedgerTx(ctx, tx, userID, trialCredits, m.Credits, ReasonTrial, "", "onboarding grant"); err != nil {
			return Membership{}, err
		}
	}
	if price > 0 && periodMS > 0 && m.Credits >= price {
		m, err = openPeriodTx(ctx, tx, m, price, periodMS, ReasonPeriod, "")
		if err != nil {
			return Membership{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE memberships SET credits = ?, expires_at = ?, updated_at = ?,
			last_renewed_at = ?, trial_granted_at = ?, expired_at = ?,
			expired_notified_at = ?, purge_warned_at = ?
		WHERE user_id = ?`,
		m.Credits, m.ExpiresAt, m.UpdatedAt, m.LastRenewedAt, m.TrialGrantedAt,
		m.ExpiredAt, m.ExpiredNotified, m.PurgeWarnedAt, userID); err != nil {
		return Membership{}, err
	}
	return m, tx.Commit()
}

// GrantCredits moves the balance by delta and records it. A debit that would go
// below zero is refused, so a caller cannot quietly create a negative balance.
func (s *Store) GrantCredits(ctx context.Context, userID string, delta int64, reason, actor, detail string) (Membership, error) {
	if delta == 0 {
		return s.Membership(ctx, userID)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Membership{}, err
	}
	defer tx.Rollback()

	m, err := ensureMembershipTx(ctx, tx, userID)
	if err != nil {
		return Membership{}, err
	}
	if m.Credits+delta < 0 {
		return Membership{}, ErrInsufficientCredits
	}
	m.Credits += delta
	m.UpdatedAt = nowMS()
	if err := appendLedgerTx(ctx, tx, userID, delta, m.Credits, reason, actor, detail); err != nil {
		return Membership{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE memberships SET credits = ?, updated_at = ? WHERE user_id = ?`,
		m.Credits, m.UpdatedAt, userID); err != nil {
		return Membership{}, err
	}
	return m, tx.Commit()
}

// OpenPeriod opens one period now, paying price from the balance. Extending from
// a lease that has already lapsed starts at now rather than back-dating, so a
// lapsed account does not get a free period when it renews late.
func (s *Store) OpenPeriod(ctx context.Context, userID string, price, periodMS int64, actor, detail string) (Membership, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Membership{}, err
	}
	defer tx.Rollback()
	m, err := ensureMembershipTx(ctx, tx, userID)
	if err != nil {
		return Membership{}, err
	}
	m, err = openPeriodTx(ctx, tx, m, price, periodMS, ReasonPeriod, actor)
	if err != nil {
		return Membership{}, err
	}
	if err := writeMembershipTx(ctx, tx, m, detail); err != nil {
		return Membership{}, err
	}
	return m, tx.Commit()
}

// RenewIfFunded opens a period only when the balance can pay for it. It is the
// worker's atomic "debit if affordable" and reports whether it renewed.
func (s *Store) RenewIfFunded(ctx context.Context, userID string, price, periodMS int64) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var unlimited int
	err = tx.QueryRowContext(ctx,
		`SELECT unlimited FROM memberships WHERE user_id = ?`, userID).Scan(&unlimited)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	m, err := scanMembership(tx.QueryRowContext(ctx,
		`SELECT `+membershipCols+` FROM memberships WHERE user_id = ?`, userID))
	if err != nil {
		return false, err
	}
	if m.Unlimited || m.Credits < price || price <= 0 || periodMS <= 0 {
		return false, nil
	}
	m, err = openPeriodTx(ctx, tx, m, price, periodMS, ReasonPeriod, "")
	if err != nil {
		return false, err
	}
	if err := writeMembershipTx(ctx, tx, m, "auto-renew"); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func openPeriodTx(ctx context.Context, tx *sql.Tx, m Membership, price, periodMS int64, reason, actor string) (Membership, error) {
	if m.Credits < price {
		return m, ErrInsufficientCredits
	}
	now := nowMS()
	base := m.ExpiresAt
	if base < now {
		base = now
	}
	m.Credits -= price
	m.ExpiresAt = base + periodMS
	m.LastRenewedAt = now
	m.UpdatedAt = now
	// A fresh lease clears the expiry bookkeeping, so the next lapse notifies
	// again rather than being suppressed by the previous one.
	m.ExpiredAt, m.ExpiredNotified, m.PurgeWarnedAt = 0, 0, 0
	if err := appendLedgerTx(ctx, tx, m.UserID, -price, m.Credits, reason, actor, ""); err != nil {
		return m, err
	}
	return m, nil
}

func writeMembershipTx(ctx context.Context, tx *sql.Tx, m Membership, detail string) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE memberships SET expires_at = ?, credits = ?, unlimited = ?, updated_at = ?,
			last_renewed_at = ?, trial_granted_at = ?, expired_at = ?,
			expired_notified_at = ?, purge_warned_at = ?
		WHERE user_id = ?`,
		m.ExpiresAt, m.Credits, boolToInt(m.Unlimited), m.UpdatedAt, m.LastRenewedAt,
		m.TrialGrantedAt, m.ExpiredAt, m.ExpiredNotified, m.PurgeWarnedAt, m.UserID)
	return err
}

// SetMembership is the operator override. A negative expiresAt leaves the lease
// end alone; the rest are always applied.
func (s *Store) SetMembership(ctx context.Context, userID string, expiresAt int64, unlimited bool, actor, detail string) (Membership, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Membership{}, err
	}
	defer tx.Rollback()
	m, err := ensureMembershipTx(ctx, tx, userID)
	if err != nil {
		return Membership{}, err
	}
	if expiresAt >= 0 {
		m.ExpiresAt = expiresAt
		m.ExpiredAt, m.ExpiredNotified, m.PurgeWarnedAt = 0, 0, 0
	}
	m.Unlimited = unlimited
	m.UpdatedAt = nowMS()
	if err := writeMembershipTx(ctx, tx, m, detail); err != nil {
		return Membership{}, err
	}
	if actor != "" {
		if err := appendLedgerTx(ctx, tx, userID, 0, m.Credits, ReasonAdjustment, actor, detail); err != nil {
			return Membership{}, err
		}
	}
	return m, tx.Commit()
}

// MarkExpired stamps the first instant an account was seen expired. Idempotent:
// a second pass changes nothing, so the notice that hangs off it fires once.
func (s *Store) MarkExpired(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE memberships SET expired_at = ? WHERE user_id = ? AND expired_at = 0`,
		nowMS(), userID)
	return err
}

// MarkExpiryNotified and MarkPurgeWarned record that a notice was sent.
func (s *Store) MarkExpiryNotified(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE memberships SET expired_notified_at = ? WHERE user_id = ?`, nowMS(), userID)
	return err
}

func (s *Store) MarkPurgeWarned(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE memberships SET purge_warned_at = ? WHERE user_id = ?`, nowMS(), userID)
	return err
}

// DueForRenewal lists funded accounts whose lease is within the lead window
// (lapsed ones included, so a server that was down catches up on start).
func (s *Store) DueForRenewal(ctx context.Context, byMS, price int64) ([]Membership, error) {
	return s.queryMemberships(ctx, `
		SELECT `+membershipCols+` FROM memberships
		WHERE unlimited = 0 AND expires_at > 0 AND expires_at <= ? AND credits >= ?
		ORDER BY expires_at ASC`, byMS, price)
}

// DueForExpiry lists accounts whose lease has ended and that have not been
// stamped expired yet.
func (s *Store) DueForExpiry(ctx context.Context, now int64) ([]Membership, error) {
	return s.queryMemberships(ctx, `
		SELECT `+membershipCols+` FROM memberships
		WHERE unlimited = 0 AND expires_at > 0 AND expires_at <= ? AND expired_at = 0
		ORDER BY expires_at ASC`, now)
}

// DueForPurge lists accounts whose retention window has closed.
func (s *Store) DueForPurge(ctx context.Context, now, retentionMS int64) ([]Membership, error) {
	return s.queryMemberships(ctx, `
		SELECT `+membershipCols+` FROM memberships
		WHERE unlimited = 0 AND expires_at > 0 AND expires_at + ? <= ?
		ORDER BY expires_at ASC`, retentionMS, now)
}

func (s *Store) queryMemberships(ctx context.Context, query string, args ...any) ([]Membership, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Membership{}
	for rows.Next() {
		m, err := scanMembership(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListMemberships is the operator's directory of leases: every account, with its
// membership joined in (a missing row reads as an unopened lease).
func (s *Store) ListMemberships(ctx context.Context, query string) ([]MembershipSummary, error) {
	where := "1 = 1"
	args := []any{}
	if q := strings.ToLower(strings.TrimSpace(query)); q != "" {
		where += " AND (instr(lower(u.name), ?) > 0 OR instr(lower(COALESCE(u.email, '')), ?) > 0)"
		args = append(args, q, q)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.name, COALESCE(u.email, ''), COALESCE(u.role, 'user'),
		       COALESCE(m.expires_at, 0), COALESCE(m.credits, 0), COALESCE(m.unlimited, 0),
		       COALESCE(m.trial_granted_at, 0), COALESCE(m.expired_at, 0)
		FROM users u LEFT JOIN memberships m ON m.user_id = u.id
		WHERE `+where+` ORDER BY u.created_at ASC, u.id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MembershipSummary{}
	for rows.Next() {
		var m MembershipSummary
		var unlimited int
		if err := rows.Scan(&m.UserID, &m.Name, &m.Email, &m.Role, &m.ExpiresAt,
			&m.Credits, &unlimited, &m.TrialGrantedAt, &m.ExpiredAt); err != nil {
			return nil, err
		}
		m.Unlimited = unlimited != 0
		out = append(out, m)
	}
	return out, rows.Err()
}

// Ledger returns an account's credit movements, newest first.
func (s *Store) Ledger(ctx context.Context, userID string, limit int) ([]LedgerEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, delta, balance, reason, COALESCE(actor_user_id, ''), at, COALESCE(detail, '')
		FROM membership_ledger WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LedgerEntry{}
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Delta, &e.Balance, &e.Reason,
			&e.ActorUserID, &e.At, &e.Detail); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Setting reads a server_settings value.
func (s *Store) Setting(ctx context.Context, name string) (string, bool, error) {
	var value string
	err := s.db.QueryRowContext(ctx,
		`SELECT value FROM server_settings WHERE name = ?`, name).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// PutSetting writes a server_settings value. Empty actor means "the server
// seeded this on boot", which is not attributable to a person.
func (s *Store) PutSetting(ctx context.Context, name, value, actor string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO server_settings (name, value, updated_at, updated_by)
		VALUES (?, ?, ?, NULLIF(?, ''))
		ON CONFLICT(name) DO UPDATE SET
			value = excluded.value, updated_at = excluded.updated_at,
			updated_by = excluded.updated_by`,
		name, value, nowMS(), actor)
	return err
}

// SettingBool is Setting with a boolean parse; a missing key returns false.
func (s *Store) SettingBool(ctx context.Context, name string) (bool, bool, error) {
	v, ok, err := s.Setting(ctx, name)
	if err != nil || !ok {
		return false, ok, err
	}
	b, err := strconv.ParseBool(v)
	return b, true, err
}

// ExportRecords streams every live record of an account to fn. It is the data
// download of adr/0032: read-only, and the caller writes as it arrives so the
// whole account is never buffered in memory.
func (s *Store) ExportRecords(ctx context.Context, userID string, fn func(Record) error) error {
	u, release, err := s.contentDB(ctx, userID)
	if err != nil {
		return err
	}
	defer release()
	rows, err := u.db.QueryContext(ctx, `
		SELECT entity, id, device_id, rev, deleted, updated_at, payload, server_at
		FROM records WHERE user_id = ? AND deleted = 0 ORDER BY entity, id`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return err
		}
		if err := fn(*rec); err != nil {
			return err
		}
	}
	return rows.Err()
}
