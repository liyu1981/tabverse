package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Archiving (ADR 0011) has three rules worth pinning down, and one of them is a
// safety property rather than a feature: an archived record is still the user's
// data and must keep syncing to their devices.

func archivedDevice(t *testing.T, st *Store, userID string) (deviceID, tokenHash string) {
	t.Helper()
	ctx := context.Background()
	device, err := st.CreateDevice(ctx, "dev_gone", userID, "lost laptop")
	if err != nil {
		t.Fatalf("create device: %v", err)
	}
	hash := "hash_of_revoked_token"
	if err := st.CreateToken(ctx, hash, userID, device.ID); err != nil {
		t.Fatalf("create token: %v", err)
	}
	if err := st.RevokeToken(ctx, userID, hash); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	// backdate the pairing so the inactivity rule (30 days by default) is met
	if _, err := st.DB().ExecContext(ctx,
		`UPDATE devices SET created_at = ? WHERE id = ?`,
		time.Now().Add(-90*24*time.Hour).UnixMilli(), device.ID); err != nil {
		t.Fatalf("backdate device: %v", err)
	}
	return device.ID, hash
}

func TestArchiveTokenRequiresRevocation(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "alice")
	device, err := st.CreateDevice(ctx, "dev_live", userID, "laptop")
	if err != nil {
		t.Fatalf("create device: %v", err)
	}
	hash := "live_hash"
	if err := st.CreateToken(ctx, hash, userID, device.ID); err != nil {
		t.Fatalf("create token: %v", err)
	}

	// A token that still works cannot be archived: that is what revoking is
	// for, and archiving a live credential would hide access from the console.
	if _, err := st.ArchiveToken(ctx, userID, hash); !errors.Is(err, ErrNotRevoked) {
		t.Fatalf("archiving a live token = %v, want ErrNotRevoked", err)
	}

	if err := st.RevokeToken(ctx, userID, hash); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	out, err := st.ArchiveToken(ctx, userID, hash)
	if err != nil {
		t.Fatalf("archive after revoke: %v", err)
	}
	if out.Archived != 1 {
		t.Fatalf("outcome = %+v, want one archived", out)
	}
	// Repeating it is visible as a no-op, not silently "successful".
	out, err = st.ArchiveToken(ctx, userID, hash)
	if err != nil || out.Skipped != 1 {
		t.Fatalf("second archive = %+v (%v), want skipped", out, err)
	}
	// and it comes back
	out, err = st.UnarchiveToken(ctx, userID, hash)
	if err != nil || out.Unarchived != 1 {
		t.Fatalf("unarchive = %+v (%v)", out, err)
	}
	// unarchiving does not re-enable a revoked token
	revoked, err := st.IsRevoked(ctx, userID, hash)
	if err != nil || !revoked {
		t.Fatalf("token came back usable: revoked=%v (%v)", revoked, err)
	}
}

func TestArchiveDeviceNeedsRevokedAndInactive(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "alice")

	// 1. a live token blocks it
	live, err := st.CreateDevice(ctx, "dev_live", userID, "laptop")
	if err != nil {
		t.Fatalf("create device: %v", err)
	}
	if err := st.CreateToken(ctx, "h1", userID, live.ID); err != nil {
		t.Fatalf("create token: %v", err)
	}
	if _, err := st.ArchiveDevice(ctx, userID, live.ID, 30); !errors.Is(err, ErrNotRevoked) {
		t.Fatalf("archiving a device with a live token = %v, want ErrNotRevoked", err)
	}

	// 2. revoked, but used yesterday: still too recent
	recent, err := st.CreateDevice(ctx, "dev_recent", userID, "phone")
	if err != nil {
		t.Fatalf("create device: %v", err)
	}
	if err := st.CreateToken(ctx, "h2", userID, recent.ID); err != nil {
		t.Fatalf("create token: %v", err)
	}
	if err := st.RevokeToken(ctx, userID, "h2"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := st.TouchToken(ctx, "h2"); err != nil {
		t.Fatalf("touch: %v", err)
	}
	if _, err := st.ArchiveDevice(ctx, userID, recent.ID, 30); err == nil {
		t.Fatal("a device used today should not be archivable")
	} else if !errors.Is(err, ErrActive) {
		t.Fatalf("err = %v, want ErrActive", err)
	}
	// ...unless the operator turns the check off
	if _, err := st.ArchiveDevice(ctx, userID, recent.ID, 0); err != nil {
		t.Fatalf("with the inactivity check disabled: %v", err)
	}

	// 3. revoked and silent: allowed
	silent, _ := archivedDevice(t, st, userID)
	out, err := st.ArchiveDevice(ctx, userID, silent, 30)
	if err != nil || out.Archived != 1 {
		t.Fatalf("archive silent device = %+v (%v)", out, err)
	}
	devices, err := st.ListDevices(ctx, userID)
	if err != nil {
		t.Fatalf("list devices: %v", err)
	}
	for _, d := range devices {
		if d.ID == silent && !d.Archived {
			t.Fatalf("device should be listed as archived: %+v", d)
		}
	}
	// unarchive works and reports the device back
	if out, err = st.UnarchiveDevice(ctx, userID, silent); err != nil || out.Unarchived != 1 {
		t.Fatalf("unarchive device = %+v (%v)", out, err)
	}
}

