package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

// The console's queries are exercised end to end in internal/api's tests; what
// is worth pinning down here is the store level behaviour they rely on: the
// additive migration has to survive reopening a database, and deleting an
// account has to take its FTS rows with it.

func TestMigrationIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "twice.db")
	// Reopening must be a no-op: the additive ALTER is attempted again and its
	// duplicate column error swallowed.
	st, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := st.CreateUser(context.Background(), "usr_a", "a"); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer reopened.Close()
	if n, err := reopened.CountUsers(context.Background()); err != nil || n != 1 {
		t.Fatalf("users after reopen = %d (%v), want 1", n, err)
	}
	// The column the console reads still works after the migration ran twice.
	if err := reopened.TouchToken(context.Background(), "nothing"); err != nil {
		t.Fatalf("touch token: %v", err)
	}
}

func TestDeleteUserTakesItsSearchRows(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	alice := mustCreateUser(t, st, "alice")
	bob := mustCreateUser(t, st, "bob")
	now := int64(1700000000000)

	records := []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now,
			Payload: `{"id":"ts1","name":"secret project","tabIds":[]}`},
		{Entity: "note", ID: "n1", UpdatedAt: now + 1,
			Payload: `{"id":"n1","tabSpaceId":"ts1","name":"secret","data":"classified"}`},
	}
	if _, _, err := st.ApplyRecords(ctx, alice, "dev_1", records, 1<<20); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if _, _, err := st.ApplyRecords(ctx, bob, "dev_2", []RecordInput{
		{Entity: "note", ID: "n2", UpdatedAt: now, Payload: `{"name":"secret of bob"}`},
	}, 1<<20); err != nil {
		t.Fatalf("apply bob: %v", err)
	}

	// Both accounts are findable before the delete.
	for _, userID := range []string{alice, bob} {
		hits, err := st.Search(ctx, userID, "secret", "", 10)
		if err != nil || len(hits) == 0 {
			t.Fatalf("search for %s: err=%v hits=%d", userID, err, len(hits))
		}
	}

	if err := st.DeleteUser(ctx, alice); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := st.RequireUser(ctx, alice); err == nil {
		t.Fatal("the account should be gone")
	}
	hits, err := st.Search(ctx, alice, "secret", "", 10)
	if err != nil {
		t.Fatalf("search after delete: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("the deleted account's index rows survived: %+v", hits)
	}
	// Bob's own hit is untouched: the delete is scoped by user_id.
	hits, err = st.Search(ctx, bob, "secret", "", 10)
	if err != nil || len(hits) != 1 {
		t.Fatalf("bob's data was affected: err=%v hits=%d", err, len(hits))
	}

	// The records themselves are gone, not just the index.
	recs, _, err := st.ListRecords(ctx, alice, RecordFilter{IncludeDeleted: true})
	if err != nil {
		t.Fatalf("list records: %v", err)
	}
	if len(recs) != 0 {
		t.Fatalf("records survived the account delete: %+v", recs)
	}
}

