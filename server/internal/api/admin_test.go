package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

const testAdminToken = "admin-secret-token"

func newAdminServer(t *testing.T) *httptest.Server {
	t.Helper()
	cfg := config.Config{
		Addr:           ":0",
		DBPath:         filepath.Join(t.TempDir(), "admin.db"),
		MaxRecordBytes: 1 << 20,
		SyncBatchLimit: 100,
		SearchLimit:    50,
		Version:        "test",
		AdminToken:     testAdminToken,
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	ts := httptest.NewServer(New(cfg, st, hub.New(), nil).Handler())
	t.Cleanup(ts.Close)
	return ts
}

func adminDo(t *testing.T, ts *httptest.Server, method, path, token string, body any) apiResp {
	t.Helper()
	return doJSON(t, method, ts.URL+path, token, body)
}

// createAccount makes an account through the admin API and returns its id.
func createAccount(t *testing.T, ts *httptest.Server, name string) string {
	t.Helper()
	r := adminDo(t, ts, http.MethodPost, "/api/v1/admin/users", testAdminToken,
		map[string]string{"name": name})
	r.mustStatus(t, http.StatusCreated)
	user, _ := r.body["user"].(map[string]any)
	id, _ := user["id"].(string)
	if id == "" {
		t.Fatalf("create account returned no id: %s", r.raw)
	}
	return id
}

// seedUser pushes a full tabverse worth of records as a device of the account.
func seedUser(t *testing.T, ts *httptest.Server, name string) (userID, token string) {
	t.Helper()
	userID = createAccount(t, ts, name)

	// an account created by an admin has no device yet: pair one through an
	// invite, exactly like the extension would.
	r := adminDo(t, ts, http.MethodPost, "/api/v1/admin/users/"+userID+"/invites",
		testAdminToken, map[string]int{"ttl_seconds": 300})
	r.mustStatus(t, http.StatusCreated)
	code, _ := r.body["code"].(string)

	r = adminDo(t, ts, http.MethodPost, "/api/v1/auth/pair", "", map[string]string{
		"invite_code": code, "device_name": name + " laptop",
	})
	r.mustStatus(t, http.StatusCreated)
	token, _ = r.body["token"].(string)
	if token == "" {
		t.Fatalf("pair returned no token: %s", r.raw)
	}
	return userID, token
}

// ---- admin authentication -------------------------------------------------

func TestAdminDisabledByDefault(t *testing.T) {
	ts, _ := newTestServer(t) // no AdminToken configured

	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users", "", nil)
	r.mustStatus(t, http.StatusNotFound)
	if r.body["error"] != "admin_disabled" {
		t.Fatalf("unexpected error: %s", r.raw)
	}

	// The console still loads, and is told why it cannot ask for a token.
	page := doJSON(t, http.MethodGet, ts.URL+"/", "", nil)
	page.mustStatus(t, http.StatusOK)
	cfg := adminDo(t, ts, http.MethodGet, "/api/v1/admin/config", "", nil)
	cfg.mustStatus(t, http.StatusOK)
	if cfg.body["admin_enabled"] != false {
		t.Fatalf("config should report admin disabled: %s", cfg.raw)
	}
}

func TestAdminRequiresTheToken(t *testing.T) {
	ts := newAdminServer(t)

	// No token at all, then a wrong one.
	for _, token := range []string{"", "nope", testAdminToken + "x"} {
		r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users", token, nil)
		r.mustStatus(t, http.StatusUnauthorized)
	}

	adminDo(t, ts, http.MethodGet, "/api/v1/admin/users", testAdminToken, nil).
		mustStatus(t, http.StatusOK)

	// The ?access_token= form is for the WebSocket handshake only: an admin
	// token in a URL would end up in access logs, so it is not accepted.
	adminDo(t, ts, http.MethodGet,
		"/api/v1/admin/users?access_token="+testAdminToken, "", nil).
		mustStatus(t, http.StatusUnauthorized)
}

// A deployment with an admin token must not hand its first account to whoever
// happens to be scanning the port.
func TestBootstrapNeedsAdminTokenWhenConfigured(t *testing.T) {
	ts := newAdminServer(t)

	adminDo(t, ts, http.MethodPost, "/api/v1/auth/bootstrap", "", map[string]string{"name": "sneaky"}).
		mustStatus(t, http.StatusUnauthorized)

	adminDo(t, ts, http.MethodPost, "/api/v1/auth/bootstrap", testAdminToken, map[string]string{"name": "me"}).
		mustStatus(t, http.StatusCreated)
}

// ---- multi tenancy --------------------------------------------------------

func TestAccountsAreIsolated(t *testing.T) {
	ts := newAdminServer(t)
	alice, aliceToken := seedUser(t, ts, "alice")
	_, bobToken := seedUser(t, ts, "bob")

	now := int64(1700000000000)
	push(t, ts, aliceToken, []pushedRecord{
		{Entity: "tabspace", ID: "ts_alice", UpdatedAt: now,
			Payload: `{"id":"ts_alice","name":"alice work","tabIds":["t1"],"createdAt":1700000000000}`},
		{Entity: "tab", ID: "t1", UpdatedAt: now + 1,
			Payload: `{"id":"t1","tabSpaceId":"ts_alice","title":"Alice tab","url":"https://a.example/"}`},
	})
	push(t, ts, bobToken, []pushedRecord{
		{Entity: "tabspace", ID: "ts_bob", UpdatedAt: now,
			Payload: `{"id":"ts_bob","name":"bob work","tabIds":[],"createdAt":1700000000000}`},
	})

	// Alice's tabverse list shows her tabverse and only hers.
	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+alice+"/tabspaces", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	list, _ := r.body["tabspaces"].([]any)
	if len(list) != 1 {
		t.Fatalf("alice should hold exactly 1 tabverse, got %d: %s", len(list), r.raw)
	}
	row, _ := list[0].(map[string]any)
	if row["name"] != "alice work" {
		t.Fatalf("alice sees the wrong tabverse: %s", r.raw)
	}

	// And the raw record listing does not leak across accounts either.
	bobID := createAccount(t, ts, "bob2")
	leak := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+bobID+"/records", testAdminToken, nil)
	leak.mustStatus(t, http.StatusOK)
	if total, _ := leak.body["total"].(float64); total != 0 {
		t.Fatalf("a fresh account should hold no records, got %v: %s", leak.body["total"], leak.raw)
	}
}

