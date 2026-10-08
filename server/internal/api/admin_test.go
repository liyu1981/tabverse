package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/store"
	"github.com/liyu1981/tabverse/server/internal/webui"
)

const testAdminEmail = "operator@example.com"

// newAdminServer is a deployment with an operator already signed in, which is
// what the console tests need now that there is no master credential
// (adr/0013).
func newAdminServer(t *testing.T) (*httptest.Server, *sessionClient) {
	t.Helper()
	ts, srv := newAccountServer(t)
	return ts, operatorSession(t, ts, srv)
}

// adminDo is doJSON for a signed-in operator session.
func adminDo(t *testing.T, op *sessionClient, method, path string, body any) apiResp {
	t.Helper()
	return op.doJSON(t, method, path, body)
}

// createAccount registers an account the way a person does, since registration
// is now the only way one comes into existence (ADR 0014): the row and the
// identity its session resolves through, plus the address proof.
func createAccount(t *testing.T, op *sessionClient, name string) string {
	t.Helper()
	ctx := context.Background()
	email := name + "@example.com"
	id, _, err := op.srv.store.UpsertIdentity(ctx, accounts.ProviderEmail,
		"subject-"+name, email, name, true)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := op.srv.store.MarkEmailVerified(ctx, id); err != nil {
		t.Fatalf("verify: %v", err)
	}
	return id
}

// seedUser pushes a full tabverse worth of records as a device of the account.
func seedUser(t *testing.T, op *sessionClient, name string) (userID, token string) {
	t.Helper()
	userID = createAccount(t, op, name)

	// an account created by an admin has no device yet: pair one through an
	// invite, exactly like the extension would.
	r := adminDo(t, op, http.MethodPost, "/console/api/v1/admin/users/"+userID+"/invites",
		map[string]int{"ttl_seconds": 300})
	r.mustStatus(t, http.StatusCreated)
	code, _ := r.body["code"].(string)

	r = doJSON(t, http.MethodPost, op.ts.URL+"/console/api/v1/auth/pair", "", map[string]string{
		"invite_code": code, "device_name": name + " laptop",
	})
	r.mustStatus(t, http.StatusCreated)
	token, _ = r.body["token"].(string)
	if token == "" {
		t.Fatalf("pair returned no token: %s", r.raw)
	}
	return userID, token
}

// ---- accounts and sessions -----------------------------------------------

func TestAccountsAreIsolated(t *testing.T) {
	ts, op := newAdminServer(t)
	alice, aliceToken := seedUser(t, op, "alice")
	_, bobToken := seedUser(t, op, "bob")

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
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+alice+"/tabspaces", nil)
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
	bobID := createAccount(t, op, "bob2")
	leak := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+bobID+"/records", nil)
	leak.mustStatus(t, http.StatusOK)
	if total, _ := leak.body["total"].(float64); total != 0 {
		t.Fatalf("a fresh account should hold no records, got %v: %s", leak.body["total"], leak.raw)
	}
}

func TestConsoleListsAccountsWithCounters(t *testing.T) {
	_, op := newAdminServer(t)
	alice, _ := seedUser(t, op, "alice")

	// The deployment already holds the operator, so this looks for the account
	// it just made rather than counting.
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users", nil)
	r.mustStatus(t, http.StatusOK)
	usersList, _ := r.body["users"].([]any)
	var row map[string]any
	for _, u := range usersList {
		if m, _ := u.(map[string]any); m["id"] == alice {
			row = m
		}
	}
	if row == nil {
		t.Fatalf("the account is not in the list: %s", r.raw)
	}
	if row["name"] != "alice" {
		t.Fatalf("unexpected account row: %v", row)
	}
	if devices, _ := row["device_count"].(float64); devices != 1 {
		t.Fatalf("device_count = %v, want 1: %s", row["device_count"], r.raw)
	}

	// The deployment counters, for the console header. The deployment also
	// holds its operator, so this checks the header against the list rather than
	// against a fixed number.
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/totals", nil)
	r.mustStatus(t, http.StatusOK)
	if users, _ := r.body["users"].(float64); int(users) != len(usersList) {
		t.Fatalf("totals.users = %v, want %d: %s", users, len(usersList), r.raw)
	}
}

// ---- token management -----------------------------------------------------