func TestUserStatsAndTotals(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	alice := mustCreateUser(t, st, "alice")
	now := int64(1700000000000)
	if _, _, err := st.ApplyRecords(ctx, alice, "dev_1", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"name":"a"}`},
		{Entity: "note", ID: "n1", UpdatedAt: now + 1, Payload: `{"name":"b"}`},
		{Entity: "note", ID: "n2", UpdatedAt: now + 2, Payload: `{"name":"c"}`},
		{Entity: "note", ID: "n3", UpdatedAt: now + 3, Payload: `{"name":"d"}`, Deleted: true},
	}, 1<<20); err != nil {
		t.Fatalf("apply: %v", err)
	}

	stats, err := st.UserStats(ctx, alice)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.Live != 3 || stats.Total != 4 {
		t.Fatalf("live/total = %d/%d, want 3/4", stats.Live, stats.Total)
	}
	if stats.ByEntity["note"] != 3 || stats.ByEntity["tabspace"] != 1 {
		t.Fatalf("by entity = %v", stats.ByEntity)
	}
	if stats.RevSeq != 4 {
		t.Fatalf("rev seq = %d, want 4", stats.RevSeq)
	}

	totals, err := st.Totals(ctx)
	if err != nil {
		t.Fatalf("totals: %v", err)
	}
	if totals.Users != 1 || totals.LiveRecords != 3 || totals.Tombstones != 1 {
		t.Fatalf("unexpected totals: %+v", totals)
	}

	// An unknown account is an error, not an empty report: the console turns
	// it into a 404 instead of a blank page.
	if _, err := st.UserStats(ctx, "usr_nope"); err == nil {
		t.Fatal("stats for an unknown account should fail")
	}
}

// The console's one write over user data (adr/0015): deleting a tabverse has
// to remove the whole tabverse, and it has to do it as tombstones so the
// devices learn about it instead of pushing the rows straight back.
func TestDeleteTabspaceTombstonesTheWholeTabverse(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	alice := mustCreateUser(t, st, "alice")
	bob := mustCreateUser(t, st, "bob")
	now := int64(1700000000000)

	seed := []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now,
			Payload: `{"id":"ts1","name":"Research","tabIds":["t1","t2"]}`},
		{Entity: "tab", ID: "t1", UpdatedAt: now + 1,
			Payload: `{"id":"t1","tabSpaceId":"ts1","title":"Alpha","url":"https://a.example/"}`},
		{Entity: "tab", ID: "t2", UpdatedAt: now + 2,
			Payload: `{"id":"t2","tabSpaceId":"ts1","title":"Beta","url":"https://b.example/"}`},
		{Entity: "note", ID: "n1", UpdatedAt: now + 3,
			Payload: `{"id":"n1","tabSpaceId":"ts1","name":"note","data":"x"}`},
		{Entity: "allnote", ID: "ts1:allnote", UpdatedAt: now + 4,
			Payload: `{"id":"ts1:allnote","tabSpaceId":"ts1","noteIds":["n1"]}`},
		// another tabverse of the same account
		{Entity: "tabspace", ID: "ts2", UpdatedAt: now,
			Payload: `{"id":"ts2","name":"Other","tabIds":[]}`},
	}
	if _, _, err := st.ApplyRecords(ctx, alice, "dev_1", seed, 1<<20); err != nil {
		t.Fatalf("apply alice: %v", err)
	}
	if _, _, err := st.ApplyRecords(ctx, bob, "dev_1", []RecordInput{
		{Entity: "tabspace", ID: "ts_bob", UpdatedAt: now, Payload: `{"id":"ts_bob","name":"Bob","tabIds":[]}`},
	}, 1<<20); err != nil {
		t.Fatalf("apply bob: %v", err)
	}

	res, err := st.DeleteTabspace(ctx, alice, "ts1", "", now+100, 1<<20)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	// the tabverse, its two tabs, its note and its aggregate
	if res.Tombstoned != 5 {
		t.Fatalf("tombstoned %d records, want 5 (entities %v)", res.Tombstoned, res.Entities)
	}
	if res.ServerRev == 0 {
		t.Fatal("the delete reported no revision")
	}

	// every record of the tabverse is a tombstone with an empty payload, which
	// is what a device reads to delete its own row
	for _, row := range []struct{ entity, id string }{
		{"tabspace", "ts1"}, {"tab", "t1"}, {"tab", "t2"},
		{"note", "n1"}, {"allnote", "ts1:allnote"},
	} {
		rec, err := st.GetRecord(ctx, alice, row.entity, row.id)
		if err != nil {
			t.Fatalf("get %s/%s: %v", row.entity, row.id, err)
		}
		if !rec.Deleted || rec.Payload != "" {
			t.Fatalf("%s/%s survived the delete: %+v", row.entity, row.id, rec)
		}
	}
	stats, err := st.UserStats(ctx, alice)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	// the tabverse and its four children are gone from the account's live
	// count; the other tabverse is all that is left
	if stats.Live != 1 {
		t.Fatalf("the account still holds %d live records, want 1 (ts2)", stats.Live)
	}

	// The other tabverse of the same account, and the other account, are not
	// collateral damage.
	if rec, err := st.GetRecord(ctx, alice, "tabspace", "ts2"); err != nil || rec.Deleted {
		t.Fatalf("ts2 was deleted too: %+v (%v)", rec, err)
	}
	if rec, err := st.GetRecord(ctx, bob, "tabspace", "ts_bob"); err != nil || rec.Deleted {
		t.Fatalf("another account's tabverse was deleted: %+v (%v)", rec, err)
	}

	// And the list an operator browses no longer shows it.
	tabverses, total, err := st.ListTabspaces(ctx, alice, "", false, 50, 0)
	if err != nil {
		t.Fatalf("list tabspaces: %v", err)
	}
	if total != 1 || tabverses[0].ID != "ts2" {
		t.Fatalf("the deleted tabverse is still listed: %d %+v", total, tabverses)
	}
}

// The tombstone has to win against the device that still holds the tabverse,
// or a delete from the console would come back on the next sync.
func TestADevicePushAfterADeleteLoses(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	alice := mustCreateUser(t, st, "alice")
	now := int64(1700000000000)

	if _, _, err := st.ApplyRecords(ctx, alice, "dev_1", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"id":"ts1","name":"R","tabIds":[]}`},
	}, 1<<20); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := st.DeleteTabspace(ctx, alice, "ts1", "", now+10, 1<<20); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// The device was offline when it was deleted and pushes its copy back with
	// the clock it had. LWW compares the payload time, not the arrival time, so
	// the tombstone wins.
	results, _, err := st.ApplyRecords(ctx, alice, "dev_1", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now + 1, Payload: `{"id":"ts1","name":"R","tabIds":[]}`},
	}, 1<<20)
	if err != nil {
		t.Fatalf("push after delete: %v", err)
	}
	if len(results) != 1 || results[0].Status != StatusStale {
		t.Fatalf("a stale push resurrected the tabverse: %+v", results)
	}
	if !results[0].Current.Deleted {
		t.Fatalf("the winning copy is not the tombstone: %+v", results[0].Current)
	}

	// A push the device actually made later (a rename after the delete) does
	// win, because its clock is newer: that is what LWW means, and the
	// operator can always delete again.
	results, _, err = st.ApplyRecords(ctx, alice, "dev_1", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now + 1000, Payload: `{"id":"ts1","name":"R","tabIds":[]}`},
	}, 1<<20)
	if err != nil {
		t.Fatalf("later push: %v", err)
	}
	if results[0].Status != StatusOK {
		t.Fatalf("a newer push should win: %+v", results[0])
	}
}