func TestConsoleListsAccountsWithCounters(t *testing.T) {
	ts := newAdminServer(t)
	seedUser(t, ts, "alice")

	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	users, _ := r.body["users"].([]any)
	if len(users) != 1 {
		t.Fatalf("want 1 account, got %d: %s", len(users), r.raw)
	}
	row, _ := users[0].(map[string]any)
	if row["name"] != "alice" {
		t.Fatalf("unexpected account row: %s", r.raw)
	}
	if devices, _ := row["device_count"].(float64); devices != 1 {
		t.Fatalf("device_count = %v, want 1: %s", row["device_count"], r.raw)
	}

	// The deployment counters, for the console header.
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/totals", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if users, _ := r.body["users"].(float64); users != 1 {
		t.Fatalf("totals.users = %v, want 1: %s", r.body["users"], r.raw)
	}
}

// ---- token management -----------------------------------------------------

func TestRevokeTokenAndDevice(t *testing.T) {
	ts := newAdminServer(t)
	userID, token := seedUser(t, ts, "alice")

	// The token works.
	adminDo(t, ts, http.MethodGet, "/api/v1/sync?since=0", token, nil).mustStatus(t, http.StatusOK)

	// ...and that request stamped it, so the console can say when the device
	// was last seen.
	stamp := func() map[string]any {
		r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
		r.mustStatus(t, http.StatusOK)
		toks, _ := r.body["tokens"].([]any)
		tok, _ := toks[0].(map[string]any)
		return tok
	}
	if last, _ := stamp()["last_used"].(float64); last == 0 {
		t.Fatal("an authenticated device should carry a last_used stamp")
	}

	detail := func() (devices, tokens []any) {
		r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
		r.mustStatus(t, http.StatusOK)
		devices, _ = r.body["devices"].([]any)
		tokens, _ = r.body["tokens"].([]any)
		return
	}
	_, tokens := detail()
	if len(tokens) != 1 {
		t.Fatalf("want 1 token, got %d", len(tokens))
	}
	tok, _ := tokens[0].(map[string]any)
	hash, _ := tok["hash"].(string)
	fingerprint, _ := tok["fingerprint"].(string)
	if hash == "" || len(fingerprint) != 8 {
		t.Fatalf("token listing is not usable: %v", tok)
	}
	// The console must never be able to show the raw token back.
	if _, ok := tok["token"]; ok {
		t.Fatal("the console must not be handed a plaintext token")
	}

	adminDo(t, ts, http.MethodDelete,
		"/api/v1/admin/users/"+userID+"/tokens/"+hash, testAdminToken, nil).
		mustStatus(t, http.StatusNoContent)

	// The device's token is dead: sync is 401, and it says revoked.
	adminDo(t, ts, http.MethodGet, "/api/v1/sync?since=0", token, nil).
		mustStatus(t, http.StatusUnauthorized)
	_, tokens = detail()
	tok, _ = tokens[0].(map[string]any)
	if tok["revoked"] != true {
		t.Fatalf("token should be listed as revoked: %v", tok)
	}

	// A second device for the same account, revoked as a whole.
	r := adminDo(t, ts, http.MethodPost, "/api/v1/admin/users/"+userID+"/invites",
		testAdminToken, map[string]int{"ttl_seconds": 300})
	r.mustStatus(t, http.StatusCreated)
	code, _ := r.body["code"].(string)
	r = adminDo(t, ts, http.MethodPost, "/api/v1/auth/pair", "", map[string]string{
		"invite_code": code, "device_name": "phone",
	})
	r.mustStatus(t, http.StatusCreated)
	phoneToken, _ := r.body["token"].(string)

	devices, _ := detail()
	var phoneID string
	for _, d := range devices {
		row, _ := d.(map[string]any)
		if row["name"] == "phone" {
			phoneID, _ = row["id"].(string)
		}
	}
	if phoneID == "" {
		t.Fatalf("second device not listed: %v", devices)
	}

	adminDo(t, ts, http.MethodDelete,
		"/api/v1/admin/users/"+userID+"/devices/"+phoneID, testAdminToken, nil).
		mustStatus(t, http.StatusNoContent)
	adminDo(t, ts, http.MethodGet, "/api/v1/sync?since=0", phoneToken, nil).
		mustStatus(t, http.StatusUnauthorized)

	// An unknown device is a 404, not a silent success.
	adminDo(t, ts, http.MethodDelete,
		"/api/v1/admin/users/"+userID+"/devices/dev_nope", testAdminToken, nil).
		mustStatus(t, http.StatusNotFound)
}

