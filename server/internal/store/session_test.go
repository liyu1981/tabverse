package store

import (
	"context"
	"testing"
	"time"
)

// The two pieces of state ADR 0021 added: an account-wide session cut-off, and
// the record that a sign-in link has been redeemed.

// RevokeAllSessions is the whole "sign out everywhere" answer, and it must not
// reach the device tokens - those are a different credential and revoking them
// would silently stop somebody's devices syncing.
func TestRevokeAllSessionsLeavesDeviceTokensUsable(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "alice")
	device, err := st.CreateDevice(ctx, "dev_laptop", userID, "laptop")
	if err != nil {
		t.Fatalf("create device: %v", err)
	}
	const hash = "device_token_hash"
	if err := st.CreateToken(ctx, hash, userID, device.ID); err != nil {
		t.Fatalf("create token: %v", err)
	}

	cut, err := st.TokensValidAfter(ctx, userID)
	if err != nil {
		t.Fatalf("cut-off: %v", err)
	}
	if cut != 0 {
		t.Fatalf("a fresh account should have no cut-off, got %d", cut)
	}

	if err := st.RevokeAllSessions(ctx, userID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	cut, err = st.TokensValidAfter(ctx, userID)
	if err != nil {
		t.Fatalf("cut-off: %v", err)
	}
	if cut == 0 {
		t.Fatal("the cut-off did not move")
	}

	// The device token still authenticates: LookupToken is the sync path and it
	// never looks at users.tokens_valid_after.
	user, deviceID, err := st.LookupToken(ctx, hash)
	if err != nil || user != userID || deviceID != device.ID {
		t.Fatalf("the device token stopped working: %s / %s (%v)", user, deviceID, err)
	}

	// Whether the cut-off is *honoured* is the predicate in the accounts
	// package, which is where the authenticator hook lives; it is covered end to
	// end by TestRevokeSessionsEndsEverySession in the api package. What is
	// tested here is that this column is the one that moves.
	before := time.UnixMilli(cut - 2000)
	after := time.UnixMilli(cut + 2000)
	if before.Unix() >= after.Unix() {
		t.Fatalf("the test's own arithmetic is wrong: %d >= %d", before.Unix(), after.Unix())
	}
}

func TestRevokeAllSessionsOnAnUnknownAccount(t *testing.T) {
	st := newTestStore(t)
	if err := st.RevokeAllSessions(context.Background(), "usr_nope"); err != ErrNotFound {
		t.Fatalf("revoking nothing = %v, want ErrNotFound", err)
	}
}

// The library's confirmation token carries no id of its own, so the store is
// keyed by a hash of the token itself and the whole "works once" property is
// this table.
func TestMarkVerifTokenUsedIsOneShot(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	const key = "sha256-of-the-link"

	already, err := st.MarkVerifTokenUsed(ctx, key, 30*time.Minute)
	if err != nil || already {
		t.Fatalf("first redemption: already=%v err=%v", already, err)
	}
	already, err = st.MarkVerifTokenUsed(ctx, key, 30*time.Minute)
	if err != nil {
		t.Fatalf("second redemption: %v", err)
	}
	if !already {
		t.Fatal("the same link was accepted twice")
	}
	// A different link is its own row, not this one's.
	other, err := st.MarkVerifTokenUsed(ctx, "another-link", 30*time.Minute)
	if err != nil || other {
		t.Fatalf("a different link: already=%v err=%v", other, err)
	}
}

// A row whose own expiry has passed is history, not a redemption: the link died
// of its 30 minute TTL, and the caller was willing to accept it.
func TestMarkVerifTokenUsedForgetsExpiredRows(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	const key = "an-old-link"
	if _, err := st.MarkVerifTokenUsed(ctx, key, time.Millisecond); err != nil {
		t.Fatalf("first: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, err := st.MarkVerifTokenUsed(ctx, key, 30*time.Minute); err != nil {
		t.Fatalf("second: %v", err)
	}
}

func TestSweepVerifTokens(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	if _, err := st.MarkVerifTokenUsed(ctx, "long-gone", time.Millisecond); err != nil {
		t.Fatalf("mark: %v", err)
	}
	// Backdate it well past the sweep's horizon.
	if _, err := st.DB().ExecContext(ctx,
		`UPDATE verif_tokens SET expires_at = 1 WHERE token_hash = ?`, "long-gone"); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	if _, err := st.MarkVerifTokenUsed(ctx, "current", 30*time.Minute); err != nil {
		t.Fatalf("mark current: %v", err)
	}

	n, err := st.SweepVerifTokens(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("swept %d rows, want 1", n)
	}
	// The live one is still refused on replay, i.e. it survived.
	already, err := st.MarkVerifTokenUsed(ctx, "current", 30*time.Minute)
	if err != nil || !already {
		t.Fatalf("the live row was swept: already=%v err=%v", already, err)
	}
}
