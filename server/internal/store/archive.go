package store

import (
	"context"
	"database/sql"
	"errors"
)

// Archiving (ADR 0011).
//
// A revoked credential is a fact about *access*, not about data. The records a
// lost laptop last wrote are still the user's live tabverses, replicated to
// every device they own, so archiving them must not tombstone anything: a
// tombstone would propagate through delta sync and delete the user's data on
// their other browsers. So archiving here is bookkeeping and nothing else:
//
//   - the row stays on disk and keeps syncing to the user's devices
//   - the user's own extension is unaffected (it never sees `archived_at`;
//     the flag exists only for the operator console)
//   - the console hides archived rows from its default listings, and can show
//     them again
//   - it is reversible, and a record that is edited again becomes un-archived
//     on its own, because it is live again
//
// Removing user data is still the client's business (ADR 0001: a delete is a
// tombstone the client writes) or the account's, by deleting the account.

// ErrNotRevoked is returned when an operator tries to archive a token, or a
// device's records, while the credential can still authenticate. Revoking is
// how access is cut; archiving a token is how a dead one is tidied away, and
// conflating the two would let a live credential silently vanish from the
// console while it still works.
//
// Archiving a *device* is the exception: it revokes the device's tokens itself
// (see ArchiveDevice), so there is nothing left to refuse.
var ErrNotRevoked = errors.New("not revoked yet: revoke it first")

// ArchiveOutcome reports what an archive or unarchive changed.
type ArchiveOutcome struct {
	Archived   int `json:"archived"`
	Unarchived int `json:"unarchived"`
	// Skipped counts the rows that were already in the requested state, so a
	// repeated request is a no-op the caller can see rather than a silent one.
	Skipped int `json:"skipped"`
}

// IsRevoked reports whether a token has been revoked.
func (s *Store) IsRevoked(ctx context.Context, userID, hash string) (bool, error) {
	var revoked int
	err := s.db.QueryRowContext(ctx,
		`SELECT revoked FROM tokens WHERE user_id = ? AND hash = ?`, userID, hash).Scan(&revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	return revoked != 0, nil
}

// LiveTokenCount is how many usable tokens a device still has.
func (s *Store) LiveTokenCount(ctx context.Context, deviceID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tokens WHERE device_id = ? AND revoked = 0`, deviceID).Scan(&n)
	return n, err
}

// ArchiveToken retires one revoked token so the console stops listing it among
// the live credentials. Requires the token to be revoked: an active token is
// still a way in, and hiding it would make the console lie about access.
func (s *Store) ArchiveToken(ctx context.Context, userID, hash string) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	revoked, err := s.IsRevoked(ctx, userID, hash)
	if err != nil {
		return out, err
	}
	if !revoked {
		return out, ErrNotRevoked
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE tokens SET archived_at = ? WHERE user_id = ? AND hash = ? AND archived_at IS NULL`,
		nowMS(), userID, hash)
	if err != nil {
		return out, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return out, err
	}
	if n == 0 {
		out.Skipped = 1
		return out, nil
	}
	out.Archived = int(n)
	return out, nil
}