func TestDeleteUnknownTabspaceFails(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	alice := mustCreateUser(t, st, "alice")
	if _, err := st.DeleteTabspace(ctx, alice, "ts_nope", "", 1700000000000, 1<<20); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete of an unknown tabverse = %v, want ErrNotFound", err)
	}
}

// Archiving a record retires it from the default views but keeps it stored
// (ADR 0011); a delete is the operator saying it should not be stored at all,
// so it has to reach archived rows too.
func TestDeleteTabspaceReachesArchivedRows(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	alice := mustCreateUser(t, st, "alice")
	now := int64(1700000000000)

	if _, _, err := st.ApplyRecords(ctx, alice, "dev_1", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"id":"ts1","name":"R","tabIds":[]}`},
		{Entity: "note", ID: "n1", UpdatedAt: now + 1, Payload: `{"id":"n1","tabSpaceId":"ts1","name":"n"}`},
	}, 1<<20); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Archived by the device-level archive route, which is the only way a
	// record gets one; the point here is just that the row is archived.
	if _, err := st.DB().ExecContext(ctx,
		`UPDATE records SET archived_at = ? WHERE user_id = ? AND entity = 'note' AND id = 'n1'`,
		now+10, alice); err != nil {
		t.Fatalf("archive row: %v", err)
	}

	res, err := st.DeleteTabspace(ctx, alice, "ts1", "", now+100, 1<<20)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	// the tabverse and its archived note
	if res.Tombstoned != 2 {
		t.Fatalf("tombstoned %d records, want the archived one too", res.Tombstoned)
	}
}
