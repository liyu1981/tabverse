package store

import (
	"context"
	"strings"
	"testing"
	"time"
)

// A Launchpad shortcut is account level: it has no tabSpaceId, it is not a
// tabverse child, and deleting a tabverse must leave it alone. It is stored and
// synced like any other record, and its icon bytes stay in the payload.
func TestShortcutIsAnAccountLevelRecord(t *testing.T) {
	if err := ValidateEntity("shortcut"); err != nil {
		t.Fatalf("shortcut should be a valid entity: %v", err)
	}
	if IndexedEntities["shortcut"] {
		t.Fatal("shortcut must not be in the full text index (its icon is base64)")
	}
	for _, entity := range tabspaceEntities {
		if entity == "shortcut" {
			t.Fatal("shortcut must not be a tabverse child: a tabverse delete would remove it")
		}
	}

	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "shortcut")
	now := time.Now().UnixMilli()

	payload := `{"name":"Figma","url":"https://www.figma.com/","iconDataUrl":"data:image/png;base64,AAA","iconUrl":"https://www.figma.com/apple.png"}`
	_, _, err := st.ApplyRecords(ctx, userID, "dev_1", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"name":"work","tabIds":[]}`},
		{Entity: "tab", ID: "t1", UpdatedAt: now + 1, Payload: `{"tabSpaceId":"ts1","title":"a tab"}`},
		{Entity: "shortcut", ID: "s1", UpdatedAt: now + 2, Payload: payload},
	}, 1<<20)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}

	// the tabverse bundle does not claim it
	bundle, err := st.GetTabspaceBundle(ctx, userID, "ts1")
	if err != nil {
		t.Fatalf("bundle: %v", err)
	}
	if len(bundle.Tabs) != 1 {
		t.Fatalf("bundle tabs = %d, want 1", len(bundle.Tabs))
	}
	rows, _, err := st.ListRecords(ctx, userID, RecordFilter{TabspaceID: "ts1"})
	if err != nil {
		t.Fatalf("list by tabverse: %v", err)
	}
	for _, row := range rows {
		if row.Entity == "shortcut" {
			t.Fatalf("a shortcut is not a child of ts1: %+v", row)
		}
	}

	// the console's record browser still sees it, filtered by entity
	shortcuts, total, err := st.ListRecords(ctx, userID, RecordFilter{Entity: "shortcut"})
	if err != nil {
		t.Fatalf("list shortcuts: %v", err)
	}
	if total != 1 || len(shortcuts) != 1 || shortcuts[0].ID != "s1" {
		t.Fatalf("shortcut list = %+v total=%d", shortcuts, total)
	}

	// deleting the tabverse does not touch it
	result, err := st.DeleteTabspace(ctx, userID, "ts1", "dev_1", now+10, 1<<20)
	if err != nil {
		t.Fatalf("delete tabverse: %v", err)
	}
	if result.Tombstoned < 2 {
		t.Fatalf("the tabverse and its tab should be tombstoned, got %+v", result)
	}
	rec, err := st.GetRecord(ctx, userID, "shortcut", "s1")
	if err != nil {
		t.Fatalf("shortcut vanished with the tabverse: %v", err)
	}
	if rec.Deleted || rec.Payload != payload {
		t.Fatalf("shortcut changed: %+v", rec)
	}

	// secrets stay searchable content, not search noise: the shortcut is not
	// indexed at all, so a term from its payload matches nothing
	hits, err := st.Search(ctx, userID, "Figma", "", 20)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	for _, hit := range hits {
		if hit.Entity == "shortcut" {
			t.Fatalf("a shortcut reached the index: %+v", hit)
		}
	}

	title, url := displayTitle("shortcut", "s1", payload)
	if title != "Figma" || url != "https://www.figma.com/" {
		t.Fatalf("displayTitle = %q %q", title, url)
	}

	// the icon data is not content: it must never reach the indexed body
	body := ftsBody(payload)
	if strings.Contains(body, "base64") || strings.Contains(body, "data:image") {
		t.Fatalf("icon data leaked into the search body: %q", body)
	}
}