// UnarchiveToken brings a retired token back into the console's lists. It
// stays revoked: unarchiving is about tidiness, not about re-enabling access.
func (s *Store) UnarchiveToken(ctx context.Context, userID, hash string) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	res, err := s.db.ExecContext(ctx,
		`UPDATE tokens SET archived_at = NULL WHERE user_id = ? AND hash = ? AND archived_at IS NOT NULL`,
		userID, hash)
	if err != nil {
		return out, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return out, err
	}
	if n == 0 {
		// Nothing to undo, unless the token is not there at all.
		var exists int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM tokens WHERE user_id = ? AND hash = ?`, userID, hash).Scan(&exists); err != nil {
			return out, err
		}
		if exists == 0 {
			return out, ErrNotFound
		}
		out.Skipped = 1
		return out, nil
	}
	out.Unarchived = int(n)
	return out, nil
}

// deviceState is what the archive preconditions are decided on: a device whose
// records are being archived must have nothing that can still authenticate.
type deviceState struct {
	liveTokens int
	archivedAt sql.NullInt64
}

func (s *Store) deviceStateOf(ctx context.Context, userID, deviceID string) (deviceState, error) {
	var st deviceState
	var id string
	err := s.db.QueryRowContext(ctx, `
		SELECT d.id, d.archived_at,
		       (SELECT COUNT(*) FROM tokens t WHERE t.device_id = d.id AND t.revoked = 0)
		FROM devices d WHERE d.id = ? AND d.user_id = ?`, deviceID, userID).
		Scan(&id, &st.archivedAt, &st.liveTokens)
	if errors.Is(err, sql.ErrNoRows) {
		return st, ErrNotFound
	}
	if err != nil {
		return st, err
	}
	return st, nil
}

// checkRevoked applies the one precondition left for archiving a device's
// records: nothing may still authenticate with it. Archiving the device itself
// has no precondition, because it revokes as part of the teardown.
func (s *Store) checkRevoked(ctx context.Context, userID, deviceID string) (deviceState, error) {
	st, err := s.deviceStateOf(ctx, userID, deviceID)
	if err != nil {
		return st, err
	}
	if st.liveTokens > 0 {
		return st, ErrNotRevoked
	}
	return st, nil
}

// ArchiveDevice retires a device and cuts it off, in one deterministic step.
//
// Archiving a device is the operator's decisive teardown: it revokes every
// token the device holds, archives those tokens and archives the device, all
// in one transaction, so an archived device can never be left looking active
// or still syncing. It is immediate - there is no inactivity window to wait
// out. Nothing is deleted: the records it wrote stay stored and keep syncing
// to the user's other devices (ADR 0011), and only the console stops listing
// the rows. Unarchiving brings the device back; its tokens stay revoked.
func (s *Store) ArchiveDevice(ctx context.Context, userID, deviceID string) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	st, err := s.deviceStateOf(ctx, userID, deviceID)
	if err != nil {
		return out, err
	}
	if st.archivedAt.Valid {
		out.Skipped = 1
		return out, nil
	}
	now := nowMS()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	// Rollback is a no-op once Commit has run; the deferred call covers every
	// early return above it.
	defer func() { _ = tx.Rollback() }()
	// Cut access first, so nothing can authenticate with a device that is about
	// to vanish from the console.
	if _, err := tx.ExecContext(ctx,
		`UPDATE tokens SET revoked = 1 WHERE user_id = ? AND device_id = ? AND revoked = 0`,
		userID, deviceID); err != nil {
		return out, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE tokens SET archived_at = ? WHERE user_id = ? AND device_id = ? AND archived_at IS NULL`,
		now, userID, deviceID); err != nil {
		return out, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE devices SET archived_at = ? WHERE id = ? AND user_id = ?`,
		now, deviceID, userID); err != nil {
		return out, err
	}
	if err := tx.Commit(); err != nil {
		return out, err
	}
	out.Archived = 1
	return out, nil
}

// UnarchiveDevice brings a retired device back into the console's lists. Its
// tokens stay revoked: only pairing again re-enables it.
func (s *Store) UnarchiveDevice(ctx context.Context, userID, deviceID string) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	res, err := s.db.ExecContext(ctx,
		`UPDATE devices SET archived_at = NULL WHERE id = ? AND user_id = ? AND archived_at IS NOT NULL`,
		deviceID, userID)
	if err != nil {
		return out, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return out, err
	}
	if n == 0 {
		if err := s.RequireUser(ctx, userID); err != nil {
			return out, err
		}
		var exists int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM devices WHERE id = ? AND user_id = ?`, deviceID, userID).Scan(&exists); err != nil {
			return out, err
		}
		if exists == 0 {
			return out, ErrNotFound
		}
		out.Skipped = 1
		return out, nil
	}
	out.Unarchived = 1
	return out, nil
}

// ArchiveDeviceRecords archives every live record this device last wrote. The
// rows are untouched otherwise: they still sync to the user's other devices
// (ADR 0011), they only stop showing up in the console's default listings.
func (s *Store) ArchiveDeviceRecords(ctx context.Context, userID, deviceID string) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	// The records a device wrote are only retired once nothing can still
	// authenticate with it. (Archiving the device revokes its tokens, so this
	// passes by the time the console offers this half.)
	if _, err := s.checkRevoked(ctx, userID, deviceID); err != nil {
		return out, err
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE records SET archived_at = ?
		WHERE user_id = ? AND device_id = ? AND deleted = 0 AND archived_at IS NULL`,
		nowMS(), userID, deviceID)
	if err != nil {
		return out, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return out, err
	}
	out.Archived = int(n)
	return out, nil
}

// UnarchiveDeviceRecords brings back the records an archived device wrote.
// Tombstones are not restored: a deleted record stays deleted, because undoing
// a delete is the client's business, not the operator's.
func (s *Store) UnarchiveDeviceRecords(ctx context.Context, userID, deviceID string) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	if err := s.RequireUser(ctx, userID); err != nil {
		return out, err
	}
	var exists int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM devices WHERE id = ? AND user_id = ?`, deviceID, userID).Scan(&exists); err != nil {
		return out, err
	}
	if exists == 0 {
		return out, ErrNotFound
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE records SET archived_at = NULL
		WHERE user_id = ? AND device_id = ? AND archived_at IS NOT NULL`,
		userID, deviceID)
	if err != nil {
		return out, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return out, err
	}
	out.Unarchived = int(n)
	return out, nil
}

// ArchivedRecordCount is how many records a device's last write left archived.
func (s *Store) ArchivedRecordCount(ctx context.Context, userID, deviceID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM records
		WHERE user_id = ? AND device_id = ? AND deleted = 0 AND archived_at IS NOT NULL`,
		userID, deviceID).Scan(&n)
	return n, err
}
