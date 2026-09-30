package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

func unixMS(ms int64) time.Time { return time.UnixMilli(ms).UTC() }

// ApplyRecords is the single write path of the sync protocol.
//
// Conflict policy is last-writer-wins on Record.UpdatedAt (client clock,
// unix ms): an incoming record older than the stored one is rejected with
// StatusStale and the current server copy attached, so the client can merge
// without another round trip. Replays with identical content are idempotent
// and do not consume a new revision.
//
// Returns the per record results plus the user's revision sequence after the
// transaction.
func (s *Store) ApplyRecords(
	ctx context.Context,
	userID, deviceID string,
	inputs []RecordInput,
	maxBytes int64,
) ([]RecordResult, int64, error) {
	results := make([]RecordResult, 0, len(inputs))

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()

	for _, in := range inputs {
		if err := ValidateEntity(in.Entity); err != nil {
			return nil, 0, err
		}
		if in.ID == "" {
			return nil, 0, fmt.Errorf("record id must not be empty")
		}
		if maxBytes > 0 && int64(len(in.Payload)) > maxBytes {
			return nil, 0, fmt.Errorf("record %s/%s payload exceeds %d bytes", in.Entity, in.ID, maxBytes)
		}

		cur, err := getRecordTx(ctx, tx, userID, in.Entity, in.ID)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return nil, 0, err
		}

		if err == nil { // existing row
			if cur.UpdatedAt > in.UpdatedAt {
				// Server copy is newer: reject, hand the conflict back.
				results = append(results, RecordResult{
					Entity: in.Entity, ID: in.ID, Status: StatusStale,
					Rev: cur.Rev, UpdatedAt: cur.UpdatedAt, Current: cur,
				})
				continue
			}
			if cur.UpdatedAt == in.UpdatedAt &&
				cur.Deleted == in.Deleted &&
				cur.Payload == in.Payload {
				// Idempotent replay (client retried after a lost response).
				results = append(results, RecordResult{
					Entity: in.Entity, ID: in.ID, Status: StatusOK,
					Rev: cur.Rev, UpdatedAt: cur.UpdatedAt,
				})
				continue
			}
		}

		rev, err := nextRev(ctx, tx, userID)
		if err != nil {
			return nil, 0, err
		}
		payload := in.Payload
		if in.Deleted {
			payload = ""
		}
		rec := Record{
			Entity: in.Entity, ID: in.ID, DeviceID: deviceID, Rev: rev,
			Deleted: in.Deleted, UpdatedAt: in.UpdatedAt, Payload: payload,
			ServerAt: nowMS(),
		}
		// The INSERT above clears archived_at on every accepted write: a record
		// somebody just changed is live again, so an operator's archive of it
		// (ADR 0011) no longer describes reality. Otherwise archiving a device
		// would permanently hide the user's tabverses just for being edited on
		// another device.
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO records (user_id, entity, id, device_id, rev, deleted, updated_at, payload, server_at, archived_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
			ON CONFLICT(user_id, entity, id) DO UPDATE SET
				device_id = excluded.device_id,
				rev = excluded.rev,
				deleted = excluded.deleted,
				updated_at = excluded.updated_at,
				payload = excluded.payload,
				server_at = excluded.server_at,
				archived_at = NULL`,
			userID, rec.Entity, rec.ID, rec.DeviceID, rec.Rev,
			boolToInt(rec.Deleted), rec.UpdatedAt, rec.Payload, rec.ServerAt,
		); err != nil {
			return nil, 0, err
		}
		if err := ftsReplace(ctx, tx, userID, rec); err != nil {
			return nil, 0, err
		}
		results = append(results, RecordResult{
			Entity: in.Entity, ID: in.ID, Status: StatusOK,
			Rev: rec.Rev, UpdatedAt: rec.UpdatedAt,
		})
	}

	var serverRev int64
	if err := tx.QueryRowContext(ctx,
		`SELECT rev_seq FROM users WHERE id = ?`, userID).Scan(&serverRev); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return results, serverRev, nil
}

// PullRecords returns records with rev > since, oldest first, plus a
// hasMore flag for pagination.
func (s *Store) PullRecords(ctx context.Context, userID string, since int64, limit int) ([]Record, bool, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT entity, id, device_id, rev, deleted, updated_at, payload, server_at
		FROM records WHERE user_id = ? AND rev > ? ORDER BY rev ASC LIMIT ?`,
		userID, since, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	out := make([]Record, 0, limit)
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, *rec)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > limit {
		out = out[:limit]
		return out, true, nil
	}
	return out, false, nil
}

// GetRecord fetches one record (tombstones included, the client needs them).
func (s *Store) GetRecord(ctx context.Context, userID, entity, id string) (Record, error) {
	rec, err := getRecordTx(ctx, s.db, userID, entity, id)
	if err != nil {
		return Record{}, err
	}
	return *rec, nil
}