func TestAdminMintedDeviceTokenWorks(t *testing.T) {
	ts := newAdminServer(t)
	// "create account + first device in one call" is the console's fast path.
	r := adminDo(t, ts, http.MethodPost, "/api/v1/admin/users", testAdminToken,
		map[string]string{"name": "alice", "device_name": "server-issued"})
	r.mustStatus(t, http.StatusCreated)
	token, _ := r.body["token"].(string)
	userID, _ := r.body["user_id"].(string)
	if token == "" || userID == "" {
		t.Fatalf("expected credentials: %s", r.raw)
	}
	adminDo(t, ts, http.MethodGet, "/api/v1/sync?since=0", token, nil).mustStatus(t, http.StatusOK)
}

// ---- read only data browsing ---------------------------------------------

// seedTabverse pushes a tabverse the way the extension would: the tabverse with
// its tabIds, its tabs, and the ordered aggregates that keep the user's
// ordering on the server.
func seedTabverse(t *testing.T, ts *httptest.Server, token string, id, name string, tabs [][2]string) {
	t.Helper()
	now := int64(1700000000000)
	tabIDs := make([]string, 0, len(tabs))
	records := []pushedRecord{{
		Entity: "tabspace", ID: id, UpdatedAt: now,
		Payload: fmt.Sprintf(`{"id":%q,"name":%q,"tabIds":[%s],"tabGroups":[{"id":"g1","title":"work","color":"blue","tabIds":[%q]}],"createdAt":1699999000000}`,
			id, name, jsonList(tabs), tabs[0][0]),
	}}
	for i, tab := range tabs {
		tabIDs = append(tabIDs, tab[0])
		records = append(records, pushedRecord{
			Entity: "tab", ID: tab[0], UpdatedAt: now + int64(i) + 1,
			Payload: fmt.Sprintf(`{"id":%q,"tabSpaceId":%q,"title":%q,"url":%q,"pinned":false,"suspended":false}`,
				tab[0], id, tab[1], "https://example.com/"+tab[0]),
		})
	}
	// notes/todos/bookmarks deliberately pushed in an order that is *not* the
	// user's, so the aggregate ordering can be proven to win.
	records = append(records,
		pushedRecord{Entity: "note", ID: "n2", UpdatedAt: now + 10,
			Payload: fmt.Sprintf(`{"id":"n2","tabSpaceId":%q,"name":"second","data":"b"}`, id)},
		pushedRecord{Entity: "note", ID: "n1", UpdatedAt: now + 11,
			Payload: fmt.Sprintf(`{"id":"n1","tabSpaceId":%q,"name":"first","data":"a"}`, id)},
		pushedRecord{Entity: "todo", ID: "td1", UpdatedAt: now + 12,
			Payload: fmt.Sprintf(`{"id":"td1","tabSpaceId":%q,"content":"ship it","completed":true}`, id)},
		pushedRecord{Entity: "bookmark", ID: "bk1", UpdatedAt: now + 13,
			Payload: fmt.Sprintf(`{"id":"bk1","tabSpaceId":%q,"name":"docs","url":"https://docs.example/"}`, id)},
		// a note the aggregate does not know about yet (the extension writes
		// the entity first, the aggregate a moment later)
		pushedRecord{Entity: "note", ID: "n3", UpdatedAt: now + 14,
			Payload: fmt.Sprintf(`{"id":"n3","tabSpaceId":%q,"name":"unlisted","data":"c"}`, id)},
		pushedRecord{Entity: "closedtab", ID: "ct1", UpdatedAt: now + 15,
			Payload: fmt.Sprintf(`{"id":"ct1","tabSpaceId":%q,"title":"older","url":"https://old.example/","closedAt":1699990000000}`, id)},
		pushedRecord{Entity: "closedtab", ID: "ct2", UpdatedAt: now + 16,
			Payload: fmt.Sprintf(`{"id":"ct2","tabSpaceId":%q,"title":"newer","url":"https://new.example/","closedAt":1699999000000}`, id)},
	)
	// The user's ordering: n2 before n1, i.e. the *opposite* of id order, so
	// this fails if the aggregate is ignored. n3 is deliberately not listed.
	records = append(records, pushedRecord{
		Entity: "allnote", ID: id + ":allnote", UpdatedAt: now + 20,
		Payload: fmt.Sprintf(`{"id":%q,"tabSpaceId":%q,"noteIds":["n2","n1"]}`, id+":allnote", id),
	})
	if _, r := push(t, ts, token, records); r.status != http.StatusOK {
		t.Fatalf("seed push: %s", r.raw)
	}
}

