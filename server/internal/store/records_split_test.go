package store

import (
	"context"
	"path/filepath"
	"testing"
)

// A real profile holds several tabverses and every entity kind, pushed in
// batches and read back after the pool has closed the file. This is the shape
// the console and a second device see, so it must survive a reopen.
func TestContentSurvivesBatchesAndReopen(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "central.db")
	ctx := context.Background()

	st, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	user, err := st.CreateUser(ctx, "usr_test", "alice")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	children := []string{"tab", "note", "allnote", "todo", "alltodo", "bookmark", "allbookmark", "closedtab"}
	batch := func(tabspace string, base int64) []RecordInput {
		out := []RecordInput{{
			Entity: "tabspace", ID: tabspace, UpdatedAt: base,
			Payload: `{"name":"` + tabspace + `","tabIds":[]}`,
		}}
		for i, e := range children {
			out = append(out, RecordInput{
				Entity: e, ID: tabspace + "-" + e, UpdatedAt: base + int64(i+1),
				Payload: `{"tabSpaceId":"` + tabspace + `"}`,
			})
		}
		return out
	}
	if _, _, err := st.ApplyRecords(ctx, user.ID, "dev_1", batch("ts1", 1), 1<<20); err != nil {
		t.Fatalf("first batch: %v", err)
	}
	if _, _, err := st.ApplyRecords(ctx, user.ID, "dev_1", batch("ts2", 100), 1<<20); err != nil {
		t.Fatalf("second batch: %v", err)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	st2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer st2.Close()

	got, hasMore, err := st2.PullRecords(ctx, user.ID, 0, 1000)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if hasMore {
		t.Fatal("more records than the test pulled")
	}
	byEntity := map[string]int{}
	tabspaces := map[string]bool{}
	for _, r := range got {
		byEntity[r.Entity]++
		if r.Entity == "tabspace" {
			tabspaces[r.ID] = true
		}
	}
	if !tabspaces["ts1"] || !tabspaces["ts2"] {
		t.Fatalf("tabverses lost: %v", tabspaces)
	}
	for _, e := range append([]string{"tabspace"}, children...) {
		if byEntity[e] != 2 {
			t.Errorf("%s: got %d, want 2 (all: %v)", e, byEntity[e], byEntity)
		}
	}
}
