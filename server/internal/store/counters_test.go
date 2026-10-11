package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCountersDrainAndOrphanSweep(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	alice := mustCreateUser(t, st, "alice")

	if _, _, err := st.ApplyRecords(ctx, alice, "dev_1", []RecordInput{
		{Entity: "note", ID: "n1", UpdatedAt: 1, Payload: `{"name":"a"}`},
		{Entity: "note", ID: "n2", UpdatedAt: 2, Payload: `{"name":"b"}`, Deleted: true},
	}, 1<<20); err != nil {
		t.Fatalf("apply: %v", err)
	}

	// The write marked the account dirty but did not populate the cache.
	var cached int
	if err := st.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM user_counters WHERE user_id = ?`, alice).Scan(&cached); err != nil {
		t.Fatal(err)
	}
	if cached != 0 {
		t.Fatalf("cache prepopulated: %d", cached)
	}

	n, err := st.DrainDirtyCounters(ctx, 10)
	if err != nil || n != 1 {
		t.Fatalf("drain n=%d err=%v", n, err)
	}

	var live, tombstones int
	if err := st.db.QueryRowContext(ctx,
		`SELECT live_records, tombstones FROM user_counters WHERE user_id = ?`, alice).
		Scan(&live, &tombstones); err != nil {
		t.Fatal(err)
	}
	if live != 1 || tombstones != 1 {
		t.Fatalf("live/tombstones = %d/%d, want 1/1", live, tombstones)
	}

	var dirty int
	if err := st.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM counter_dirty WHERE user_id = ?`, alice).Scan(&dirty); err != nil {
		t.Fatal(err)
	}
	if dirty != 0 {
		t.Fatalf("dirty marker not cleared: %d", dirty)
	}

	// A content file with no central account is an orphan and gets reaped.
	if _, release, err := st.users.Acquire(ctx, "usr_orphan"); err == nil {
		release()
	}
	removed, err := st.SweepOrphans(ctx)
	if err != nil || removed != 1 {
		t.Fatalf("sweep removed=%d err=%v", removed, err)
	}

	// Account deletion removes the content file and (by cascade) its cache row.
	if err := st.DeleteUser(ctx, alice); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(st.users.dir, alice+".db")); !os.IsNotExist(err) {
		t.Fatalf("content file survived DeleteUser: %v", err)
	}
	var counters int
	if err := st.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM user_counters WHERE user_id = ?`, alice).Scan(&counters); err != nil {
		t.Fatal(err)
	}
	if counters != 0 {
		t.Fatalf("counter row survived DeleteUser: %d", counters)
	}
}
