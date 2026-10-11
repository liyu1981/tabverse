package store

import (
	"context"
	"os"
	"strings"
)

// This is the store side of the ADR 0026 aggregation: a per-account counter
// cache the console reads without opening content files, marked dirty by every
// content write and recomputed by a background relay. Exact values (device and
// token counts) stay live in the central tables and are not cached here.

// DirtyUser is one account whose cached counters are stale.
type DirtyUser struct {
	ID string
	At int64
}

// markDirty records that an account's content changed. It is best-effort
// discovery, written after the content transaction commits: the periodic full
// sweep heals a lost marker, and a lost marker only makes the console lag a
// little longer (ADR 0026).
func (s *Store) markDirty(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO counter_dirty (user_id, at) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET at = excluded.at`, userID, nowMS())
	return err
}

// DirtyUsers returns up to limit accounts whose counters are stale, oldest
// first, so a busy account cannot starve a quiet one.
func (s *Store) DirtyUsers(ctx context.Context, limit int) ([]DirtyUser, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT user_id, at FROM counter_dirty ORDER BY at ASC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DirtyUser
	for rows.Next() {
		var d DirtyUser
		if err := rows.Scan(&d.ID, &d.At); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// RecomputeCounters recomputes one account's cached counters from its content
// file and clears the dirty marker that was current when the read began. A
// write that lands during the recompute bumps the marker past clearUpTo, so the
// account stays dirty and is recomputed again; the operation is idempotent.
func (s *Store) RecomputeCounters(ctx context.Context, userID string, clearUpTo int64) error {
	udb, release, err := s.contentDB(ctx, userID)
	if err != nil {
		return err
	}
	defer release()

	var rev, live, tombstones, archived, lastActivity int64
	if err := udb.db.QueryRowContext(ctx, `
		SELECT
			(SELECT rev_seq FROM user_meta WHERE user_id = ?),
			COALESCE(SUM(CASE WHEN deleted = 0 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN archived_at IS NOT NULL AND deleted = 0 THEN 1 ELSE 0 END), 0),
			COALESCE(MAX(CASE WHEN deleted = 0 THEN updated_at ELSE 0 END), 0)
		FROM records WHERE user_id = ?`, userID, userID).
		Scan(&rev, &live, &tombstones, &archived, &lastActivity); err != nil {
		return err
	}

	entities, err := udb.db.QueryContext(ctx,
		`SELECT entity, COUNT(*) FROM records WHERE user_id = ? AND deleted = 0 GROUP BY entity`, userID)
	if err != nil {
		return err
	}
	entityCounts := map[string]int{}
	for entities.Next() {
		var entity string
		var n int
		if err := entities.Scan(&entity, &n); err != nil {
			entities.Close()
			return err
		}
		entityCounts[entity] = n
	}
	entities.Close()
	if err := entities.Err(); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_counters
			(user_id, rev_seq, record_count, last_activity, live_records, tombstones, archived_records, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			rev_seq          = excluded.rev_seq,
			record_count     = excluded.record_count,
			last_activity    = excluded.last_activity,
			live_records     = excluded.live_records,
			tombstones       = excluded.tombstones,
			archived_records = excluded.archived_records,
			updated_at       = excluded.updated_at`,
		userID, rev, live, lastActivity, live, tombstones, archived, nowMS()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM user_entity_counts WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for entity, n := range entityCounts {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_entity_counts (user_id, entity, n) VALUES (?, ?, ?)`,
			userID, entity, n); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM counter_dirty WHERE user_id = ? AND at <= ?`, userID, clearUpTo); err != nil {
		return err
	}
	return tx.Commit()
}

// DrainDirtyCounters recomputes up to limit stale accounts. It returns how many
// it refreshed.
func (s *Store) DrainDirtyCounters(ctx context.Context, limit int) (int, error) {
	dirty, err := s.DirtyUsers(ctx, limit)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, d := range dirty {
		if err := s.RecomputeCounters(ctx, d.ID, d.At); err != nil {
			if IsBusy(err) {
				break
			}
			return n, err
		}
		n++
	}
	return n, nil
}

// RecomputeAllCounters refreshes every account's cache and reaps content files
// whose account is gone. It is the full sweep of ADR 0026: expensive enough to
// run on a long cadence, and the safety net for every lost dirty marker and
// failed file delete.
func (s *Store) RecomputeAllCounters(ctx context.Context) (int, error) {
	users, err := s.AllUserIDs(ctx)
	if err != nil {
		return 0, err
	}
	clearUpTo := nowMS()
	n := 0
	for _, id := range users {
		if err := s.RecomputeCounters(ctx, id, clearUpTo); err != nil {
			if IsBusy(err) {
				break
			}
			return n, err
		}
		n++
	}
	if _, err := s.SweepOrphans(ctx); err != nil {
		return n, err
	}
	return n, nil
}

// SweepOrphans removes content files with no central account - the file an
// interrupted account deletion leaves behind (ADR 0027). It returns how many
// files it removed.
func (s *Store) SweepOrphans(ctx context.Context) (int, error) {
	entries, err := os.ReadDir(s.users.dir)
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".db")
		var exists int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM users WHERE id = ?`, id).Scan(&exists); err != nil {
			return removed, err
		}
		if exists == 0 {
			if err := s.users.Delete(id); err != nil {
				return removed, err
			}
			removed++
		}
	}
	return removed, nil
}
