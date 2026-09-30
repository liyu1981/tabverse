package store

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
)

// This file holds the queries behind the admin API and the web console
// (adr/0009). The sync protocol itself stays user scoped and untouched: every
// function here takes an explicit userID, so the console can only ever look at
// one account at a time, exactly like a device token can.

// UserSummary is one row of the account list, with just enough counters for
// the console's user list to be useful without a second round trip.
type UserSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Email and Role are what the operator's directory is for: without them a
	// row is an opaque id, and "who is the other operator" is unanswerable.
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	RevSeq    int64     `json:"rev_seq"`
	// DeviceCount counts the user's devices, TokenCount the tokens that are
	// not revoked (i.e. usable).
	DeviceCount  int `json:"device_count"`
	TokenCount   int `json:"token_count"`
	RecordCount  int `json:"record_count"`
	RevokedCount int `json:"revoked_token_count"`
	// LastActivity is the newest updated_at among the user's live records, 0
	// when the account has never synced.
	LastActivity int64 `json:"last_activity"`
}

// ListUsers returns every account, oldest first, with its counters - the
// operator's directory. A query filters on the name or the address, which is
// what makes a list of accounts usable rather than a wall.
func (s *Store) ListUsers(ctx context.Context, query string) ([]UserSummary, error) {
	where := "1 = 1"
	args := []any{}
	if q := strings.ToLower(strings.TrimSpace(query)); q != "" {
		where = "(instr(lower(u.name), lower(?)) > 0 OR instr(lower(COALESCE(u.email, '')), lower(?)) > 0)"
		args = append(args, q, q)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.name, COALESCE(u.email, ''), COALESCE(u.role, 'user'), u.created_at, u.rev_seq,
		       (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id),
		       (SELECT COUNT(*) FROM tokens t WHERE t.user_id = u.id AND t.revoked = 0),
		       (SELECT COUNT(*) FROM tokens t WHERE t.user_id = u.id AND t.revoked = 1),
		       (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id AND r.deleted = 0),
		       COALESCE((SELECT MAX(r.updated_at) FROM records r
		                 WHERE r.user_id = u.id AND r.deleted = 0), 0)
		FROM users u WHERE `+where+` ORDER BY u.created_at ASC, u.id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []UserSummary{}
	for rows.Next() {
		var u UserSummary
		var createdAt int64
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &createdAt, &u.RevSeq,
			&u.DeviceCount, &u.TokenCount, &u.RevokedCount,
			&u.RecordCount, &u.LastActivity); err != nil {
			return nil, err
		}
		u.CreatedAt = unixMS(createdAt)
		out = append(out, u)
	}
	return out, rows.Err()
}

// UserStats counts one account's records per entity. Tombstones are part of
// the total but not of Live: they are what a client still has to download,
// not data.
type UserStats struct {
	UserID   string         `json:"user_id"`
	RevSeq   int64          `json:"rev_seq"`
	Total    int            `json:"total"`
	Live     int            `json:"live"`
	ByEntity map[string]int `json:"by_entity"`
}

// UserStats returns the per entity record counts of one account.
func (s *Store) UserStats(ctx context.Context, userID string) (UserStats, error) {
	out := UserStats{UserID: userID, ByEntity: map[string]int{}}
	if err := s.RequireUser(ctx, userID); err != nil {
		return out, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT entity, deleted, COUNT(*) FROM records
		WHERE user_id = ? GROUP BY entity, deleted`, userID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var entity string
		var deleted, n int
		if err := rows.Scan(&entity, &deleted, &n); err != nil {
			return out, err
		}
		out.ByEntity[entity] += n
		out.Total += n
		if deleted == 0 {
			out.Live += n
		}
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	rev, err := s.ServerRev(ctx, userID)
	if err != nil {
		return out, err
	}
	out.RevSeq = rev
	return out, nil
}

// RequireUser returns ErrNotFound when the account does not exist. The admin
// handlers use it so a typo in a user id is a 404 and not an empty listing.
func (s *Store) RequireUser(ctx context.Context, id string) error {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id = ?`, id).
		Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return ErrNotFound
	}
	return nil
}

