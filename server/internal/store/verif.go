package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// One-shot consumption of the emailed sign-in link.
//
// The link in the message is a bearer credential: it *is* the session, wearing
// a 30 minute expiry. Saying in the email that it "works once" is therefore a
// claim about the server, not about the message, and it has to be true - a
// link that opens a second time is a second session for whoever read the
// forward.
//
// The auth library does this for us, but its default store is an in-memory map,
// so the guarantee dies with the process: restart the server inside the 30
// minute window and the link works again. This is the same check in the
// database, which is also what makes it work when two replicas serve the same
// deployment.

// MarkVerifTokenUsed records a redeemed sign-in link and reports whether it had
// already been redeemed while still valid. A second redemption of a live link
// is refused by the caller.
func (s *Store) MarkVerifTokenUsed(ctx context.Context, hash string, ttl time.Duration) (bool, error) {
	now := nowMS()
	expiresAt := now + int64(ttl/time.Millisecond)
	if expiresAt <= now {
		expiresAt = now + 1
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	var used, expires int64
	err = tx.QueryRowContext(ctx,
		`SELECT used_at, expires_at FROM verif_tokens WHERE token_hash = ?`, hash).
		Scan(&used, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO verif_tokens (token_hash, used_at, expires_at) VALUES (?, ?, ?)`,
			hash, now, expiresAt); err != nil {
			return false, err
		}
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// A row whose redemption happened while the row itself said the link was
	// live is a link that has already been used, and that is the answer. A row
	// older than its own expiry is only history: the link died of its 30 minute
	// TTL, and refusing here would reject a redemption the caller was willing to
	// accept.
	if used <= expires {
		return true, nil
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE verif_tokens SET used_at = ?, expires_at = ? WHERE token_hash = ?`,
		now, expiresAt, hash); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return false, nil
}

// SweepVerifTokens drops redemption records for links that expired long ago.
// Called at startup and by the retention tick; a row is a few dozen bytes and
// the table's growth is bounded in practice, but "bounded in practice" is what
// this is.
func (s *Store) SweepVerifTokens(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM verif_tokens WHERE expires_at < ?`, nowMS()-int64(24*time.Hour/time.Millisecond))
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int64(n), err
}