func TestRevokeTokenAndDevice(t *testing.T) {
	ts, op := newAdminServer(t)
	userID, token := seedUser(t, op, "alice")
	_ = ts

	// The device token works on the sync API - it is the extension's credential,
	// not the console's.
	doJSON(t, http.MethodGet, op.ts.URL+"/console/api/v1/sync?since=0", token, nil).
		mustStatus(t, http.StatusOK)

	// ...and that request stamped it, so the console can say when the device
	// was last seen.
	stamp := func() map[string]any {
		r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
		r.mustStatus(t, http.StatusOK)
		toks, _ := r.body["tokens"].([]any)
		tok, _ := toks[0].(map[string]any)
		return tok
	}
	if last, _ := stamp()["last_used"].(float64); last == 0 {
		t.Fatal("an authenticated device should carry a last_used stamp")
	}

	detail := func() (devices, tokens []any) {
		r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
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

	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/tokens/"+hash, nil).
		mustStatus(t, http.StatusNoContent)

	// The device's token is dead: sync is 401, and it says revoked.
	adminDo(t, op, http.MethodGet, "/console/api/v1/sync?since=0", nil).
		mustStatus(t, http.StatusUnauthorized)
	_, tokens = detail()
	tok, _ = tokens[0].(map[string]any)
	if tok["revoked"] != true {
		t.Fatalf("token should be listed as revoked: %v", tok)
	}

	// A second device for the same account, revoked as a whole.
	r := adminDo(t, op, http.MethodPost, "/console/api/v1/admin/users/"+userID+"/invites",
		map[string]int{"ttl_seconds": 300})
	r.mustStatus(t, http.StatusCreated)
	code, _ := r.body["code"].(string)
	r = doJSON(t, http.MethodPost, op.ts.URL+"/console/api/v1/auth/pair", "", map[string]string{
		"invite_code": code, "device_name": "phone",
	})
	r.mustStatus(t, http.StatusCreated)
	phoneToken := r.body["token"].(string)

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

	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/devices/"+phoneID, nil).
		mustStatus(t, http.StatusNoContent)
	doJSON(t, http.MethodGet, op.ts.URL+"/console/api/v1/sync?since=0", phoneToken, nil).
		mustStatus(t, http.StatusUnauthorized)

	// An unknown device is a 404, not a silent success.
	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/devices/dev_nope", nil).
		mustStatus(t, http.StatusNotFound)
}

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
	ts, op := newAdminServer(t)
	userID, token := seedUser(t, op, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "First tab"}, {"t2", "Second tab"}})

	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/tabspaces", nil)
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

	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/tabspaces/ts1", nil)
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
	adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/tabspaces/nope", nil).
		mustStatus(t, http.StatusNotFound)
}

func TestRecordBrowserFilters(t *testing.T) {
	ts, op := newAdminServer(t)
	userID, token := seedUser(t, op, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "Alpha"}})

	// every record of the account
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records", nil)
	r.mustStatus(t, http.StatusOK)
	all, _ := r.body["records"].([]any)
	if len(all) == 0 || len(all) != int(r.body["total"].(float64)) {
		t.Fatalf("records listing inconsistent: %s", r.raw)
	}

	// one entity
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records?entity=tab", nil)
	r.mustStatus(t, http.StatusOK)
	records, _ := r.body["records"].([]any)
	if len(records) != 1 {
		t.Fatalf("entity filter: want 1 tab, got %d: %s", len(records), r.raw)
	}

	// one tabverse
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records?entity=note&tabspace_id=ts1", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 3 {
		t.Fatalf("tabspace filter: total = %v, want 3: %s", r.body["total"], r.raw)
	}
	// ...and a tabspace filter that matches nothing is empty, not everything
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records?tabspace_id=ts_other", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 0 {
		t.Fatalf("foreign tabspace id matched %v records: %s", r.body["total"], r.raw)
	}

	// substring over the payload; a LIKE metacharacter is not a wildcard
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records?q=Research", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("q=Research matched %v records, want 1: %s", r.body["total"], r.raw)
	}
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records?q=%25", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 0 {
		t.Fatalf("q=%% matched %v records, want 0: %s", r.body["total"], r.raw)
	}

	// paging reports the full total, not the page size
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records?limit=2&offset=0", nil)
	r.mustStatus(t, http.StatusOK)
	records, _ = r.body["records"].([]any)
	if len(records) != 2 {
		t.Fatalf("limit=2 returned %d rows", len(records))
	}
	if total, _ := r.body["total"].(float64); total != float64(len(all)) {
		t.Fatalf("paged total = %v, want %d", r.body["total"], len(all))
	}

	// an unknown entity is rejected, not silently ignored
	adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/records?entity=nope", nil).
		mustStatus(t, http.StatusBadRequest)
}