// PruneOlderThan tombstones records of a prunable entity older than cutoffMS.
// Tombstones (instead of hard deletes) so every client learns about the
// removal through the normal delta sync.
func (s *Store) PruneOlderThan(ctx context.Context, userID, entity string, cutoffMS int64) (int, error) {
	if !PrunableEntities[entity] {
		return 0, fmt.Errorf("entity %q is not prunable", entity)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id, updated_at, payload FROM records
		WHERE user_id = ? AND entity = ? AND deleted = 0 AND updated_at < ?`,
		userID, entity, cutoffMS)
	if err != nil {
		return 0, err
	}
	type victim struct{ id, payload string }
	var victims []victim
	for rows.Next() {
		var v victim
		var updatedAt int64
		if err := rows.Scan(&v.id, &updatedAt, &v.payload); err != nil {
			rows.Close()
			return 0, err
		}
		victims = append(victims, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, v := range victims {
		rev, err := nextRev(ctx, tx, userID)
		if err != nil {
			return 0, err
		}
		rec := Record{
			Entity: entity, ID: v.id, Rev: rev, Deleted: true,
			UpdatedAt: nowMS(), ServerAt: nowMS(),
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE records SET device_id = '', rev = ?, deleted = 1, updated_at = ?, payload = '', server_at = ?
			WHERE user_id = ? AND entity = ? AND id = ?`,
			rec.Rev, rec.UpdatedAt, rec.ServerAt, userID, entity, v.id); err != nil {
			return 0, err
		}
		if err := ftsReplace(ctx, tx, userID, rec); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(victims), nil
}

type rowScanner interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func getRecordTx(ctx context.Context, q rowScanner, userID, entity, id string) (*Record, error) {
	var rec Record
	var deleted int
	err := q.QueryRowContext(ctx, `
		SELECT entity, id, device_id, rev, deleted, updated_at, payload, server_at
		FROM records WHERE user_id = ? AND entity = ? AND id = ?`,
		userID, entity, id).
		Scan(&rec.Entity, &rec.ID, &rec.DeviceID, &rec.Rev, &deleted,
			&rec.UpdatedAt, &rec.Payload, &rec.ServerAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rec.Deleted = deleted != 0
	return &rec, nil
}

func scanRecord(rows *sql.Rows) (*Record, error) {
	var rec Record
	var deleted int
	if err := rows.Scan(&rec.Entity, &rec.ID, &rec.DeviceID, &rec.Rev, &deleted,
		&rec.UpdatedAt, &rec.Payload, &rec.ServerAt); err != nil {
		return nil, err
	}
	rec.Deleted = deleted != 0
	return &rec, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nonContentKeys are JSON fields that hold identifiers, not content. Indexing
// them would let a search for a tabverse id match every record that hangs off
// it, and they show up in the highlighted snippets.
var nonContentKeys = map[string]bool{
	"id": true, "tabSpaceId": true, "version": true,
	"tabIds": true, "todoIds": true, "noteIds": true, "bookmarkIds": true,
}

// ftsBody derives the indexed text for a record: all JSON strings are
// concatenated (titles, urls, tags, note bodies ...), which is exactly what
// a tab manager user expects to be searchable. Ids are left out, see
// nonContentKeys.
//
// Records indexed before this rule keep their old body until they are written
// again, which is harmless: the ids only ever add noise, never a false hit on
// content the user cannot see.
func ftsBody(payload string) string {
	if payload == "" {
		return ""
	}
	var v any
	if err := json.Unmarshal([]byte(payload), &v); err != nil {
		return payload // not JSON: index raw content
	}
	var b []byte
	collectStrings(v, &b, "")
	return string(b)
}

func collectStrings(v any, out *[]byte, key string) {
	switch t := v.(type) {
	case string:
		if nonContentKeys[key] {
			return
		}
		*out = append(*out, t...)
		*out = append(*out, ' ')
	case []any:
		for _, item := range t {
			collectStrings(item, out, key)
		}
	case map[string]any:
		for field, item := range t {
			collectStrings(item, out, field)
		}
	}
}

// ftsReplace keeps records_fts in sync inside the caller's transaction.
func ftsReplace(ctx context.Context, tx *sql.Tx, userID string, rec Record) error {
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM records_fts WHERE user_id = ? AND entity = ? AND record_id = ?`,
		userID, rec.Entity, rec.ID); err != nil {
		return err
	}
	body := ftsBody(rec.Payload)
	if rec.Deleted || body == "" || !IndexedEntities[rec.Entity] {
		return nil
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO records_fts (entity, user_id, record_id, body) VALUES (?, ?, ?, ?)`,
		rec.Entity, userID, rec.ID, body)
	return err
}
