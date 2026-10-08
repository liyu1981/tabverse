package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// ---- test helpers ---------------------------------------------------------

func newTestServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	cfg := config.Config{
		Addr:           ":0",
		DBPath:         filepath.Join(t.TempDir(), "test.db"),
		MaxRecordBytes: 1 << 20,
		SyncBatchLimit: 100,
		SearchLimit:    50,
		Version:        "test",
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	s, err := New(cfg, st, hub.New(), nil)
	if err != nil {
		t.Fatalf("server: %v", err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, s
}

type apiResp struct {
	status int
	body   map[string]any
	raw    string
}

func (r apiResp) mustStatus(t *testing.T, want int) {
	t.Helper()
	if r.status != want {
		t.Fatalf("status = %d, want %d; body: %s", r.status, want, r.raw)
	}
}

func doJSON(t *testing.T, method, url, token string, body any) apiResp {
	t.Helper()
	var rd io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		rd = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return apiResp{status: res.StatusCode, body: out, raw: string(raw)}
}

type bootstrapResp struct {
	UserID    string `json:"user_id"`
	DeviceID  string `json:"device_id"`
	Token     string `json:"token"`
	ServerRev int64  `json:"server_rev"`
}

func bootstrap(t *testing.T, ts *httptest.Server) bootstrapResp {
	t.Helper()
	r := doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/auth/bootstrap", "",
		map[string]string{"name": "primary"})
	r.mustStatus(t, http.StatusCreated)
	var out bootstrapResp
	data, _ := json.Marshal(r.body)
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	if out.Token == "" || out.UserID == "" {
		t.Fatalf("bootstrap returned no credentials: %s", r.raw)
	}
	return out
}

type pushedRecord struct {
	Entity    string `json:"entity"`
	ID        string `json:"id"`
	UpdatedAt int64  `json:"updated_at"`
	Deleted   bool   `json:"deleted"`
	Payload   string `json:"payload"`
}

type pushResp struct {
	Results   []store.RecordResult `json:"results"`
	ServerRev int64                `json:"server_rev"`
}

func push(t *testing.T, ts *httptest.Server, token string, records []pushedRecord) (pushResp, apiResp) {
	t.Helper()
	r := doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/sync", token, map[string]any{"records": records})
	var out pushResp
	if r.status == http.StatusOK {
		data, _ := json.Marshal(r.body)
		if err := json.Unmarshal(data, &out); err != nil {
			t.Fatalf("decode push: %v (%s)", err, r.raw)
		}
	}
	return out, r
}

type pullResp struct {
	Records   []store.Record `json:"records"`
	NextRev   int64          `json:"next_rev"`
	HasMore   bool           `json:"has_more"`
	ServerRev int64          `json:"server_rev"`
}

func pull(t *testing.T, ts *httptest.Server, token string, since int64) pullResp {
	t.Helper()
	r := doJSON(t, http.MethodGet,
		fmt.Sprintf("%s/console/api/v1/sync?since=%d", ts.URL, since), token, nil)
	r.mustStatus(t, http.StatusOK)
	data, _ := json.Marshal(r.body)
	var out pullResp
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("decode pull: %v (%s)", err, r.raw)
	}
	return out
}

// ---- tests ----------------------------------------------------------------

func TestHealthz(t *testing.T) {
	ts, _ := newTestServer(t)
	r := doJSON(t, http.MethodGet, ts.URL+"/healthz", "", nil)
	r.mustStatus(t, http.StatusOK)
	if r.body["status"] != "ok" {
		t.Fatalf("unexpected health: %s", r.raw)
	}
}

func TestBootstrapOnlyOnce(t *testing.T) {
	ts, _ := newTestServer(t)
	bootstrap(t, ts)

	r := doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/auth/bootstrap", "",
		map[string]string{"name": "second"})
	r.mustStatus(t, http.StatusConflict)
	if r.body["error"] != "already_bootstrapped" {
		t.Fatalf("unexpected error code: %s", r.raw)
	}
}

func TestPairingWithInviteCode(t *testing.T) {
	ts, _ := newTestServer(t)
	primary := bootstrap(t, ts)

	// mint an invite
	r := doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/auth/invites", primary.Token,
		map[string]int{"ttl_seconds": 300})
	r.mustStatus(t, http.StatusCreated)
	code, _ := r.body["code"].(string)
	if code == "" {
		t.Fatalf("no code returned: %s", r.raw)
	}

	// pair a second device, with sloppy human formatting
	sloppy := strings.ToLower(strings.ReplaceAll(code, "-", " - "))
	r = doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/auth/pair", "",
		map[string]string{"invite_code": sloppy, "device_name": "laptop"})
	r.mustStatus(t, http.StatusCreated)
	var second bootstrapResp
	data, _ := json.Marshal(r.body)
	if err := json.Unmarshal(data, &second); err != nil {
		t.Fatalf("decode pair: %v", err)
	}
	if second.Token == "" || second.UserID != primary.UserID {
		t.Fatalf("unexpected pair result: %s", r.raw)
	}

	// codes are single use
	r = doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/auth/pair", "",
		map[string]string{"invite_code": code, "device_name": "again"})
	r.mustStatus(t, http.StatusUnauthorized)
}