// RenameUser sets the display name of an account.
func (s *Store) RenameUser(ctx context.Context, id, name string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE users SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUser removes an account together with everything that belongs to it.
// The records, devices, tokens and invites tables all declare
// ON DELETE CASCADE and foreign keys are enabled on the connection, so that is
// a single statement. The FTS index is not covered by those foreign keys (FTS5
// is a virtual table), so its rows go explicitly.
func (s *Store) DeleteUser(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM records_fts WHERE user_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// TokenInfo describes one issued device token. The hash is the full stored
// hash because that is what a revoke takes; the raw token was never stored, so
// the console can only show a short fingerprint of it.
type TokenInfo struct {
	Hash        string    `json:"hash"`
	Fingerprint string    `json:"fingerprint"`
	DeviceID    string    `json:"device_id"`
	DeviceName  string    `json:"device_name"`
	CreatedAt   time.Time `json:"created_at"`
	Revoked     bool      `json:"revoked"`
	LastUsed    int64     `json:"last_used"`
	// ArchivedAt is set when an operator retired this token from the console's
	// lists (ADR 0011). It is tidiness, not access: a revoked token stays
	// revoked, and an archived one is never re-enabled by unarchiving.
	ArchivedAt int64 `json:"archived_at"`
	Archived   bool  `json:"archived"`
}

// ListTokens returns a user's tokens, newest first.
func (s *Store) ListTokens(ctx context.Context, userID string) ([]TokenInfo, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.hash, t.device_id, COALESCE(d.name, ''), t.created_at, t.revoked,
		       COALESCE(t.last_used, 0), COALESCE(t.archived_at, 0)
		FROM tokens t LEFT JOIN devices d ON d.id = t.device_id
		WHERE t.user_id = ? ORDER BY t.created_at DESC, t.hash ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []TokenInfo{}
	for rows.Next() {
		var t TokenInfo
		var createdAt int64
		var revoked int
		if err := rows.Scan(&t.Hash, &t.DeviceID, &t.DeviceName, &createdAt,
			&revoked, &t.LastUsed, &t.ArchivedAt); err != nil {
			return nil, err
		}
		t.CreatedAt = unixMS(createdAt)
		t.Revoked = revoked != 0
		t.Archived = t.ArchivedAt != 0
		t.Fingerprint = fingerprint(t.Hash)
		out = append(out, t)
	}
	return out, rows.Err()
}

// fingerprint is what the console displays instead of a hash: the first 8 hex
// characters, enough to tell two devices' tokens apart.
func fingerprint(hash string) string {
	if len(hash) <= 8 {
		return hash
	}
	return hash[:8]
}

// RevokeToken marks one token unusable. The device keeps existing, which
// matters when a browser profile holds more than one token (the bootstrap
// device and a re-paired one).
func (s *Store) RevokeToken(ctx context.Context, userID, hash string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE tokens SET revoked = 1 WHERE user_id = ? AND hash = ?`, userID, hash)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RevokeDevice revokes every live token of a device and reports how many were.
// The device row itself is kept: its name is what the user recognizes in the
// console, and re-pairing creates a new id anyway.
func (s *Store) RevokeDevice(ctx context.Context, userID, deviceID string) (int, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE tokens SET revoked = 1 WHERE user_id = ? AND device_id = ? AND revoked = 0`,
		userID, deviceID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// Distinguish "no such device" from "device with nothing live left".
		var exists int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM devices WHERE id = ? AND user_id = ?`, deviceID, userID).
			Scan(&exists); err != nil {
			return 0, err
		}
		if exists == 0 {
			return 0, ErrNotFound
		}
	}
	return int(n), nil
}

// TouchToken records that a token authenticated a request, so the console can
// show when a device was last seen.
//
// It is throttled to one write per token per minute: a device that syncs every
// few seconds would otherwise turn every pull into an extra write on the one
// SQLite connection, and "last seen within a minute" is all a console can
// honestly display anyway. Failures are the caller's to ignore: this is
// telemetry, not authorization.
func (s *Store) TouchToken(ctx context.Context, hash string) error {
	const minInterval = 60_000 // ms
	now := nowMS()
	_, err := s.db.ExecContext(ctx,
		`UPDATE tokens SET last_used = ? WHERE hash = ? AND last_used < ?`,
		now, hash, now-minInterval)
	return err
}

// DeviceInfo is one paired device of an account.
type DeviceInfo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	// ActiveTokens counts the device's usable tokens; LastUsed is the newest
	// successful authentication of any of them.
	ActiveTokens int   `json:"active_tokens"`
	LastUsed     int64 `json:"last_used"`
	// ArchivedAt is set when an operator retired this device (ADR 0011): it
	// must have had no usable token left and been silent for a while.
	ArchivedAt int64 `json:"archived_at"`
	Archived   bool  `json:"archived"`
	// ArchivedRecords counts the live records this device last wrote that are
	// currently archived, so the console can offer the matching action.
	ArchivedRecords int `json:"archived_records"`
}

// ListDevices returns a user's devices, oldest first.
func (s *Store) ListDevices(ctx context.Context, userID string) ([]DeviceInfo, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT d.id, d.name, d.created_at,
		       (SELECT COUNT(*) FROM tokens t WHERE t.device_id = d.id AND t.revoked = 0),
		       COALESCE((SELECT MAX(t.last_used) FROM tokens t WHERE t.device_id = d.id), 0),
		       COALESCE(d.archived_at, 0),
		       (SELECT COUNT(*) FROM records r
		         WHERE r.user_id = d.user_id AND r.device_id = d.id
		           AND r.deleted = 0 AND r.archived_at IS NOT NULL)
		FROM devices d WHERE d.user_id = ?
		ORDER BY d.created_at ASC, d.id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DeviceInfo{}
	for rows.Next() {
		var d DeviceInfo
		var createdAt int64
		if err := rows.Scan(&d.ID, &d.Name, &createdAt, &d.ActiveTokens,
			&d.LastUsed, &d.ArchivedAt, &d.ArchivedRecords); err != nil {
			return nil, err
		}
		d.CreatedAt = unixMS(createdAt)
		d.Archived = d.ArchivedAt != 0
		out = append(out, d)
	}
	return out, rows.Err()
}

// RecordFilter narrows a console record listing. Zero values mean "no
// constraint".
type RecordFilter struct {
	// Entity is a single entity name, or empty for every entity.
	Entity string
	// TabspaceID restricts to the records of one tabverse. Only meaningful
	// for the entities that carry a tabSpaceId field.
	TabspaceID string
	// Query is a case insensitive substring match over the payload.
	Query string
	// IncludeDeleted adds the tombstones to the result.
	IncludeDeleted bool
	// IncludeArchived adds records an operator archived (ADR 0011). They are
	// hidden by default: archiving exists to keep the console's views about
	// live data, and the record is still synced to the user's devices either
	// way.
	IncludeArchived bool
	Limit           int
	Offset          int
}

// ListRecords returns a page of a user's records, newest first, plus the total
// number of rows the filter matches (for paging).
func (s *Store) ListRecords(ctx context.Context, userID string, f RecordFilter) ([]Record, int, error) {
	where := []string{"user_id = ?"}
	args := []any{userID}
	if f.Entity != "" {
		if err := ValidateEntity(f.Entity); err != nil {
			return nil, 0, err
		}
		where = append(where, "entity = ?")
		args = append(args, f.Entity)
	}
	if !f.IncludeDeleted {
		where = append(where, "deleted = 0")
	}
	if !f.IncludeArchived {
		where = append(where, "archived_at IS NULL")
	}
	if f.TabspaceID != "" {
		// Every entity except the aggregates carries a top level tabSpaceId;
		// a tabspace record *is* its own tabverse.
		if f.Entity == "tabspace" || f.Entity == "" {
			where = append(where, "(id = ? OR json_extract(payload, '$.tabSpaceId') = ?)")
			args = append(args, f.TabspaceID, f.TabspaceID)
		} else {
			where = append(where, "json_extract(payload, '$.tabSpaceId') = ?")
			args = append(args, f.TabspaceID)
		}
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		// instr() rather than LIKE: the query is a literal substring, not a
		// pattern, so a user typing % cannot turn the listing into a scan of
		// the whole account.
		where = append(where, "instr(lower(payload), lower(?)) > 0")
		args = append(args, q)
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM records`+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(ctx, `
		SELECT entity, id, device_id, rev, deleted, updated_at, payload, server_at
		FROM records`+clause+` ORDER BY updated_at DESC, entity ASC, id ASC LIMIT ? OFFSET ?`,
		pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []Record{}
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *rec)
	}
	return out, total, rows.Err()
}

// TabspaceSummary is one row of the console's tabverse list: the stored record
// plus the few derived numbers the list view shows.
type TabspaceSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	Rev       int64  `json:"rev"`
	// TabCount is len(tabIds) of the stored payload, the tabverse's own
	// ordering of its tabs; Groups counts its tab groups.
	TabCount int `json:"tab_count"`
	Groups   int `json:"groups"`
	// Notes/Todos/Bookmarks/ClosedTabs are counted live, not from the
	// aggregates: the console wants the totals, the ordering is the client's
	// business (see GetTabspaceBundle).
	Notes      int `json:"notes"`
	Todos      int `json:"todos"`
	Bookmarks  int `json:"bookmarks"`
	ClosedTabs int `json:"closed_tabs"`
}