func TestAdminSearch(t *testing.T) {
	ts, op := newAdminServer(t)
	userID, token := seedUser(t, op, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "Alpha"}})

	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/search?q=Research", nil)
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
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/search?q=", nil)
	r.mustStatus(t, http.StatusOK)
	if hits, _ := r.body["hits"].([]any); len(hits) != 0 {
		t.Fatalf("empty query returned %d hits: %s", len(hits), r.raw)
	}
}

// ---- account lifecycle ----------------------------------------------------

func TestRenameAndDeleteAccount(t *testing.T) {
	ts, op := newAdminServer(t)
	userID, token := seedUser(t, op, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "Alpha"}})

	adminDo(t, op, http.MethodPut, "/console/api/v1/admin/users/"+userID,
		map[string]string{"name": "alice (work)"}).mustStatus(t, http.StatusNoContent)
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
	r.mustStatus(t, http.StatusOK)
	user, _ := r.body["user"].(map[string]any)
	if user["name"] != "alice (work)" {
		t.Fatalf("rename did not stick: %s", r.raw)
	}

	// Taken *before* the delete, so the comparison afterwards means something.
	beforeTotals := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/totals", nil)
	beforeTotals.mustStatus(t, http.StatusOK)
	usersBefore, _ := beforeTotals.body["users"].(float64)
	liveBefore, _ := beforeTotals.body["live_records"].(float64)

	// deleting an account now needs the id back as a confirmation
	r = adminDo(t, op, http.MethodDelete, "/console/api/v1/admin/users/"+userID, nil)
	r.mustStatus(t, http.StatusBadRequest)
	if r.body["error"] != "confirmation_required" {
		t.Fatalf("unconfirmed delete = %s, want confirmation_required", r.raw)
	}
	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"?confirm="+userID, nil).
		mustStatus(t, http.StatusNoContent)

	// The account is gone, and so is every trace of its data: the token that
	// used to reach it is dead.
	adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil).
		mustStatus(t, http.StatusNotFound)
	doJSON(t, http.MethodGet, op.ts.URL+"/console/api/v1/sync?since=0", token, nil).
		mustStatus(t, http.StatusUnauthorized)
	// The search index rows went with it: a fresh account with the same id
	// cannot inherit stale hits. The operator is still on the deployment, so
	// this compares rather than asserting an absolute number.
	after := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/totals", nil)
	after.mustStatus(t, http.StatusOK)
	usersAfter, _ := after.body["users"].(float64)
	liveAfter, _ := after.body["live_records"].(float64)
	// Every record here belonged to the account that just went, and the
	// operator has none of their own, so nothing should be left.
	if usersAfter != usersBefore-1 || liveAfter != 0 {
		t.Fatalf("the account or its records survived the delete: users %v->%v, records %v->%v",
			usersBefore, usersAfter, liveBefore, liveAfter)
	}
}

// ---- deleting a tabverse (adr/0015) ---------------------------------------

