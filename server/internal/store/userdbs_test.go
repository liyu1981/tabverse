package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestUserDBsEvictsIdleLeastRecent(t *testing.T) {
	us, err := NewUserDBs(t.TempDir(), 2, 50*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer us.Close()
	ctx := context.Background()

	_, relA, err := us.Acquire(ctx, "usr_a")
	if err != nil {
		t.Fatalf("acquire a: %v", err)
	}
	relA() // idle, and the oldest

	_, relB, err := us.Acquire(ctx, "usr_b")
	if err != nil {
		t.Fatalf("acquire b: %v", err)
	}

	// A third account must evict the idle usr_a, not the in-use usr_b.
	_, relC, err := us.Acquire(ctx, "usr_c")
	if err != nil {
		t.Fatalf("acquire c: %v", err)
	}
	relC()

	if _, ok := us.entries["usr_a"]; ok {
		t.Fatal("idle usr_a was not evicted")
	}
	if _, ok := us.entries["usr_b"]; !ok {
		t.Fatal("in-use usr_b was evicted")
	}
	relB()
}

func TestUserDBsBusyWhenPinned(t *testing.T) {
	us, err := NewUserDBs(t.TempDir(), 1, 30*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer us.Close()
	ctx := context.Background()

	_, rel, err := us.Acquire(ctx, "usr_a")
	if err != nil {
		t.Fatalf("acquire a: %v", err)
	}
	defer rel()

	start := time.Now()
	if _, _, err := us.Acquire(ctx, "usr_b"); !errors.Is(err, ErrBusy) {
		t.Fatalf("want ErrBusy, got %v", err)
	}
	if elapsed := time.Since(start); elapsed < 20*time.Millisecond {
		t.Fatalf("returned before the wait budget: %s", elapsed)
	}
}

func TestUserDBsWaiterSucceedsAfterRelease(t *testing.T) {
	us, err := NewUserDBs(t.TempDir(), 1, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer us.Close()
	ctx := context.Background()

	_, rel, err := us.Acquire(ctx, "usr_a")
	if err != nil {
		t.Fatalf("acquire a: %v", err)
	}
	go func() {
		time.Sleep(50 * time.Millisecond)
		rel()
	}()

	u, relB, err := us.Acquire(ctx, "usr_b")
	if err != nil {
		t.Fatalf("waiter: %v", err)
	}
	defer relB()
	if u.ID() != "usr_b" {
		t.Fatalf("got %q, want usr_b", u.ID())
	}
}

func TestUserDBPersistsAcrossPoolReopen(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	us, err := NewUserDBs(dir, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	u, rel, err := us.Acquire(ctx, "usr_a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if _, err := u.db.ExecContext(ctx, `
		INSERT INTO records (user_id, entity, id, device_id, rev, deleted, updated_at, payload, server_at)
		VALUES (?, 'note', 'n1', 'dev', 7, 0, 1, '{}', 1)`, "usr_a"); err != nil {
		t.Fatalf("insert: %v", err)
	}
	rel()
	if err := us.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	us2, err := NewUserDBs(dir, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer us2.Close()
	u2, rel2, err := us2.Acquire(ctx, "usr_a")
	if err != nil {
		t.Fatalf("reacquire: %v", err)
	}
	defer rel2()

	var n int
	if err := u2.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM records WHERE id = 'n1'`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("record lost across reopen: count=%d", n)
	}
	var fts int
	if err := u2.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM records_fts`).Scan(&fts); err != nil {
		t.Fatalf("fts count: %v", err)
	}
}

func TestUserDBsRejectsTraversal(t *testing.T) {
	us, err := NewUserDBs(t.TempDir(), 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer us.Close()
	if _, _, err := us.Acquire(context.Background(), "../evil"); err == nil {
		t.Fatal("expected an invalid user id error")
	}
}

func TestUserDBsCloseIsIdempotent(t *testing.T) {
	us, err := NewUserDBs(t.TempDir(), 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, rel, err := us.Acquire(context.Background(), "usr_a"); err == nil {
		rel()
	}
	if err := us.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}
	if err := us.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}
	if _, _, err := us.Acquire(context.Background(), "usr_b"); err == nil {
		t.Fatal("acquire after close should fail")
	}
}
