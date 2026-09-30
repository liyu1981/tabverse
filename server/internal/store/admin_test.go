package store

import (
	"context"
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
