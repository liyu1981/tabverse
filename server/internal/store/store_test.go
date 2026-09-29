package store

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "store.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func mustCreateUser(t *testing.T, st *Store, name string) string {
	t.Helper()
	u, err := st.CreateUser(context.Background(), "usr_"+name, name)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u.ID
}

func TestApplyAndPullBasic(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "a")

	now := time.Now().UnixMilli()
	results, rev, err := st.ApplyRecords(ctx, userID, "dev_1", []RecordInput{
		{Entity: "note", ID: "n1", UpdatedAt: now, Payload: `{"text":"hello world"}`},
	}, 1<<20)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(results) != 1 || results[0].Status != StatusOK || results[0].Rev != 1 {
		t.Fatalf("unexpected results: %+v", results)
	}
	if rev != 1 {
		t.Fatalf("server rev = %d, want 1", rev)
	}

	recs, more, err := st.PullRecords(ctx, userID, 0, 100)
	if err != nil || more || len(recs) != 1 {
		t.Fatalf("pull: err=%v more=%v n=%d", err, more, len(recs))
	}
	if recs[0].DeviceID != "dev_1" || recs[0].Payload != `{"text":"hello world"}` {
		t.Fatalf("unexpected record: %+v", recs[0])
	}

	// delta pull beyond the tip is empty
	recs, more, err = st.PullRecords(ctx, userID, 1, 100)
	if err != nil || more || len(recs) != 0 {
		t.Fatalf("empty delta: err=%v more=%v n=%d", err, more, len(recs))
	}
}

func TestPayloadLimitEnforced(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "a")

	_, _, err := st.ApplyRecords(ctx, userID, "dev", []RecordInput{
		{Entity: "note", ID: "big", UpdatedAt: time.Now().UnixMilli(), Payload: "xxxx"},
	}, 3 /* max bytes */)
	if err == nil {
		t.Fatal("expected payload size error")
	}
}

func TestPruneOlderThanTombstonesAndUnindexes(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "a")

	old := time.Now().Add(-30 * 24 * time.Hour).UnixMilli()
	recent := time.Now().UnixMilli()

	_, _, err := st.ApplyRecords(ctx, userID, "dev", []RecordInput{
		{Entity: "session", ID: "old-snap", UpdatedAt: old, Payload: `{"tag":"2020-01-01"}`},
		{Entity: "session", ID: "fresh-snap", UpdatedAt: recent, Payload: `{"tag":"today"}`},
		{Entity: "session", ID: "old-snap-2", UpdatedAt: old, Payload: `{"tag":"2020-01-02"}`},
		// non prunable entities of the same age must survive
		{Entity: "note", ID: "old-note", UpdatedAt: old, Payload: `{"text":"ancient but precious"}`},
	}, 1<<20)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}

	cutoff := time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	n, err := st.PruneOlderThan(ctx, userID, "session", cutoff)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if n != 2 {
		t.Fatalf("pruned %d, want 2", n)
	}

	recs, _, err := st.PullRecords(ctx, userID, 0, 100)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	byID := map[string]Record{}
	for _, r := range recs {
		byID[r.ID] = r
	}
	if !byID["old-snap"].Deleted || !byID["old-snap-2"].Deleted {
		t.Fatalf("old sessions not tombstoned: %+v", byID)
	}
	if byID["fresh-snap"].Deleted {
		t.Fatal("fresh session tombstoned")
	}
	if byID["old-note"].Deleted {
		t.Fatal("prunable rule leaked to notes")
	}

	// tombstoned sessions must be gone from the search index
	hits, err := st.Search(ctx, userID, "2020", "", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("pruned session still searchable: %+v", hits)
	}
	// the note must still be there
	hits, err = st.Search(ctx, userID, "precious", "", 10)
	if err != nil || len(hits) != 1 {
		t.Fatalf("note search: err=%v hits=%+v", err, hits)
	}
}