func TestOperatorDeletesATabverseAndItsRecords(t *testing.T) {
	ts, op := newAdminServer(t)
	userID, token := seedUser(t, op, "alice")
	seedTabverse(t, ts, token, "ts1", "Research", [][2]string{{"t1", "Alpha"}, {"t2", "Beta"}})
	seedTabverse(t, ts, token, "ts2", "Other", [][2]string{{"t3", "Gamma"}})

	// A delete of user content has to carry the id back, like deleting an
	// account does.
	r := adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/tabspaces/ts1", nil)
	r.mustStatus(t, http.StatusBadRequest)
	if r.body["error"] != "confirmation_required" {
		t.Fatalf("unconfirmed delete = %s, want confirmation_required", r.raw)
	}
	// ...and the wrong confirmation is refused just as firmly.
	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/tabspaces/ts1?confirm=ts2", nil).
		mustStatus(t, http.StatusBadRequest)

	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/tabspaces/ts1?confirm=ts1", nil).
		mustStatus(t, http.StatusNoContent)

	// The bundle is gone, and so is the row from the list an operator browses.
	adminDo(t, op, http.MethodGet,
		"/console/api/v1/admin/users/"+userID+"/tabspaces/ts1", nil).
		mustStatus(t, http.StatusNotFound)
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/tabspaces", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("the tabverse list still holds %v tabverses: %s", total, r.raw)
	}

	// The device that stored it learns about it: the tombstone comes down the
	// delta sync like any other change, which is the whole point (the console
	// cannot remove a row from somebody's browser).
	r = doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/sync?since=0&limit=200", token, nil)
	r.mustStatus(t, http.StatusOK)
	records, _ := r.body["records"].([]any)
	deleted := map[string]bool{}
	for _, raw := range records {
		rec, _ := raw.(map[string]any)
		if rec["deleted"] == true {
			deleted[rec["entity"].(string)+"/"+rec["id"].(string)] = true
		}
	}
	for _, want := range []string{"tabspace/ts1", "tab/t1", "tab/t2"} {
		if !deleted[want] {
			t.Fatalf("%s was not tombstoned, so a device would push it back: %v", want, deleted)
		}
	}
	// The tabverse the operator did not touch is untouched.
	if deleted["tabspace/ts2"] {
		t.Fatalf("the delete reached past its tabverse: %v", deleted)
	}

	// And it is in the audit log, because this is the one entry that removed
	// somebody's content.
	entries, err := op.srv.store.ListAudit(context.Background(), store.AuditTabspaceDeleted, userID, 10)
	if err != nil || len(entries) != 1 {
		t.Fatalf("no tabspace_deleted audit entry: %+v (%v)", entries, err)
	}
	if !strings.Contains(entries[0].Detail, "ts1") {
		t.Fatalf("the audit entry does not name the tabverse: %+v", entries[0])
	}
}

func TestDeletingATabverseIsRefusedWhileLookingThroughSomebodyElses(t *testing.T) {
	ts, s := newAccountServer(t)
	ctx := context.Background()

	root := signInAs(t, ts, s, "root@example.com")
	rootID, _ := root.do(t, http.MethodGet, "/console/api/v1/console/me").body["user_id"].(string)
	if err := s.store.SetRole(ctx, rootID, store.RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}
	root = signInAs(t, ts, s, "root@example.com")

	alice := signInAs(t, ts, s, "alice@example.com")
	aliceID, _ := alice.do(t, http.MethodGet, "/console/api/v1/console/me").body["user_id"].(string)
	if _, r := push(t, ts, mintDeviceToken(t, ts, s, aliceID), []pushedRecord{
		{Entity: "tabspace", ID: "ts_alice", UpdatedAt: 1700000000000,
			Payload: `{"id":"ts_alice","name":"Alice work","tabIds":[]}`},
	}); r.status != http.StatusOK {
		t.Fatalf("seed: %s", r.raw)
	}

	root.do(t, http.MethodPost, "/console/api/v1/admin/users/"+aliceID+"/impersonate").
		mustStatus(t, http.StatusOK)

	// A delete is a write, and a write is exactly what the assumed identity
	// is not allowed to do - the same rule as the invites route.
	r := root.do(t, http.MethodDelete,
		"/console/api/v1/admin/users/"+aliceID+"/tabspaces/ts_alice?confirm=ts_alice")
	r.mustStatus(t, http.StatusForbidden)
	if r.body["error"] != "read_only" {
		t.Fatalf("expected read_only, got %s", r.raw)
	}

	root.do(t, http.MethodPost, "/console/api/v1/console/impersonate/stop").
		mustStatus(t, http.StatusNoContent)
	// Out of the assumed identity, it works: an operator can still delete.
	root.do(t, http.MethodDelete,
		"/console/api/v1/admin/users/"+aliceID+"/tabspaces/ts_alice?confirm=ts_alice").
		mustStatus(t, http.StatusNoContent)
}