func jsonList(tabs [][2]string) string {
	out := ""
	for i, tab := range tabs {
		if i > 0 {
			out += ","
		}
		out += fmt.Sprintf("%q", tab[0])
	}
	return out
}

func TestTabspaceBundleUsesTheClientOrdering(t *testing.T) {
	ts := newAdminServer(t)
	userID, token := seedUser(t, ts, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "First tab"}, {"t2", "Second tab"}})

	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/tabspaces", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	list, _ := r.body["tabspaces"].([]any)
	if len(list) != 1 {
		t.Fatalf("want 1 tabverse, got %d: %s", len(list), r.raw)
	}
	row, _ := list[0].(map[string]any)
	if row["name"] != "Research" {
		t.Fatalf("name = %v: %s", row["name"], r.raw)
	}
	for field, want := range map[string]float64{
		"tab_count": 2, "notes": 3, "todos": 1, "bookmarks": 1,
		"closed_tabs": 2, "groups": 1,
	} {
		if got, _ := row[field].(float64); got != want {
			t.Errorf("%s = %v, want %v", field, got, want)
		}
	}

	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/tabspaces/ts1", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)

	ids := func(field string) []string {
		rows, _ := r.body[field].([]any)
		out := make([]string, 0, len(rows))
		for _, row := range rows {
			m, _ := row.(map[string]any)
			id, _ := m["id"].(string)
			out = append(out, id)
		}
		return out
	}
	// Tabs follow the tabverse's own tabIds.
	if got := ids("tabs"); !equalStrings(got, []string{"t1", "t2"}) {
		t.Errorf("tabs = %v, want [t1 t2]", got)
	}
	// Notes follow the allnote aggregate (n2 before n1, the reverse of id
	// order), and the note the aggregate does not mention still shows up
	// (after the listed ones).
	if got := ids("notes"); !equalStrings(got, []string{"n2", "n1", "n3"}) {
		t.Errorf("notes = %v, want [n2 n1 n3]", got)
	}
	// The positions are the aggregate's, not the sorted-by-id order.
	notes, _ := r.body["notes"].([]any)
	first, _ := notes[0].(map[string]any)
	if pos, _ := first["position"].(float64); pos != 0 || first["id"] != "n2" {
		t.Errorf("first note = %v (position %v), want n2 at 0", first["id"], first["position"])
	}
	// History is newest first by closedAt, no aggregate involved.
	if got := ids("closed_tabs"); !equalStrings(got, []string{"ct2", "ct1"}) {
		t.Errorf("closed_tabs = %v, want [ct2 ct1]", got)
	}
	// The tabverse's own document comes along, so the console can draw its
	// tab groups.
	data, _ := r.body["tabspace_data"].(map[string]any)
	groups, _ := data["tabGroups"].([]any)
	if len(groups) != 1 {
		t.Fatalf("tabspace_data.tabGroups = %v: %s", data["tabGroups"], r.raw)
	}

	// An unknown tabverse is a 404 for a typo, not an empty page.
	adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/tabspaces/nope", testAdminToken, nil).
		mustStatus(t, http.StatusNotFound)
}

