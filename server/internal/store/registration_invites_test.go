package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRegistrationInviteLifecycle(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	inv, err := st.CreateRegistrationInvite(ctx, "Alice@Example.com", "", "op", 3600_000)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if inv.Email != "alice@example.com" {
		t.Fatalf("email = %q, want the lower-cased address", inv.Email)
	}
	if !inv.Live(nowMS()) {
		t.Fatalf("a fresh invite should be live")
	}

	// The invited address may register, and the invite is spent.
	_, created, err := st.UpsertIdentity(ctx, "email", "s1", "alice@example.com", "Alice", true,
		RegistrationPolicy{RequireInvite: true})
	if err != nil || !created {
		t.Fatalf("register: created=%v err=%v", created, err)
	}
	used, err := st.RegistrationInviteFor(ctx, "alice@example.com")
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if used.UsedAt == 0 {
		t.Fatalf("the invite should be marked used")
	}

	// Signing in again is not a registration, so it is never refused.
	_, again, err := st.UpsertIdentity(ctx, "email", "s1", "alice@example.com", "Alice", true,
		RegistrationPolicy{RequireInvite: true})
	if err != nil || again {
		t.Fatalf("second sign-in: created=%v err=%v", again, err)
	}
}

func TestRegistrationInviteRequired(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	_, _, err := st.UpsertIdentity(ctx, "email", "s2", "nobody@example.com", "N", true,
		RegistrationPolicy{RequireInvite: true})
	if !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("err = %v, want ErrInviteRequired", err)
	}
	// With the policy off, the same address registers freely.
	if _, created, err := st.UpsertIdentity(ctx, "email", "s2", "nobody@example.com", "N", true,
		RegistrationPolicy{}); err != nil || !created {
		t.Fatalf("open server: created=%v err=%v", created, err)
	}
}

func TestRegistrationInviteCode(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	if _, err := st.CreateRegistrationInvite(ctx, "bob@example.com", "hash-a", "op", 0); err != nil {
		t.Fatalf("create: %v", err)
	}
	// The wrong code is the same as no invite at all.
	if _, _, err := st.UpsertIdentity(ctx, "email", "s3", "bob@example.com", "B", true,
		RegistrationPolicy{RequireInvite: true, CodeHash: "hash-b"}); !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("wrong code: err = %v, want ErrInviteRequired", err)
	}
	// The right one registers.
	if _, created, err := st.UpsertIdentity(ctx, "email", "s4", "bob@example.com", "B", true,
		RegistrationPolicy{RequireInvite: true, CodeHash: "hash-a"}); err != nil || !created {
		t.Fatalf("right code: created=%v err=%v", created, err)
	}
}

func TestRegistrationInviteExpiryAndRevoke(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	// A 1ms lifetime, then a pause: expired.
	if _, err := st.CreateRegistrationInvite(ctx, "old@example.com", "", "op", 1); err != nil {
		t.Fatalf("create: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, _, err := st.UpsertIdentity(ctx, "email", "s5", "old@example.com", "O", true,
		RegistrationPolicy{RequireInvite: true}); !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("expired: err = %v, want ErrInviteRequired", err)
	}

	// Revoked is the same as never invited.
	if _, err := st.CreateRegistrationInvite(ctx, "gone@example.com", "", "op", 3600_000); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := st.RevokeRegistrationInvite(ctx, "gone@example.com"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, _, err := st.UpsertIdentity(ctx, "email", "s6", "gone@example.com", "G", true,
		RegistrationPolicy{RequireInvite: true}); !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("revoked: err = %v, want ErrInviteRequired", err)
	}
	if err := st.RevokeRegistrationInvite(ctx, "x@example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoke unknown: err = %v, want ErrNotFound", err)
	}
}

func TestListRegistrationInvites(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	for _, email := range []string{"a@example.com", "b@example.com"} {
		if _, err := st.CreateRegistrationInvite(ctx, email, "", "op", 3600_000); err != nil {
			t.Fatalf("create %s: %v", email, err)
		}
	}
	invs, err := st.ListRegistrationInvites(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(invs) != 2 {
		t.Fatalf("len = %d, want 2", len(invs))
	}
}