func TestSearchFiltersByUserAndEntity(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	a := mustCreateUser(t, st, "a")
	b := mustCreateUser(t, st, "b")
	now := time.Now().UnixMilli()

	_, _, err := st.ApplyRecords(ctx, a, "dev", []RecordInput{
		{Entity: "note", ID: "n1", UpdatedAt: now, Payload: `{"text":"shared keyword alpha"}`},
	}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = st.ApplyRecords(ctx, b, "dev", []RecordInput{
		{Entity: "tabspace", ID: "t1", UpdatedAt: now, Payload: `{"title":"shared keyword beta"}`},
	}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}

	hits, err := st.Search(ctx, a, "shared", "", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 || hits[0].ID != "n1" || hits[0].Entity != "note" {
		t.Fatalf("user isolation broken: %+v", hits)
	}

	hits, err = st.Search(ctx, a, "shared", "tabspace", 10)
	if err != nil {
		t.Fatalf("search entity filter: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("entity filter broken: %+v", hits)
	}
}

// The client shows tabverses, not records: every hit has to say which tabverse
// it belongs to, so it can drop the ones this device has not downloaded.
func TestSearchResolvesTabspaceIDs(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	uid := mustCreateUser(t, st, "s")
	now := time.Now().UnixMilli()

	_, _, err := st.ApplyRecords(ctx, uid, "dev", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"name":"recipes","tabIds":["t1"]}`},
		{Entity: "tab", ID: "t1", UpdatedAt: now,
			Payload: `{"tabSpaceId":"ts1","title":"pasta","url":"https://example.com/pasta"}`},
		{Entity: "todo", ID: "x1", UpdatedAt: now, Payload: `{"tabSpaceId":"ts2","content":"buy semolina"}`},
		{Entity: "alltodo", ID: "a1", UpdatedAt: now, Payload: `{"tabSpaceId":"ts1","todoIds":["x1"]}`},
	}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}

	byID := map[string]SearchHit{}
	for _, q := range []string{"pasta", "recipes", "semolina"} {
		hits, err := st.Search(ctx, uid, q, "", 10)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if len(hits) != 1 {
			t.Fatalf("search %q: got %d hits, want 1: %+v", q, len(hits), hits)
		}
		byID[hits[0].ID] = hits[0]
	}

	if got := byID["t1"].TabspaceID; got != "ts1" {
		t.Errorf("tab hit tabspace id = %q, want ts1", got)
	}
	if got := byID["ts1"].TabspaceID; got != "ts1" {
		t.Errorf("tabspace hit is its own tabverse, got %q", got)
	}
	if got := byID["x1"].TabspaceID; got != "ts2" {
		t.Errorf("todo hit tabspace id = %q, want ts2", got)
	}
}

// Closed tabs are searchable like everything else now that a hit is resolved
// to a tabverse rather than shown as a record that may no longer exist.
func TestSearchIndexesClosedTabs(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	uid := mustCreateUser(t, st, "c")
	now := time.Now().UnixMilli()

	_, _, err := st.ApplyRecords(ctx, uid, "dev", []RecordInput{
		{Entity: "closedtab", ID: "c1", UpdatedAt: now,
			Payload: `{"tabSpaceId":"ts1","title":"that one page","url":"https://example.com/x","closedAt":1}`},
	}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	hits, err := st.Search(ctx, uid, "example", "", 10)
	if err != nil || len(hits) != 1 || hits[0].Entity != "closedtab" {
		t.Fatalf("closed tab not searchable: err=%v %+v", err, hits)
	}
	if hits[0].TabspaceID != "ts1" {
		t.Fatalf("closed tab tabspace id = %q", hits[0].TabspaceID)
	}

	// pruning it (the client drops rows past its cap) removes it from the index
	_, _, err = st.ApplyRecords(ctx, uid, "dev", []RecordInput{
		{Entity: "closedtab", ID: "c1", UpdatedAt: now + 1, Deleted: true},
	}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	hits, err = st.Search(ctx, uid, "example", "", 10)
	if err != nil || len(hits) != 0 {
		t.Fatalf("deleted closed tab still searchable: err=%v %+v", err, hits)
	}
}

// Ids are not content: searching for a tabverse id must not match every row
// that hangs off it, and they must stay out of the snippets.
func TestSearchIgnoresIdentifierFields(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	uid := mustCreateUser(t, st, "i")
	now := time.Now().UnixMilli()

	_, _, err := st.ApplyRecords(ctx, uid, "dev", []RecordInput{
		{Entity: "tab", ID: "t1", UpdatedAt: now,
			Payload: `{"id":"t1","tabSpaceId":"ts-zzz","title":"hello","url":"https://example.com"}`},
	}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	hits, err := st.Search(ctx, uid, "ts-zzz", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 0 {
		t.Fatalf("an id matched as content: %+v", hits)
	}
	hits, err = st.Search(ctx, uid, "hello", "", 10)
	if err != nil || len(hits) != 1 {
		t.Fatalf("content search broken: err=%v %+v", err, hits)
	}
	if strings.Contains(hits[0].Snippet, "ts-zzz") {
		t.Fatalf("snippet leaked an id: %q", hits[0].Snippet)
	}
}

func TestBuildMatchExpr(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"   ", ""},
		{"tab", `("tab"*)`},
		{"tab manager", `("tab") AND ("manager"*)`},
		{"foo \"bar", `("foo") AND ("bar"*)`}, // punctuation is a separator, so embedded quotes cannot reach FTS syntax
	}
	for _, c := range cases {
		if got := buildMatchExpr(c.in); got != c.want {
			t.Errorf("buildMatchExpr(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