func TestRecordBrowserFilters(t *testing.T) {
	ts := newAdminServer(t)
	userID, token := seedUser(t, ts, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "Alpha"}})

	// every record of the account
	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	all, _ := r.body["records"].([]any)
	if len(all) == 0 || len(all) != int(r.body["total"].(float64)) {
		t.Fatalf("records listing inconsistent: %s", r.raw)
	}

	// one entity
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records?entity=tab", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	records, _ := r.body["records"].([]any)
	if len(records) != 1 {
		t.Fatalf("entity filter: want 1 tab, got %d: %s", len(records), r.raw)
	}

	// one tabverse
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records?entity=note&tabspace_id=ts1", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 3 {
		t.Fatalf("tabspace filter: total = %v, want 3: %s", r.body["total"], r.raw)
	}
	// ...and a tabspace filter that matches nothing is empty, not everything
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records?tabspace_id=ts_other", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 0 {
		t.Fatalf("foreign tabspace id matched %v records: %s", r.body["total"], r.raw)
	}

	// substring over the payload; a LIKE metacharacter is not a wildcard
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records?q=Research", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("q=Research matched %v records, want 1: %s", r.body["total"], r.raw)
	}
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records?q=%25", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 0 {
		t.Fatalf("q=%% matched %v records, want 0: %s", r.body["total"], r.raw)
	}

	// paging reports the full total, not the page size
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records?limit=2&offset=0", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	records, _ = r.body["records"].([]any)
	if len(records) != 2 {
		t.Fatalf("limit=2 returned %d rows", len(records))
	}
	if total, _ := r.body["total"].(float64); total != float64(len(all)) {
		t.Fatalf("paged total = %v, want %d", r.body["total"], len(all))
	}

	// an unknown entity is rejected, not silently ignored
	adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/records?entity=nope", testAdminToken, nil).
		mustStatus(t, http.StatusBadRequest)
}