// ListTabspaces returns the user's tabverses, newest first. Archived tabverses
// are hidden unless includeArchived is set (ADR 0011).
func (s *Store) ListTabspaces(ctx context.Context, userID, query string, includeArchived bool, limit, offset int) ([]TabspaceSummary, int, error) {
	where := []string{"r.user_id = ?", "r.entity = 'tabspace'", "r.deleted = 0"}
	args := []any{userID}
	if !includeArchived {
		where = append(where, "r.archived_at IS NULL")
	}
	if q := strings.TrimSpace(query); q != "" {
		where = append(where, "instr(lower(r.payload), lower(?)) > 0")
		args = append(args, q)
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM records r`+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	childCount := func(entity string) string {
		// The same visibility rule as the row itself, so a tabverse's card
		// never counts tabs the list beside it is hiding.
		visible := "1 = 1"
		if !includeArchived {
			visible = "n.archived_at IS NULL"
		}
		return `(SELECT COUNT(*) FROM records n
		         WHERE n.user_id = r.user_id AND n.entity = '` + entity + `' AND n.deleted = 0
		           AND ` + visible + `
		           AND json_extract(n.payload, '$.tabSpaceId') = r.id)`
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.entity, r.id, r.device_id, r.rev, r.deleted, r.updated_at, r.payload, r.server_at,
		       `+childCount("note")+`, `+childCount("todo")+`, `+childCount("bookmark")+`,
		       `+childCount("closedtab")+`
		FROM records r`+clause+` ORDER BY r.updated_at DESC, r.id ASC LIMIT ? OFFSET ?`,
		pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []TabspaceSummary{}
	for rows.Next() {
		// The row carries the record columns plus the four child counts, so
		// it is scanned in one go rather than through scanRecord.
		var rec Record
		var deleted int
		var sum TabspaceSummary
		var notes, todos, bookmarks, closed int
		if err := rows.Scan(&rec.Entity, &rec.ID, &rec.DeviceID, &rec.Rev, &deleted,
			&rec.UpdatedAt, &rec.Payload, &rec.ServerAt,
			&notes, &todos, &bookmarks, &closed); err != nil {
			return nil, 0, err
		}
		sum = tabspaceSummaryOf(rec)
		sum.Notes, sum.Todos, sum.Bookmarks, sum.ClosedTabs = notes, todos, bookmarks, closed
		out = append(out, sum)
	}
	return out, total, rows.Err()
}

// tabspaceSummaryOf derives the display fields of one tabverse from its stored
// payload. The payload is the client's own document (adr/0001): the server
// reads a few fields out of it and ignores the rest, and a payload without them
// yields a nameless, empty tabverse rather than an error - the console has to
// be able to show a half written record.
func tabspaceSummaryOf(rec Record) TabspaceSummary {
	out := TabspaceSummary{ID: rec.ID, Rev: rec.Rev, UpdatedAt: rec.UpdatedAt}
	var payload struct {
		Name      string   `json:"name"`
		CreatedAt int64    `json:"createdAt"`
		TabIDs    []string `json:"tabIds"`
		TabGroups []struct {
			ID string `json:"id"`
		} `json:"tabGroups"`
	}
	if err := decodePayload(rec.Payload, &payload); err != nil {
		out.Name = "(unreadable)"
		return out
	}
	out.Name = payload.Name
	if out.Name == "" {
		out.Name = "(untitled)"
	}
	out.CreatedAt = payload.CreatedAt
	out.TabCount = len(payload.TabIDs)
	out.Groups = len(payload.TabGroups)
	return out
}

// BundleRow is one record of a tabverse with its payload decoded into a
// generic document, so the console renders it without parsing JSON strings.
type BundleRow struct {
	ID        string `json:"id"`
	Rev       int64  `json:"rev"`
	UpdatedAt int64  `json:"updated_at"`
	ServerAt  int64  `json:"server_at"`
	// Position is the index in the client's own ordering (tabIds for tabs,
	// the allnote/alltodo/allbookmark aggregates for the rest).
	Position int            `json:"position"`
	Data     map[string]any `json:"data"`
}

// TabspaceBundle is everything the console shows for one tabverse.
type TabspaceBundle struct {
	Tabspace TabspaceSummary `json:"tabspace"`
	// TabspaceData is the tabverse's own payload, decoded. The console needs
	// the raw document rather than the summary because that is where the tab
	// groups live.
	TabspaceData map[string]any `json:"tabspace_data"`
	Tabs         []BundleRow    `json:"tabs"`
	Notes        []BundleRow    `json:"notes"`
	Todos        []BundleRow    `json:"todos"`
	Bookmarks    []BundleRow    `json:"bookmarks"`
	ClosedTabs   []BundleRow    `json:"closed_tabs"`
	// Aggregates carries the raw allnote/alltodo/allbookmark payloads, which
	// is where the display order lives.
	Aggregates map[string]string `json:"aggregates"`
}

// GetTabspaceBundle assembles the read only view of one tabverse.
//
// Order matters to this UI, because the user's ordering lives in the client:
// the aggregates (allnote, alltodo, allbookmark) are read first and the
// entities are then sorted by their position in those lists. Rows an aggregate
// does not mention (written after it, or a client that never sent one) sort
// after the listed ones, so nothing is silently hidden from the console.
func (s *Store) GetTabspaceBundle(ctx context.Context, userID, tabspaceID string) (TabspaceBundle, error) {
	rec, err := s.GetRecord(ctx, userID, "tabspace", tabspaceID)
	if err != nil {
		return TabspaceBundle{}, err
	}
	bundle := TabspaceBundle{
		Tabspace:     tabspaceSummaryOf(rec),
		TabspaceData: map[string]any{},
		Tabs:         []BundleRow{},
		Notes:        []BundleRow{},
		Todos:        []BundleRow{},
		Bookmarks:    []BundleRow{},
		ClosedTabs:   []BundleRow{},
		Aggregates:   map[string]string{},
	}
	_ = decodePayload(rec.Payload, &bundle.TabspaceData)

	// The tabverse's own tabIds list is the tab ordering; a tab that is not
	// in it (or a tabverse stored without one) falls back to id order.
	var tabspacePayload struct {
		TabIDs []string `json:"tabIds"`
	}
	_ = decodePayload(rec.Payload, &tabspacePayload)

	rows, err := s.recordsOfTabspace(ctx, userID, tabspaceID, false,
		[]string{"tab", "note", "todo", "bookmark", "closedtab",
			"allnote", "alltodo", "allbookmark"})
	if err != nil {
		return bundle, err
	}
	byEntity := map[string][]Record{}
	for _, r := range rows {
		byEntity[r.Entity] = append(byEntity[r.Entity], r)
	}
	// The summary's child counters come from the rows just read, so the detail
	// view and the tabverse list agree.
	bundle.Tabspace.Notes = len(byEntity["note"])
	bundle.Tabspace.Todos = len(byEntity["todo"])
	bundle.Tabspace.Bookmarks = len(byEntity["bookmark"])
	bundle.Tabspace.ClosedTabs = len(byEntity["closedtab"])

	// Aggregates: the client's own ordering lists. The id list key differs per
	// entity - noteIds / todoIds / bookmarkIds (see
	// src/data/{note,todo,bookmark}/All*.ts), which is also why the FTS
	// index excludes them. The map is keyed by the *entity* the order applies
	// to, not by the aggregate's own name.
	positions := map[string]map[string]int{}
	for _, aggregate := range []struct{ entity, aggregateEntity, key string }{
		{entity: "note", aggregateEntity: "allnote", key: "noteIds"},
		{entity: "todo", aggregateEntity: "alltodo", key: "todoIds"},
		{entity: "bookmark", aggregateEntity: "allbookmark", key: "bookmarkIds"},
	} {
		recs := byEntity[aggregate.aggregateEntity]
		if len(recs) == 0 {
			continue
		}
		bundle.Aggregates[aggregate.aggregateEntity] = recs[0].Payload
		// The key is per entity, so decode into a generic document first.
		var doc map[string]any
		if err := decodePayload(recs[0].Payload, &doc); err != nil {
			continue
		}
		positions[aggregate.entity] = map[string]int{}
		for i, id := range stringList(doc[aggregate.key]) {
			positions[aggregate.entity][id] = i
		}
	}

	groups := []struct {
		entity string
		order  []string
		out    *[]BundleRow
	}{
		{entity: "tab", order: tabspacePayload.TabIDs, out: &bundle.Tabs},
		{entity: "note", out: &bundle.Notes},
		{entity: "todo", out: &bundle.Todos},
		{entity: "bookmark", out: &bundle.Bookmarks},
	}
	for _, g := range groups {
		rank := rankOf(g.order, positions[g.entity])
		recs := byEntity[g.entity]
		sortRecordsByPosition(recs, rank)
		for _, r := range recs {
			*g.out = append(*g.out, bundleRowOf(r, rank(r.ID)))
		}
	}

	// History: the History tool has no aggregate, its order is the row's own
	// closedAt, newest first.
	closed := byEntity["closedtab"]
	sort.SliceStable(closed, func(i, j int) bool {
		return jsonNumber(closed[i].Payload, "closedAt") > jsonNumber(closed[j].Payload, "closedAt")
	})
	for _, r := range closed {
		bundle.ClosedTabs = append(bundle.ClosedTabs, bundleRowOf(r, len(bundle.ClosedTabs)))
	}
	return bundle, nil
}

// stringList coerces a decoded JSON array of ids into []string. A malformed
// aggregate yields an empty order rather than an error: the console then falls
// back to id order instead of showing nothing.
func stringList(v any) []string {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// rankOf builds the id -> position lookup for one entity. The aggregate wins
// over the tabverse's own list (that is the entity's authoritative order); rows
// no list mentions get a position after all the listed ones, ordered by id so
// the result is stable.
func rankOf(order []string, aggregate map[string]int) func(string) int {
	pos := aggregate
	if pos == nil {
		pos = make(map[string]int, len(order))
		for i, id := range order {
			pos[id] = i
		}
	}
	unlisted := len(pos)
	return func(id string) int {
		if p, ok := pos[id]; ok {
			return p
		}
		return unlisted
	}
}

// recordsOfTabspace reads every live record hanging off one tabverse, plus the
// tabverse record itself (matched by id, since its own tabSpaceId is unset).
func (s *Store) recordsOfTabspace(ctx context.Context, userID, tabspaceID string, includeArchived bool, entities []string) ([]Record, error) {
	// Argument order has to follow the query: user, the entity list, then the
	// tabspace id twice (payload and id).
	args := []any{userID}
	placeholders := make([]string, len(entities))
	for i, e := range entities {
		placeholders[i] = "?"
		args = append(args, e)
	}
	args = append(args, tabspaceID, tabspaceID)
	visible := "1 = 1"
	if !includeArchived {
		visible = "archived_at IS NULL"
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT entity, id, device_id, rev, deleted, updated_at, payload, server_at
		FROM records
		WHERE user_id = ? AND deleted = 0 AND `+visible+`
		  AND entity IN (`+strings.Join(placeholders, ",")+`)
		  AND (json_extract(payload, '$.tabSpaceId') = ? OR id = ?)
		ORDER BY entity ASC, id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Record
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		if rec.Entity == "tabspace" && rec.ID != tabspaceID {
			continue
		}
		out = append(out, *rec)
	}
	return out, rows.Err()
}

func bundleRowOf(rec Record, position int) BundleRow {
	row := BundleRow{
		ID: rec.ID, Rev: rec.Rev, UpdatedAt: rec.UpdatedAt,
		ServerAt: rec.ServerAt, Position: position,
		Data: map[string]any{},
	}
	if err := decodePayload(rec.Payload, &row.Data); err != nil {
		row.Data = map[string]any{"_raw": rec.Payload}
	}
	return row
}

// sortRecordsByPosition is a stable sort by an id -> position function. The
// comparator costs a lookup per comparison, so this is O(n log n) map reads:
// these lists are per tabverse (tens of rows), not account sized.
func sortRecordsByPosition(recs []Record, rank func(string) int) {
	sort.SliceStable(recs, func(i, j int) bool {
		ri, rj := rank(recs[i].ID), rank(recs[j].ID)
		if ri == rj {
			return recs[i].ID < recs[j].ID
		}
		return ri < rj
	})
}

// jsonNumber reads a numeric field out of a payload, returning 0 when the
// payload is not an object or the field is missing or not a number.
func jsonNumber(payload, field string) int64 {
	var doc map[string]any
	if err := decodePayload(payload, &doc); err != nil {
		return 0
	}
	switch n := doc[field].(type) {
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return 0
		}
		return i
	case float64:
		return int64(n)
	default:
		return 0
	}
}

// decodePayload unmarshals a client document, keeping numbers exact (client
// timestamps are unix milliseconds and must not lose precision in a float).
func decodePayload(payload string, dst any) error {
	if strings.TrimSpace(payload) == "" {
		return errors.New("empty payload")
	}
	dec := json.NewDecoder(strings.NewReader(payload))
	dec.UseNumber()
	return dec.Decode(dst)
}

// Totals is deployment wide counters for the console header.
type Totals struct {
	Users        int            `json:"users"`
	Devices      int            `json:"devices"`
	ActiveTokens int            `json:"active_tokens"`
	LiveRecords  int            `json:"live_records"`
	Tombstones   int            `json:"tombstones"`
	ByEntity     map[string]int `json:"by_entity"`
	// Archived* are the operator's retired rows (ADR 0011). They are still
	// counted in LiveRecords: archiving hides a record from the console, it
	// does not unstore it.
	ArchivedDevices int `json:"archived_devices"`
	ArchivedTokens  int `json:"archived_tokens"`
	ArchivedRecords int `json:"archived_records"`
}

// Totals returns the deployment wide counters.
func (s *Store) Totals(ctx context.Context) (Totals, error) {
	out := Totals{ByEntity: map[string]int{}}
	scalar := func(query string, dst *int) error {
		return s.db.QueryRowContext(ctx, query).Scan(dst)
	}
	if err := scalar(`SELECT COUNT(*) FROM users`, &out.Users); err != nil {
		return out, err
	}
	if err := scalar(`SELECT COUNT(*) FROM devices`, &out.Devices); err != nil {
		return out, err
	}
	if err := scalar(`SELECT COUNT(*) FROM tokens WHERE revoked = 0`, &out.ActiveTokens); err != nil {
		return out, err
	}
	if err := scalar(`SELECT COUNT(*) FROM records WHERE deleted = 0`, &out.LiveRecords); err != nil {
		return out, err
	}
	if err := scalar(`SELECT COUNT(*) FROM records WHERE deleted = 1`, &out.Tombstones); err != nil {
		return out, err
	}
	if err := scalar(`SELECT COUNT(*) FROM devices WHERE archived_at IS NOT NULL`, &out.ArchivedDevices); err != nil {
		return out, err
	}
	if err := scalar(`SELECT COUNT(*) FROM tokens WHERE archived_at IS NOT NULL`, &out.ArchivedTokens); err != nil {
		return out, err
	}
	if err := scalar(`SELECT COUNT(*) FROM records WHERE archived_at IS NOT NULL AND deleted = 0`, &out.ArchivedRecords); err != nil {
		return out, err
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT entity, COUNT(*) FROM records WHERE deleted = 0 GROUP BY entity`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var entity string
		var n int
		if err := rows.Scan(&entity, &n); err != nil {
			return out, err
		}
		out.ByEntity[entity] = n
	}
	return out, rows.Err()
}

// AdminSearch is SearchHit plus the payload, for the console's global search
// across an account: the hits have to render the record itself, and the
// snippets alone are not enough to draw a tabverse list.
type AdminSearchHit struct {
	SearchHit
	Title string `json:"title"`
	URL   string `json:"url"`
}

// SearchFor is Search for the console: same FTS query, scoped to one account,
// with a title extracted from the payload for display. Read only, it does not
// need a device token, only the admin one.
func (s *Store) SearchFor(ctx context.Context, userID, query, entity string, limit int, includeArchived bool) ([]AdminSearchHit, error) {
	if err := s.RequireUser(ctx, userID); err != nil {
		return nil, err
	}
	// The console's view of the account, so it follows the same visibility rule
	// as its listings: a record retired from the default views should not turn
	// up in a search either (ADR 0011).
	hits, err := s.search(ctx, userID, query, entity, limit, includeArchived)
	if err != nil {
		return nil, err
	}
	out := make([]AdminSearchHit, 0, len(hits))
	for _, h := range hits {
		hit := AdminSearchHit{SearchHit: h}
		rec, err := s.GetRecord(ctx, userID, h.Entity, h.ID)
		if err != nil {
			// The index row outlived the record (retention tombstoned it in a
			// racing sweep): still report the hit, just without a title.
			out = append(out, hit)
			continue
		}
		hit.Title, hit.URL = displayTitle(h.Entity, h.ID, rec.Payload)
		out = append(out, hit)
	}
	return out, nil
}

// displayTitle picks the human label of a record, mirroring the field each
// entity uses in the extension (see src/data/*/*.ts). A record without a
// title field (a session snapshot, a malformed payload) falls back to its id,
// which is what the raw view shows anyway.
func displayTitle(entity, id, payload string) (title, url string) {
	var doc map[string]any
	if err := decodePayload(payload, &doc); err != nil {
		return "", ""
	}
	str := func(key string) string {
		if v, ok := doc[key].(string); ok {
			return v
		}
		return ""
	}
	switch entity {
	case "tabspace":
		title = str("name")
	case "tab", "closedtab":
		title, url = str("title"), str("url")
	case "note":
		title = str("name")
	case "todo":
		title = str("content")
	case "bookmark":
		title, url = str("name"), str("url")
	}
	if title == "" {
		title = entity + " " + id
	}
	return title, url
}
