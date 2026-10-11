package api

import (
	"net/http"
	"testing"
)

// The signed-in person's own search: one endpoint, resolved from the session,
// finding every content entity and labelling each hit's tabverse so the console
// can group them.
func TestConsoleSearchFindsEveryEntityForTheSignedInUser(t *testing.T) {
	ts, s := newAccountServer(t)
	op := operatorSession(t, ts, s)

	me := op.do(t, http.MethodGet, "/console/api/v1/console/me")
	me.mustStatus(t, http.StatusOK)
	userID, _ := me.body["user_id"].(string)
	if userID == "" {
		t.Fatalf("no user id: %s", me.raw)
	}

	token := mintDeviceToken(t, ts, s, userID)
	if _, r := push(t, ts, token, []pushedRecord{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: 1, Payload: `{"name":"Research"}`},
		{Entity: "tab", ID: "t1", UpdatedAt: 2, Payload: `{"title":"pasta recipe","url":"https://example.com/a","tabSpaceId":"ts1"}`},
		{Entity: "closedtab", ID: "c1", UpdatedAt: 3, Payload: `{"title":"old pasta","tabSpaceId":"ts1"}`},
		{Entity: "note", ID: "n1", UpdatedAt: 4, Payload: `{"name":"pasta note","tabSpaceId":"ts1"}`},
		{Entity: "todo", ID: "td1", UpdatedAt: 5, Payload: `{"content":"buy pasta","tabSpaceId":"ts1"}`},
		{Entity: "bookmark", ID: "b1", UpdatedAt: 6, Payload: `{"name":"pasta site","tabSpaceId":"ts1"}`},
	}); r.status != http.StatusOK {
		t.Fatalf("seed push: %d %s", r.status, r.raw)
	}

	r := adminDo(t, op, http.MethodGet, "/console/api/v1/console/search?q=pasta", nil)
	r.mustStatus(t, http.StatusOK)
	hits, _ := r.body["hits"].([]any)
	if len(hits) < 5 {
		t.Fatalf("expected hits across entities, got %d: %s", len(hits), r.raw)
	}
	entities := map[string]bool{}
	for _, raw := range hits {
		hit, _ := raw.(map[string]any)
		entity, _ := hit["entity"].(string)
		entities[entity] = true
		if entity != "tabspace" {
			if hit["tabspace_title"] != "Research" {
				t.Errorf("%s hit has no tabverse title: %v", entity, hit)
			}
		}
	}
	for _, want := range []string{"tab", "closedtab", "note", "todo", "bookmark"} {
		if !entities[want] {
			t.Errorf("no %s hit: %v", want, entities)
		}
	}

	// No query is an empty result, not an error.
	empty := adminDo(t, op, http.MethodGet, "/console/api/v1/console/search", nil)
	empty.mustStatus(t, http.StatusOK)
	if len(empty.body["hits"].([]any)) != 0 {
		t.Fatalf("no query should return nothing: %s", empty.raw)
	}
}