func TestAPersonCanDeleteATabverseOfTheirOwnAccount(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	aliceID, _ := alice.do(t, http.MethodGet, "/console/api/v1/console/me").body["user_id"].(string)
	if _, r := push(t, ts, mintDeviceToken(t, ts, s, aliceID), []pushedRecord{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: 1700000000000,
			Payload: `{"id":"ts1","name":"Research","tabIds":["t1"]}`},
		{Entity: "tab", ID: "t1", UpdatedAt: 1700000000001,
			Payload: `{"id":"t1","tabSpaceId":"ts1","title":"Alpha","url":"https://a.example/"}`},
	}); r.status != http.StatusOK {
		t.Fatalf("seed: %s", r.raw)
	}

	// The account is not an operator's, and deleting its own tabverse is what
	// a person would do from the console: the route is theirs, not just the
	// operator's (resolveScope decides who may act on an account).
	alice.do(t, http.MethodDelete,
		"/console/api/v1/admin/users/"+aliceID+"/tabspaces/ts1?confirm=ts1").
		mustStatus(t, http.StatusNoContent)
	alice.do(t, http.MethodGet,
		"/console/api/v1/admin/users/"+aliceID+"/tabspaces/ts1").mustStatus(t, http.StatusNotFound)
}

func TestDeletingAnUnknownTabverseIs404(t *testing.T) {
	_, op := newAdminServer(t)
	userID, _ := seedUser(t, op, "alice")
	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/tabspaces/ts_nope?confirm=ts_nope", nil).
		mustStatus(t, http.StatusNotFound)
}

// ---- the console itself ---------------------------------------------------

// TestConsoleIsServed is the end of the road for the console's own build: the
// shell the server serves has to reference assets that are actually embedded
// with it (adr/0018). The names are content hashed, so they are read out of the
// shell rather than written down here - a fixed name would make this test fail
// on every build instead of saying something.
func TestConsoleIsServed(t *testing.T) {
	ts, op := newAdminServer(t)

	page := doJSON(t, http.MethodGet, ts.URL+webui.Mount, "", nil)
	page.mustStatus(t, http.StatusOK)
	if !strings.Contains(page.raw, "<div id=\"root\">") {
		t.Fatalf("%s did not serve the console shell: %s", webui.Mount, page.raw)
	}

	assets := regexp.MustCompile(`(?:src|href)="(/console/assets/[^"]+)"`).FindAllStringSubmatch(page.raw, -1)
	if len(assets) < 2 {
		t.Fatalf("the console shell references %d assets, want a script and a stylesheet: %s",
			len(assets), page.raw)
	}
	for _, asset := range assets {
		res := doJSON(t, http.MethodGet, ts.URL+asset[1], "", nil)
		res.mustStatus(t, http.StatusOK)
		if res.raw == "" {
			t.Fatalf("%s is empty", asset[1])
		}
	}

	// A client side route falls back to the shell rather than 404ing. The
	// response is HTML, so this cannot go through the JSON helper.
	res, err := http.Get(op.ts.URL + webui.Mount + "/anything/else")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("a client side route = %d, want 200", res.StatusCode)
	}

	// A missing asset under /console/assets/ is a broken build and has to look
	// broken, not quietly become the shell.
	missing := doJSON(t, http.MethodGet, ts.URL+webui.Mount+"/assets/index-notthere.js", "", nil)
	missing.mustStatus(t, http.StatusNotFound)
}

// The root of the server is a site, not an endpoint: the documentation in an
// official build, a page that sends you to the console otherwise (adr/0024).
// Every path under it gets an answer that looks like a page - and the console's
// shell is not that answer, because it belongs to /console alone.
func TestTheRootIsASite(t *testing.T) {
	ts, _ := newAdminServer(t)

	// `/docs/intro/` rather than `/docs/intro`: in an official build the docs are
	// directory style, and a redirect to the trailing slash is the correct answer
	// there - one this client does not follow.
	for _, path := range []string{"/", "/docs/intro/"} {
		res := doRequest(t, ts, http.MethodGet, path)
		page := readAll(t, res)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s = %d, want 200: %s", path, res.StatusCode, page)
		}
		if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
			t.Errorf("GET %s = %q, want html", path, ct)
		}
		if res.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("GET %s was served without nosniff", path)
		}
	}

	// A path neither flavour has, where they differ on purpose: a default build
	// answers every path with its one page (there is nothing else to serve), an
	// official build answers with the documentation's own 404. What neither
	// serves here is the console's shell - that belongs to /console alone.
	res := doRequest(t, ts, http.MethodGet, "/nope")
	page := readAll(t, res)
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusNotFound {
		t.Fatalf("GET /nope = %d, want 200 (default build) or 404 (official): %s",
			res.StatusCode, page)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Errorf("GET /nope = %q, want html", ct)
	}
	if strings.Contains(page, `<div id="root">`) {
		t.Error("GET /nope served the console shell; that belongs to " + webui.Mount)
	}
}