func TestAdminSearch(t *testing.T) {
	ts := newAdminServer(t)
	userID, token := seedUser(t, ts, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "Alpha"}})

	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/search?q=Research", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	hits, _ := r.body["hits"].([]any)
	if len(hits) != 1 {
		t.Fatalf("want 1 hit, got %d: %s", len(hits), r.raw)
	}
	hit, _ := hits[0].(map[string]any)
	if hit["title"] != "Research" {
		t.Fatalf("hit has no display title: %s", r.raw)
	}
	if hit["tabspace_id"] != "ts1" {
		t.Fatalf("hit does not resolve to its tabverse: %s", r.raw)
	}

	// An empty query is not a "match everything" backdoor.
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID+"/search?q=", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if hits, _ := r.body["hits"].([]any); len(hits) != 0 {
		t.Fatalf("empty query returned %d hits: %s", len(hits), r.raw)
	}
}

// ---- account lifecycle ----------------------------------------------------

func TestRenameAndDeleteAccount(t *testing.T) {
	ts := newAdminServer(t)
	userID, token := seedUser(t, ts, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "Alpha"}})

	adminDo(t, ts, http.MethodPut, "/api/v1/admin/users/"+userID, testAdminToken,
		map[string]string{"name": "alice (work)"}).mustStatus(t, http.StatusNoContent)
	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	user, _ := r.body["user"].(map[string]any)
	if user["name"] != "alice (work)" {
		t.Fatalf("rename did not stick: %s", r.raw)
	}

	adminDo(t, ts, http.MethodDelete, "/api/v1/admin/users/"+userID, testAdminToken, nil).
		mustStatus(t, http.StatusNoContent)

	// The account is gone, and so is every trace of its data: the token that
	// used to reach it is dead.
	adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil).
		mustStatus(t, http.StatusNotFound)
	adminDo(t, ts, http.MethodGet, "/api/v1/sync?since=0", token, nil).
		mustStatus(t, http.StatusUnauthorized)
	// The search index rows went with it: a fresh account with the same id
	// cannot inherit stale hits.
	before := adminDo(t, ts, http.MethodGet, "/api/v1/admin/totals", testAdminToken, nil)
	before.mustStatus(t, http.StatusOK)
	if live, _ := before.body["live_records"].(float64); live != 0 {
		t.Fatalf("records survived the account delete: %s", before.raw)
	}
	if users, _ := before.body["users"].(float64); users != 0 {
		t.Fatalf("account survived the delete: %s", before.raw)
	}
}

// ---- the console itself ---------------------------------------------------

func TestConsoleIsServed(t *testing.T) {
	ts := newAdminServer(t)

	page := doJSON(t, http.MethodGet, ts.URL+"/", "", nil)
	page.mustStatus(t, http.StatusOK)
	if !strings.Contains(page.raw, "<title>tabversed console</title>") {
		t.Fatalf("/ did not serve the console: %s", page.raw)
	}
	for _, asset := range []string{"/assets/console.css", "/assets/console.js"} {
		res := doJSON(t, http.MethodGet, ts.URL+asset, "", nil)
		res.mustStatus(t, http.StatusOK)
		if res.raw == "" {
			t.Fatalf("%s is empty", asset)
		}
	}
	// A client side route falls back to the shell rather than 404ing.
	adminDo(t, ts, http.MethodGet, "/anything/else", "", nil).mustStatus(t, http.StatusOK)
}