func TestAuthRequired(t *testing.T) {
	ts, _ := newTestServer(t)
	bootstrap(t, ts)

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/console/api/v1/sync"},
		{http.MethodPost, "/console/api/v1/sync"},
		{http.MethodGet, "/console/api/v1/search?q=x"},
		{http.MethodPost, "/console/api/v1/auth/invites"},
	} {
		r := doJSON(t, tc.method, ts.URL+tc.path, "", map[string]any{})
		if r.status != http.StatusUnauthorized {
			t.Fatalf("%s %s without token = %d, want 401", tc.method, tc.path, r.status)
		}
	}
	r := doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/sync", "bogus-token", nil)
	r.mustStatus(t, http.StatusUnauthorized)
}

func TestSyncPushPullRoundTrip(t *testing.T) {
	ts, _ := newTestServer(t)
	a := bootstrap(t, ts)

	now := time.Now().UnixMilli()
	notes := []pushedRecord{
		{Entity: "note", ID: "n1", UpdatedAt: now, Payload: `{"title":"groceries","text":"milk and eggs"}`},
		{Entity: "tabspace", ID: "t1", UpdatedAt: now,
			Payload: `{"title":"research","tabs":[{"title":"Go docs","url":"https://go.dev"}]}`},
	}
	pr, resp := push(t, ts, a.Token, notes)
	resp.mustStatus(t, http.StatusOK)
	if len(pr.Results) != 2 {
		t.Fatalf("want 2 results, got %d: %+v", len(pr.Results), pr.Results)
	}
	for _, res := range pr.Results {
		if res.Status != store.StatusOK {
			t.Fatalf("record %s/%s not accepted: %+v", res.Entity, res.ID, res)
		}
	}
	if pr.ServerRev != 2 {
		t.Fatalf("server_rev = %d, want 2", pr.ServerRev)
	}

	// full pull from scratch
	got := pull(t, ts, a.Token, 0)
	if len(got.Records) != 2 || got.HasMore {
		t.Fatalf("pull returned %d records: %+v", len(got.Records), got)
	}
	if got.NextRev != 2 || got.ServerRev != 2 {
		t.Fatalf("next_rev=%d server_rev=%d, want 2/2", got.NextRev, got.ServerRev)
	}

	// delta pull only sees the new revision
	edited := []pushedRecord{notes[0]}
	edited[0].Payload = `{"title":"groceries","text":"milk, eggs and bread"}`
	edited[0].UpdatedAt = now + 1000
	pr2, resp2 := push(t, ts, a.Token, edited)
	resp2.mustStatus(t, http.StatusOK)
	if pr2.ServerRev != 3 {
		t.Fatalf("server_rev after edit = %d, want 3", pr2.ServerRev)
	}
	delta := pull(t, ts, a.Token, 2)
	if len(delta.Records) != 1 || delta.Records[0].ID != "n1" {
		t.Fatalf("delta pull wrong: %+v", delta.Records)
	}
}

func TestSyncIsIdempotentAndLastWriterWins(t *testing.T) {
	ts, _ := newTestServer(t)
	a := bootstrap(t, ts)

	now := time.Now().UnixMilli()
	rec := pushedRecord{Entity: "todo", ID: "x1", UpdatedAt: now, Payload: `{"text":"buy milk"}`}

	pr, resp := push(t, ts, a.Token, []pushedRecord{rec})
	resp.mustStatus(t, http.StatusOK)
	firstRev := pr.Results[0].Rev

	// exact replay: same content must not consume a revision
	pr, resp = push(t, ts, a.Token, []pushedRecord{rec})
	resp.mustStatus(t, http.StatusOK)
	if pr.Results[0].Rev != firstRev {
		t.Fatalf("replay bumped rev: %d -> %d", firstRev, pr.Results[0].Rev)
	}
	if pr.ServerRev != firstRev {
		t.Fatalf("server_rev after replay = %d, want %d", pr.ServerRev, firstRev)
	}

	// stale write (older client clock): rejected with the server copy attached
	stale := rec
	stale.Payload = `{"text":"buy oat milk"}`
	stale.UpdatedAt = now - 60_000
	pr, resp = push(t, ts, a.Token, []pushedRecord{stale})
	resp.mustStatus(t, http.StatusOK)
	res := pr.Results[0]
	if res.Status != store.StatusStale {
		t.Fatalf("stale write accepted: %+v", res)
	}
	if res.Current == nil || res.Current.Payload != `{"text":"buy milk"}` {
		t.Fatalf("conflict did not carry current record: %+v", res.Current)
	}

	// newer write wins
	fresh := rec
	fresh.Payload = `{"text":"buy bread"}`
	fresh.UpdatedAt = now + 1000
	pr, resp = push(t, ts, a.Token, []pushedRecord{fresh})
	resp.mustStatus(t, http.StatusOK)
	if pr.Results[0].Status != store.StatusOK || pr.Results[0].Rev <= firstRev {
		t.Fatalf("newer write not accepted: %+v", pr.Results[0])
	}

	// and the stored copy reflects the winner
	pulled := pull(t, ts, a.Token, 0)
	var todo *store.Record
	for i := range pulled.Records {
		if pulled.Records[i].ID == "x1" {
			todo = &pulled.Records[i]
		}
	}
	if todo == nil || todo.Payload != `{"text":"buy bread"}` {
		t.Fatalf("LWW winner not stored: %+v", todo)
	}
}