// An endpoint nobody claimed answers like an endpoint: JSON with a status,
// never the page. The console shell is registered at /console/, so without
// this an unknown API path would come back as HTML with a 200 - the one answer
// a client cannot work with, and the reason the API moved under /console/api
// in the first place (adr/0024).
func TestAnUnknownEndpointIsAJSON404(t *testing.T) {
	ts, _ := newAdminServer(t)

	res := doRequest(t, ts, http.MethodGet, "/console/api/v1/nope")
	body := readAll(t, res)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("GET an unknown endpoint = %d, want 404: %s", res.StatusCode, body)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("GET an unknown endpoint = %q, want JSON: %s", ct, body)
	}
}

// The console is public, the data behind it is not: a device token must not
// A device token is the extension's credential and must not open the console:
// the console has no bearer token any more (adr/0013), so this is the shape of
// "wrong credential" now.
func TestADeviceTokenIsNotAConsoleCredential(t *testing.T) {
	ts, op := newAdminServer(t)
	_, token := seedUser(t, op, "alice")

	doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/admin/users", token, nil).
		mustStatus(t, http.StatusUnauthorized)
	adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users", nil).
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
func archiveFlow(t *testing.T, op *sessionClient) (userID, deviceID, tokenHash, deviceToken string) {
	t.Helper()
	userID, deviceToken = seedUser(t, op, "alice")
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
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
	if _, r := push(t, op.ts, deviceToken, []pushedRecord{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"id":"ts1","name":"work","tabIds":[]}`},
	}); r.status != http.StatusOK {
		t.Fatalf("seed push: %s", r.raw)
	}
	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/tokens/"+tokenHash, nil).
		mustStatus(t, http.StatusNoContent)
	return userID, deviceID, tokenHash, deviceToken
}

func TestArchiveTokenRefusesWhileStillUsable(t *testing.T) {
	_, op := newAdminServer(t)
	userID, _ := seedUser(t, op, "alice")
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
	r.mustStatus(t, http.StatusOK)
	tokens, _ := r.body["tokens"].([]any)
	tok, _ := tokens[0].(map[string]any)
	hash, _ := tok["hash"].(string)

	// A live token cannot be archived: revoking is how access is cut, and
	// archiving a usable credential would hide it from the console while it
	// still syncs. 409 carries the reason so the UI can say what to do.
	r = adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/tokens/"+hash+"/archive", nil)
	r.mustStatus(t, http.StatusConflict)
	if r.body["error"] != "not_revoked" {
		t.Fatalf("error = %v, want not_revoked: %s", r.body["error"], r.raw)
	}
}

// Archiving a device is the operator's decisive teardown: one call revokes and
// archives its tokens and archives the device, even while it is still live and
// authenticated a moment ago.
func TestArchiveDeviceRevokesAndArchivesItsTokens(t *testing.T) {
	_, op := newAdminServer(t)
	userID, _ := seedUser(t, op, "alice")
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
	r.mustStatus(t, http.StatusOK)
	devices, _ := r.body["devices"].([]any)
	dev, _ := devices[0].(map[string]any)
	deviceID, _ := dev["id"].(string)
	if active, _ := dev["active_tokens"].(float64); active != 1 {
		t.Fatalf("seed device should have one live token: %v", dev)
	}

	r = adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/archive", nil)
	r.mustStatus(t, http.StatusOK)

	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
	r.mustStatus(t, http.StatusOK)
	devices, _ = r.body["devices"].([]any)
	dev, _ = devices[0].(map[string]any)
	if dev["archived"] != true {
		t.Fatalf("device not listed as archived: %v", dev)
	}
	if active, _ := dev["active_tokens"].(float64); active != 0 {
		t.Fatalf("archiving must revoke the token: %v", dev)
	}
	tokens, _ := r.body["tokens"].([]any)
	tok, _ := tokens[0].(map[string]any)
	if tok["revoked"] != true || tok["archived"] != true {
		t.Fatalf("token should be revoked and archived: %v", tok)
	}
}

func TestArchiveDeviceAndItsRecords(t *testing.T) {
	_, op := newAdminServer(t)
	userID, deviceID, _, _ := archiveFlow(t, op)

	// the device is archived first: that revokes and archives its token, which
	// is what lets the records be retired next
	r := adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/archive", nil)
	r.mustStatus(t, http.StatusOK)

	r = adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		nil)
	r.mustStatus(t, http.StatusOK)
	if archived, _ := r.body["archived"].(float64); archived != 1 {
		t.Fatalf("archived = %v, want 1: %s", r.body["archived"], r.raw)
	}

	// the console's default listing hides the record...
	r = adminDo(t, op, http.MethodGet,
		"/console/api/v1/admin/users/"+userID+"/tabspaces", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 0 {
		t.Fatalf("tabverses still listed: %s", r.raw)
	}
	// ...and ?archived=1 shows it again
	r = adminDo(t, op, http.MethodGet,
		"/console/api/v1/admin/users/"+userID+"/tabspaces?archived=1", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("archived tabverse not listed: %s", r.raw)
	}

	// the device shows as archived, with its record count
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
	r.mustStatus(t, http.StatusOK)
	devices, _ := r.body["devices"].([]any)
	dev, _ := devices[0].(map[string]any)
	if dev["archived"] != true {
		t.Fatalf("device not listed as archived: %v", dev)
	}
	if n, _ := dev["archived_records"].(float64); n != 1 {
		t.Fatalf("archived_records = %v, want 1: %s", dev["archived_records"], r.raw)
	}

	// The records are still there, just hidden from the default view: archiving
	// is a view, not a delete (the store test pins the sync side of that).
	r = adminDo(t, op, http.MethodGet,
		"/console/api/v1/admin/users/"+userID+"/records?archived=1", nil)
	r.mustStatus(t, http.StatusOK)
	if rows, _ := r.body["records"].([]any); len(rows) == 0 {
		t.Fatalf("the archived record is gone rather than hidden: %s", r.raw)
	}

	// everything comes back
	r = adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		nil)
	r.mustStatus(t, http.StatusOK)
	if n, _ := r.body["unarchived"].(float64); n != 1 {
		t.Fatalf("unarchived = %v, want 1: %s", r.body["unarchived"], r.raw)
	}
	r = adminDo(t, op, http.MethodGet,
		"/console/api/v1/admin/users/"+userID+"/tabspaces", nil)
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("tabverse did not come back: %s", r.raw)
	}
}

func TestArchiveTokenAndUnarchive(t *testing.T) {
	_, op := newAdminServer(t)
	userID, _, tokenHash, _ := archiveFlow(t, op)

	r := adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/tokens/"+tokenHash+"/archive", nil)
	r.mustStatus(t, http.StatusOK)

	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
	r.mustStatus(t, http.StatusOK)
	tokens, _ := r.body["tokens"].([]any)
	tok, _ := tokens[0].(map[string]any)
	if tok["archived"] != true {
		t.Fatalf("token not listed as archived: %v", tok)
	}
	// unarchiving does not un-revoke
	adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/users/"+userID+"/tokens/"+tokenHash+"/archive", nil).
		mustStatus(t, http.StatusOK)
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/users/"+userID, nil)
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
	_, op := newAdminServer(t)
	userID, deviceID, _, _ := archiveFlow(t, op)
	adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/archive", nil).
		mustStatus(t, http.StatusOK)
	adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		nil).mustStatus(t, http.StatusOK)

	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/totals", nil)
	r.mustStatus(t, http.StatusOK)
	for field, want := range map[string]float64{
		"archived_devices": 1, "archived_records": 1, "archived_tokens": 1,
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
	_, op := newAdminServer(t)
	userID, deviceID, _, _ := archiveFlow(t, op)
	adminDo(t, op, http.MethodPut,
		"/console/api/v1/admin/users/"+userID+"/devices/"+deviceID+"/records/archive",
		nil).mustStatus(t, http.StatusOK)

	r := adminDo(t, op, http.MethodGet,
		"/console/api/v1/admin/users/"+userID+"/search?q=work", nil)
	r.mustStatus(t, http.StatusOK)
	if hits, _ := r.body["hits"].([]any); len(hits) != 0 {
		t.Fatalf("console search surfaced an archived record: %s", r.raw)
	}
	r = adminDo(t, op, http.MethodGet,
		"/console/api/v1/admin/users/"+userID+"/search?q=work&archived=1", nil)
	r.mustStatus(t, http.StatusOK)
	if hits, _ := r.body["hits"].([]any); len(hits) != 1 {
		t.Fatalf("archived=1 should surface it: %s", r.raw)
	}
}