// The safety property: archiving a device's records must not remove them from
// the sync protocol, or the user's other browsers would lose data the moment
// an operator tidied up a dead laptop.
func TestArchivedRecordsStillSync(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "alice")
	deviceID, _ := archivedDevice(t, st, userID)
	now := time.Now().UnixMilli()

	if _, _, err := st.ApplyRecords(ctx, userID, deviceID, []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: now, Payload: `{"name":"mine"}`},
	}, 1<<20); err != nil {
		t.Fatalf("apply: %v", err)
	}

	out, err := st.ArchiveDeviceRecords(ctx, userID, deviceID, 30)
	if err != nil || out.Archived != 1 {
		t.Fatalf("archive records = %+v (%v)", out, err)
	}

	// still there, still pullable by the user's devices
	recs, _, err := st.PullRecords(ctx, userID, 0, 10)
	if err != nil || len(recs) != 1 {
		t.Fatalf("archived record left the sync channel: %+v (%v)", recs, err)
	}
	// hidden from the console's default listing
	listed, total, err := st.ListRecords(ctx, userID, RecordFilter{})
	if err != nil || total != 0 || len(listed) != 0 {
		t.Fatalf("console listing should hide it: total=%d rows=%d (%v)", total, len(listed), err)
	}
	// and visible on request
	listed, total, err = st.ListRecords(ctx, userID, RecordFilter{IncludeArchived: true})
	if err != nil || total != 1 || len(listed) != 1 {
		t.Fatalf("include archived = total %d rows %d (%v)", total, len(listed), err)
	}
	// The two search paths disagree on purpose, and both are right:
	//   - the console's search follows the console's listings, so it hides it
	//   - the extension's search is the user's own, and archiving is an
	//     operator's filing decision, so it shows everything
	hits, err := st.search(ctx, userID, "mine", "", 10, false)
	if err != nil || len(hits) != 0 {
		t.Fatalf("console search should hide archived rows: %+v (%v)", hits, err)
	}
	adminHits, err := st.SearchFor(ctx, userID, "mine", "", 10, true)
	if err != nil || len(adminHits) != 1 {
		t.Fatalf("console search with archived=1 should find it: %+v (%v)", adminHits, err)
	}
	hits, err = st.Search(ctx, userID, "mine", "", 10)
	if err != nil || len(hits) != 1 {
		t.Fatalf("the user's own search must not be filtered: %+v (%v)", hits, err)
	}

	// editing the record again brings it back on its own
	later := now + 60_000
	if _, _, err := st.ApplyRecords(ctx, userID, "dev_other", []RecordInput{
		{Entity: "tabspace", ID: "ts1", UpdatedAt: later, Payload: `{"name":"edited"}`},
	}, 1<<20); err != nil {
		t.Fatalf("apply edit: %v", err)
	}
	_, total, err = st.ListRecords(ctx, userID, RecordFilter{})
	if err != nil || total != 1 {
		t.Fatalf("a record edited after archiving should be live again: total=%d (%v)", total, err)
	}
}

// Tombstones are not resurrected by an unarchive: undoing a delete is the
// client's business, not the operator's.
func TestUnarchiveDoesNotRestoreTombstones(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "alice")
	deviceID, _ := archivedDevice(t, st, userID)
	now := time.Now().UnixMilli()

	if _, _, err := st.ApplyRecords(ctx, userID, deviceID, []RecordInput{
		{Entity: "note", ID: "n1", UpdatedAt: now, Payload: `{"name":"a"}`},
		{Entity: "note", ID: "n2", UpdatedAt: now + 1, Payload: `{"name":"b"}`, Deleted: true},
	}, 1<<20); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if _, err := st.ArchiveDeviceRecords(ctx, userID, deviceID, 30); err != nil {
		t.Fatalf("archive: %v", err)
	}
	if _, err := st.UnarchiveDeviceRecords(ctx, userID, deviceID); err != nil {
		t.Fatalf("unarchive: %v", err)
	}
	recs, _, err := st.ListRecords(ctx, userID, RecordFilter{IncludeDeleted: true})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	deleted := map[string]bool{}
	live := map[string]bool{}
	for _, r := range recs {
		if r.Deleted {
			deleted[r.ID] = true
		} else {
			live[r.ID] = true
		}
	}
	// n1 is back to being ordinary; n2 is still a tombstone, because archiving
	// never touched it and undoing a delete is the client's call, not the
	// operator's.
	if !live["n1"] || live["n2"] {
		t.Fatalf("live = %v, want n1 only", live)
	}
	if !deleted["n2"] {
		t.Fatalf("deleted = %v, want n2 to still be a tombstone", deleted)
	}
}