func TestDeleteCreatesTombstone(t *testing.T) {
	ts, _ := newTestServer(t)
	a := bootstrap(t, ts)

	now := time.Now().UnixMilli()
	_, resp := push(t, ts, a.Token, []pushedRecord{
		{Entity: "bookmark", ID: "b1", UpdatedAt: now, Payload: `{"url":"https://example.com"}`},
	})
	resp.mustStatus(t, http.StatusOK)

	r := doJSON(t, http.MethodDelete, ts.URL+"/console/api/v1/entities/bookmark/b1", a.Token, nil)
	r.mustStatus(t, http.StatusOK)

	got := pull(t, ts, a.Token, 0)
	if len(got.Records) != 1 {
		t.Fatalf("want 1 record, got %d", len(got.Records))
	}
	if !got.Records[0].Deleted || got.Records[0].Payload != "" {
		t.Fatalf("tombstone not applied: %+v", got.Records[0])
	}

	// tombstoned records must not be searchable anymore
	push(t, ts, a.Token, []pushedRecord{
		{Entity: "note", ID: "n1", UpdatedAt: now, Payload: `{"title":"unique-term-xkcd"}`},
	})
	sr := doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/search?q=unique-term-xkcd", a.Token, nil)
	sr.mustStatus(t, http.StatusOK)
	hits := sr.body["hits"].([]any)
	if len(hits) != 1 {
		t.Fatalf("note not searchable: %s", sr.raw)
	}
	r = doJSON(t, http.MethodDelete, ts.URL+"/console/api/v1/entities/note/n1", a.Token, nil)
	r.mustStatus(t, http.StatusOK)
	sr = doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/search?q=unique-term-xkcd", a.Token, nil)
	sr.mustStatus(t, http.StatusOK)
	if len(sr.body["hits"].([]any)) != 0 {
		t.Fatalf("deleted note still searchable: %s", sr.raw)
	}
}

func TestSearch(t *testing.T) {
	ts, _ := newTestServer(t)
	a := bootstrap(t, ts)
	now := time.Now().UnixMilli()

	_, resp := push(t, ts, a.Token, []pushedRecord{
		{Entity: "note", ID: "n1", UpdatedAt: now,
			Payload: `{"tabSpaceId":"ts1","title":"reading list","text":"articles about distributed systems"}`},
		{Entity: "tabspace", ID: "t1", UpdatedAt: now,
			Payload: `{"title":"recipes","tabs":[{"title":"pasta","url":"https://example.com/pasta"}]}`},
		{Entity: "todo", ID: "x1", UpdatedAt: now,
			Payload: `{"tabSpaceId":"t1","text":"fix the toaster"}`},
		{Entity: "closedtab", ID: "c1", UpdatedAt: now,
			Payload: `{"tabSpaceId":"t1","title":"that sourdough blog","url":"https://example.com/bread"}`},
	})
	resp.mustStatus(t, http.StatusOK)

	cases := []struct {
		q      string
		entity string
		want   int
	}{
		{"distributed", "", 1},
		{"reading", "", 1},
		{"pasta", "tabspace", 1},
		{"pasta", "note", 0},
		{"toaster", "", 1},
		{"sourdough", "", 1}, // closed tabs are searchable
		{"", "", 0},          // empty query: no results, no error
		{"nosuchthing", "", 0},
	}
	for _, tc := range cases {
		url := fmt.Sprintf("%s/console/api/v1/search?q=%s", ts.URL, tc.q)
		if tc.entity != "" {
			url += "&entity=" + tc.entity
		}
		r := doJSON(t, http.MethodGet, url, a.Token, nil)
		r.mustStatus(t, http.StatusOK)
		hits := r.body["hits"].([]any)
		if len(hits) != tc.want {
			t.Errorf("q=%q entity=%q: got %d hits, want %d (%s)",
				tc.q, tc.entity, len(hits), tc.want, r.raw)
		}
		if tc.want == 0 {
			continue
		}
		// every hit names the tabverse it belongs to, which is what the
		// extension filters against its local rows
		hit := hits[0].(map[string]any)
		tabspaceID, _ := hit["tabspace_id"].(string)
		if tabspaceID == "" {
			t.Errorf("q=%q: hit without tabspace_id: %s", tc.q, r.raw)
		}
	}

	// prefix matching (as-you-type)
	r := doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/search?q=distrib", a.Token, nil)
	r.mustStatus(t, http.StatusOK)
	if len(r.body["hits"].([]any)) != 1 {
		t.Fatalf("prefix search failed: %s", r.raw)
	}

	// a crafted query must not blow up (fts injection attempt)
	r = doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/search?q=%22+OR+%22*", a.Token, nil)
	if r.status != http.StatusOK && r.status != http.StatusBadRequest {
		t.Fatalf("unexpected status for tricky query: %d %s", r.status, r.raw)
	}
}

