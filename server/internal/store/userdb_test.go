package store

import (
	"context"
	"testing"
	"time"
)

func TestUserDBSchemaVersionStamped(t *testing.T) {
	us, err := NewUserDBs(t.TempDir(), 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer us.Close()

	u, release, err := us.Acquire(context.Background(), "usr_a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()

	var v int
	if err := u.db.QueryRowContext(context.Background(), `PRAGMA user_version`).Scan(&v); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if v != len(userMigrations) {
		t.Fatalf("user_version = %d, want %d", v, len(userMigrations))
	}
}

func TestUserDBMigrationReappliesFromZero(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	us, err := NewUserDBs(dir, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	u, release, err := us.Acquire(ctx, "usr_a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if _, err := u.db.ExecContext(ctx, `
		INSERT INTO records (user_id, entity, id, device_id, rev, deleted, updated_at, payload, server_at)
		VALUES (?, 'note', 'n1', 'dev', 1, 0, 1, '{}', 1)`, "usr_a"); err != nil {
		t.Fatalf("insert: %v", err)
	}
	// A file that predates versioning reads as 0; re-migrating must be a no-op
	// that only re-stamps the version and keeps the rows.
	if _, err := u.db.ExecContext(ctx, `PRAGMA user_version = 0`); err != nil {
		t.Fatalf("downgrade: %v", err)
	}
	release()
	if err := us.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	us2, err := NewUserDBs(dir, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer us2.Close()
	u2, release2, err := us2.Acquire(ctx, "usr_a")
	if err != nil {
		t.Fatalf("reacquire: %v", err)
	}
	defer release2()

	var v int
	if err := u2.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&v); err != nil {
		t.Fatal(err)
	}
	if v != len(userMigrations) {
		t.Fatalf("user_version = %d, want %d", v, len(userMigrations))
	}
	var n int
	if err := u2.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM records WHERE id = 'n1'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("record lost across re-migration: count=%d", n)
	}
}