// The console is public, the data behind it is not: a device token must not
// open the admin API.
func TestDeviceTokenIsNotAnAdminToken(t *testing.T) {
	ts := newAdminServer(t)
	_, token := seedUser(t, ts, "alice")

	adminDo(t, ts, http.MethodGet, "/api/v1/admin/users", token, nil).
		mustStatus(t, http.StatusUnauthorized)
	adminDo(t, ts, http.MethodGet, "/api/v1/admin/users", testAdminToken, nil).
		mustStatus(t, http.StatusOK)
}

// ---- helpers --------------------------------------------------------------

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// ---- archiving (ADR 0011) -------------------------------------------------

// archiveFlow pairs a device, revokes its token, and returns the ids the
// console needs to archive it and its records.
func archiveFlow(t *testing.T, ts *httptest.Server) (userID, deviceID, tokenHash string) {
	t.Helper()
	userID, token := seedUser(t, ts, "alice")
	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	devices, _ := r.body["devices"].([]any)
	if len(devices) != 1 {
		t.Fatalf("want 1 device, got %d: %s", len(devices), r.raw)
	}
	device, _ := devices[0].(map[string]any)
	deviceID, _ = device["id"].(string)
	tokens, _ := r.body["tokens"].([]any)
	tok, _ := tokens[0].(map[string]any)
	tokenHash, _ = tok["hash"].(string)

	// the device wrote something, so there are records to archive
	now := int64(1700000000000)
	if _, r := push(t, ts, token, []pushedRecord{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"id":"ts1","name":"work","tabIds":[]}`},
	}); r.status != http.StatusOK {
		t.Fatalf("seed push: %s", r.raw)
	}
	adminDo(t, ts, http.MethodDelete,
		"/api/v1/admin/users/"+userID+"/tokens/"+tokenHash, testAdminToken, nil).
		mustStatus(t, http.StatusNoContent)
	return userID, deviceID, tokenHash
}

func TestArchiveRefusesWhileStillUsable(t *testing.T) {
	ts := newAdminServer(t)
	userID, _ := seedUser(t, ts, "alice")
	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	tokens, _ := r.body["tokens"].([]any)
	tok, _ := tokens[0].(map[string]any)
	hash, _ := tok["hash"].(string)
	devices, _ := r.body["devices"].([]any)
	dev, _ := devices[0].(map[string]any)
	deviceID, _ := dev["id"].(string)

	// A live token cannot be archived: revoking is how access is cut, and
	// archiving a usable credential would hide it from the console while it
	// still syncs. 409 carries the reason so the UI can say what to do.
	r = adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/tokens/"+hash+"/archive", testAdminToken, nil)
	r.mustStatus(t, http.StatusConflict)
	if r.body["error"] != "not_revoked" {
		t.Fatalf("error = %v, want not_revoked: %s", r.body["error"], r.raw)
	}
	// the same for a device that still has a usable token
	r = adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/archive", testAdminToken, nil)
	r.mustStatus(t, http.StatusConflict)
	if r.body["error"] != "not_revoked" {
		t.Fatalf("device error = %v: %s", r.body["error"], r.raw)
	}
}

func TestArchiveDeviceAndItsRecords(t *testing.T) {
	ts := newAdminServer(t)
	userID, deviceID, _ := archiveFlow(t, ts)

	// records archive first, then the device itself
	r := adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if archived, _ := r.body["archived"].(float64); archived != 1 {
		t.Fatalf("archived = %v, want 1: %s", r.body["archived"], r.raw)
	}

	r = adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/archive", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)

	// the console's default listing hides the record...
	r = adminDo(t, ts, http.MethodGet,
		"/api/v1/admin/users/"+userID+"/tabspaces", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 0 {
		t.Fatalf("tabverses still listed: %s", r.raw)
	}
	// ...and ?archived=1 shows it again
	r = adminDo(t, ts, http.MethodGet,
		"/api/v1/admin/users/"+userID+"/tabspaces?archived=1", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("archived tabverse not listed: %s", r.raw)
	}

	// the device shows as archived, with its record count
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	devices, _ := r.body["devices"].([]any)
	dev, _ := devices[0].(map[string]any)
	if dev["archived"] != true {
		t.Fatalf("device not listed as archived: %v", dev)
	}
	if n, _ := dev["archived_records"].(float64); n != 1 {
		t.Fatalf("archived_records = %v, want 1: %s", dev["archived_records"], r.raw)
	}

	// the user's own sync is untouched: archiving is an operator flag
	r = adminDo(t, ts, http.MethodGet, "/api/v1/sync?since=0", "", nil)
	if r.status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated sync should still be 401, got %d", r.status)
	}

	// everything comes back
	r = adminDo(t, ts, http.MethodDelete,
		"/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if n, _ := r.body["unarchived"].(float64); n != 1 {
		t.Fatalf("unarchived = %v, want 1: %s", r.body["unarchived"], r.raw)
	}
	r = adminDo(t, ts, http.MethodGet,
		"/api/v1/admin/users/"+userID+"/tabspaces", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("tabverse did not come back: %s", r.raw)
	}
}

func TestArchiveTokenAndUnarchive(t *testing.T) {
	ts := newAdminServer(t)
	userID, _, tokenHash := archiveFlow(t, ts)

	r := adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/tokens/"+tokenHash+"/archive", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)

	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	tokens, _ := r.body["tokens"].([]any)
	tok, _ := tokens[0].(map[string]any)
	if tok["archived"] != true {
		t.Fatalf("token not listed as archived: %v", tok)
	}
	// unarchiving does not un-revoke
	adminDo(t, ts, http.MethodDelete,
		"/api/v1/admin/users/"+userID+"/tokens/"+tokenHash+"/archive", testAdminToken, nil).
		mustStatus(t, http.StatusOK)
	r = adminDo(t, ts, http.MethodGet, "/api/v1/admin/users/"+userID, testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	tokens, _ = r.body["tokens"].([]any)
	tok, _ = tokens[0].(map[string]any)
	if tok["archived"] == true {
		t.Fatalf("token still archived: %v", tok)
	}
	if tok["revoked"] != true {
		t.Fatalf("unarchiving must not re-enable a token: %v", tok)
	}
}

func TestTotalsCountArchived(t *testing.T) {
	ts := newAdminServer(t)
	userID, deviceID, _ := archiveFlow(t, ts)
	adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/archive", testAdminToken, nil).
		mustStatus(t, http.StatusOK)
	adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		testAdminToken, nil).mustStatus(t, http.StatusOK)

	r := adminDo(t, ts, http.MethodGet, "/api/v1/admin/totals", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	for field, want := range map[string]float64{
		"archived_devices": 1, "archived_records": 1, "archived_tokens": 0,
		// archiving hides a record from the console, it does not unstore it
		"live_records": 1,
	} {
		if got, _ := r.body[field].(float64); got != want {
			t.Errorf("%s = %v, want %v (%s)", field, got, want, r.raw)
		}
	}
}

// The console's search must agree with the console's listings; the extension's
// must not be dragged along (ADR 0011).
func TestConsoleSearchHidesArchivedUnlessAsked(t *testing.T) {
	ts := newAdminServer(t)
	userID, deviceID, _ := archiveFlow(t, ts)
	adminDo(t, ts, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		testAdminToken, nil).mustStatus(t, http.StatusOK)

	r := adminDo(t, ts, http.MethodGet,
		"/api/v1/admin/users/"+userID+"/search?q=work", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if hits, _ := r.body["hits"].([]any); len(hits) != 0 {
		t.Fatalf("console search surfaced an archived record: %s", r.raw)
	}
	r = adminDo(t, ts, http.MethodGet,
		"/api/v1/admin/users/"+userID+"/search?q=work&archived=1", testAdminToken, nil)
	r.mustStatus(t, http.StatusOK)
	if hits, _ := r.body["hits"].([]any); len(hits) != 1 {
		t.Fatalf("archived=1 should surface it: %s", r.raw)
	}
}