func TestInvalidEntityRejected(t *testing.T) {
	ts, _ := newTestServer(t)
	a := bootstrap(t, ts)
	_, resp := push(t, ts, a.Token, []pushedRecord{
		{Entity: "evil", ID: "x", UpdatedAt: time.Now().UnixMilli(), Payload: "{}"},
	})
	resp.mustStatus(t, http.StatusBadRequest)
}

func TestRealtimeStreamNotifiesOtherDevices(t *testing.T) {
	ts, s := newTestServer(t)
	a := bootstrap(t, ts)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/console/api/v1/sync/stream?access_token=" + a.Token
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	// the hub must see us
	deadline := time.Now().Add(2 * time.Second)
	for s.hub.Count(a.UserID) != 1 {
		if time.Now().After(deadline) {
			t.Fatalf("connection not attached to hub")
		}
		time.Sleep(10 * time.Millisecond)
	}

	readMsg := func() map[string]any {
		t.Helper()
		mt, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("read ws: %v", err)
		}
		if mt != websocket.MessageText {
			t.Fatalf("unexpected frame type %v", mt)
		}
		out := map[string]any{}
		if err := json.Unmarshal(data, &out); err != nil {
			t.Fatalf("bad ws json: %v", err)
		}
		return out
	}

	// hello frame with the current server revision
	hello := readMsg()
	if hello["type"] != "hello" {
		t.Fatalf("first frame = %+v, want hello", hello)
	}

	// a push from "another device" must produce a records_changed frame
	_, resp := push(t, ts, a.Token, []pushedRecord{
		{Entity: "note", ID: "n1", UpdatedAt: time.Now().UnixMilli(), Payload: `{"title":"hello"}`},
	})
	resp.mustStatus(t, http.StatusOK)

	changed := readMsg()
	if changed["type"] != "records_changed" {
		t.Fatalf("frame = %+v, want records_changed", changed)
	}
	ents, _ := changed["entities"].([]any)
	if len(ents) != 1 || ents[0] != "note" {
		t.Fatalf("entities = %v, want [note]", ents)
	}
}

// TestConcurrentPushesStayConsistent exercises concurrent writers: every
// write must land and revisions must remain strictly increasing.
func TestConcurrentPushesStayConsistent(t *testing.T) {
	ts, _ := newTestServer(t)
	a := bootstrap(t, ts)

	const writers = 8
	const perWriter = 10
	done := make(chan error, writers)
	for w := 0; w < writers; w++ {
		go func(w int) {
			for i := 0; i < perWriter; i++ {
				rec := pushedRecord{
					Entity: "todo", ID: fmt.Sprintf("w%d-i%d", w, i),
					UpdatedAt: time.Now().UnixMilli(), Payload: `{"text":"x"}`,
				}
				r := doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/sync", a.Token,
					map[string]any{"records": []pushedRecord{rec}})
				if r.status != http.StatusOK {
					done <- fmt.Errorf("writer %d push status %d: %s", w, r.status, r.raw)
					return
				}
			}
			done <- nil
		}(w)
	}
	for w := 0; w < writers; w++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}

	got := pull(t, ts, a.Token, 0)
	want := writers * perWriter
	if len(got.Records) != want || got.HasMore {
		t.Fatalf("pulled %d records, want %d", len(got.Records), want)
	}
	last := int64(0)
	for _, rec := range got.Records {
		if rec.Rev <= last {
			t.Fatalf("revs not strictly increasing: %d after %d", rec.Rev, last)
		}
		last = rec.Rev
	}
	if got.ServerRev != int64(want) {
		t.Fatalf("server_rev = %d, want %d", got.ServerRev, want)
	}
}
