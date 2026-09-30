package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
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

// ErrNotRevoked is returned when an operator tries to archive a credential
// that still works. Revoking is how a credential is disabled; archiving is how
// a dead one is tidied away, and conflating the two would let a live device
// silently vanish from the console while still syncing.
var ErrNotRevoked = errors.New("not revoked yet: revoke it first")

// ErrActive is returned when a device is still in use. Inactivity is measured
// by the last successful authentication (tokens.last_used).
var ErrActive = errors.New("still active")

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

// deviceState is what the archive precondition is decided on: a device must
// have no usable token left, and must look abandoned.
type deviceState struct {
	liveTokens int
	lastUsed   int64
	archivedAt sql.NullInt64
}

func (s *Store) deviceStateOf(ctx context.Context, userID, deviceID string) (deviceState, error) {
	var st deviceState
	var id string
	err := s.db.QueryRowContext(ctx, `
		SELECT d.id, d.archived_at,
		       (SELECT COUNT(*) FROM tokens t WHERE t.device_id = d.id AND t.revoked = 0),
		       COALESCE((SELECT MAX(t.last_used) FROM tokens t WHERE t.device_id = d.id), 0)
		FROM devices d WHERE d.id = ? AND d.user_id = ?`, deviceID, userID).
		Scan(&id, &st.archivedAt, &st.liveTokens, &st.lastUsed)
	if errors.Is(err, sql.ErrNoRows) {
		return st, ErrNotFound
	}
	if err != nil {
		return st, err
	}
	return st, nil
}

// InactiveSince is how long a device has to go unused before archiving it is
// allowed. Zero or negative days disables the check, leaving only "revoked".
func inactiveSince(days int) time.Duration {
	if days <= 0 {
		return 0
	}
	return time.Duration(days) * 24 * time.Hour
}

// checkArchivable applies the precondition for archiving a device: nothing may
// still authenticate with it, and it must look abandoned.
func (s *Store) checkArchivable(ctx context.Context, userID, deviceID string, inactiveDays int) (deviceState, error) {
	st, err := s.deviceStateOf(ctx, userID, deviceID)
	if err != nil {
		return st, err
	}
	if st.liveTokens > 0 {
		return st, ErrNotRevoked
	}
	if wait := inactiveSince(inactiveDays); wait > 0 && st.lastUsed != 0 {
		// A device that has never authenticated once has no activity to wait
		// out, so the window does not apply to it: a mis-issued pairing code
		// that was revoked straight away should not leave a phantom device
		// sitting in the list for a month.
		if time.Since(unixMS(st.lastUsed)) < wait {
			days := int(wait.Hours() / 24)
			return st, fmt.Errorf("%w: last synced %s, needs %d days of silence",
				ErrActive, humanAge(unixMS(st.lastUsed)), days)
		}
	}
	return st, nil
}

// ArchiveDevice retires a revoked, abandoned device in the console's lists.
func (s *Store) ArchiveDevice(ctx context.Context, userID, deviceID string, inactiveDays int) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	st, err := s.checkArchivable(ctx, userID, deviceID, inactiveDays)
	if err != nil {
		return out, err
	}
	if st.archivedAt.Valid {
		out.Skipped = 1
		return out, nil
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE devices SET archived_at = ? WHERE id = ? AND user_id = ?`,
		nowMS(), deviceID, userID); err != nil {
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
func (s *Store) ArchiveDeviceRecords(ctx context.Context, userID, deviceID string, inactiveDays int) (ArchiveOutcome, error) {
	out := ArchiveOutcome{}
	// Same precondition as archiving the device itself: this is the "and its
	// records" half of retiring it, and it is no more reversible than that.
	if _, err := s.checkArchivable(ctx, userID, deviceID, inactiveDays); err != nil {
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

// humanAge is a short "3d ago" for the precondition's error message.
func humanAge(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}
