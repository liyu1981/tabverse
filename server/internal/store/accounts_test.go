package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The account layer has three rules worth pinning down on their own: an
// external login lands on the right account (and only ever creates one when it
// has to), a one-time email token can be followed once, and the last admin
// cannot be locked out of their own deployment.

func TestUpsertIdentityClaimsAndLinks(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	// First sight of a GitHub login creates the account behind it.
	userID, created, err := st.UpsertIdentity(ctx, "github", "1001", "Yuli@Example.com", "Yuli", true)
	if err != nil || !created {
		t.Fatalf("first login = %q created=%v err=%v", userID, created, err)
	}
	// The email is normalised, because the login form will not be.
	acc, err := st.AccountByEmail(ctx, "yuli@example.com")
	if err != nil || acc.ID != userID {
		t.Fatalf("lookup by email: %+v (%v)", acc, err)
	}
	if acc.Role != RoleUser {
		t.Errorf("a new account is %q, want %q", acc.Role, RoleUser)
	}

	// Second sight of the same login is the same account, and creates nothing.
	again, created, err := st.UpsertIdentity(ctx, "github", "1001", "yuli@example.com", "Yuli", true)
	if err != nil || created || again != userID {
		t.Fatalf("second login = %q created=%v err=%v", again, created, err)
	}

	// A second provider with the same verified address links to the same
	// account, which is what makes "sign in with Google" land on the account
	// you registered with.
	google, created, err := st.UpsertIdentity(ctx, "google", "2002", "yuli@example.com", "Yuli", true)
	if err != nil || created || google != userID {
		t.Fatalf("linked login = %q created=%v err=%v", google, created, err)
	}
	ids, err := st.IdentitiesFor(ctx, userID)
	if err != nil || len(ids) != 2 {
		t.Fatalf("identities = %+v (%v)", ids, err)
	}

	// With linking off, a login claiming an address that already has an account
	// is refused rather than merged: one address is one account, and a provider
	// that cannot vouch for its emails must not be able to walk into someone
	// else's data.
	if _, _, err := st.UpsertIdentity(ctx, "google", "2003", "yuli@example.com", "Yuli", false); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("unlinked login = %v, want ErrEmailTaken", err)
	}
	// ...and the original account is untouched.
	if acc, err := st.AccountByID(ctx, userID); err != nil || acc.ID != userID {
		t.Fatalf("original account disturbed: %+v (%v)", acc, err)
	}
	// A brand new address still works with linking off, which is how a LAN-only
	// deployment signs people up.
	fresh, created, err := st.UpsertIdentity(ctx, "google", "2004", "new@example.com", "New", false)
	if err != nil || !created || fresh == userID {
		t.Fatalf("new address with linking off = %q created=%v err=%v", fresh, created, err)
	}
}

func TestEmailTokensAreSingleUseAndExpire(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "yuli")
	const hash = "hash-of-the-link"

	if err := st.CreateEmailToken(ctx, userID, EmailPurposeVerify, hash, time.Hour); err != nil {
		t.Fatalf("create token: %v", err)
	}
	got, err := st.ConsumeEmailToken(ctx, EmailPurposeVerify, hash)
	if err != nil || got != userID {
		t.Fatalf("consume = %q (%v), want %s", got, err, userID)
	}
	// A second click on the same link does nothing: it is used up.
	if _, err := st.ConsumeEmailToken(ctx, EmailPurposeVerify, hash); !errors.Is(err, ErrNotFound) {
		t.Fatalf("replay = %v, want ErrNotFound", err)
	}
	// The purpose is part of the lookup, so a reset link is not a verify link.
	if _, err := st.ConsumeEmailToken(ctx, EmailPurposeReset, hash); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong purpose = %v, want ErrNotFound", err)
	}
	// And an expired one is not a token at all.
	expired := "hash-of-an-old-link"
	if err := st.CreateEmailToken(ctx, userID, EmailPurposeReset, expired, -time.Hour); err != nil {
		t.Fatalf("create expired: %v", err)
	}
	if _, err := st.ConsumeEmailToken(ctx, EmailPurposeReset, expired); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired = %v, want ErrNotFound", err)
	}
}

func TestTheLastAdminCannotBeLockedOut(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	admin, _, err := st.UpsertIdentity(ctx, "github", "1", "root@example.com", "Root", true)
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	if err := st.SetRole(ctx, admin, RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}
	other, _, err := st.UpsertIdentity(ctx, "github", "2", "yuli@example.com", "Yuli", true)
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if err := st.SetRole(ctx, other, RoleAdmin); err != nil {
		t.Fatalf("promote second: %v", err)
	}
	if n, err := st.CountAdmins(ctx); err != nil || n != 2 {
		t.Fatalf("admins = %d (%v), want 2", n, err)
	}

	// With two admins either can step down...
	if err := st.SetRole(ctx, other, RoleUser); err != nil {
		t.Fatalf("demote: %v", err)
	}
	// ...but the last one cannot, or the deployment loses its operator.
	if err := st.SetRole(ctx, admin, RoleUser); err == nil {
		t.Fatal("the last admin was demoted")
	}
	if err := st.SetDisabled(ctx, admin, true); err == nil {
		t.Fatal("the last admin was disabled")
	}
	// Promote somebody else and it works again.
	if err := st.SetRole(ctx, other, RoleAdmin); err != nil {
		t.Fatalf("promote other: %v", err)
	}
	if err := st.SetDisabled(ctx, admin, true); err != nil {
		t.Fatalf("disable the old admin: %v", err)
	}
}

func TestRevocationCutsOffSessions(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "yuli")

	if cut, err := st.TokensValidAfter(ctx, userID); err != nil || cut != 0 {
		t.Fatalf("a fresh account's cut-off = %d (%v), want 0", cut, err)
	}
	if err := st.SetPasswordHash(ctx, userID, "argon2id$whatever"); err != nil {
		t.Fatalf("set password: %v", err)
	}
	cut, err := st.TokensValidAfter(ctx, userID)
	if err != nil || cut == 0 {
		t.Fatalf("cut-off after a password change = %d (%v), want a timestamp", cut, err)
	}
	// An account that never existed is not found rather than trusted.
	if _, err := st.TokensValidAfter(ctx, "usr_nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown account = %v, want ErrNotFound", err)
	}
}

func TestServerSecretIsWrittenOnce(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	// Two processes racing to generate the first value must agree on one, or a
	// restart would invalidate every session in the other.
	got, err := st.PutServerSecret(ctx, "auth_signing_key", "generated-once")
	if err != nil || got != "generated-once" {
		t.Fatalf("first = %q (%v)", got, err)
	}
	again, err := st.PutServerSecret(ctx, "auth_signing_key", "generated-again")
	if err != nil || again != "generated-once" {
		t.Fatalf("second = %q (%v), want the first value to win", again, err)
	}
}

func TestAuditLogRecordsWhoDidWhat(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	actor := mustCreateUser(t, st, "root")
	target := mustCreateUser(t, st, "yuli")

	if err := st.AppendAudit(ctx, AuditEntry{
		Actor: actor, Action: AuditImpersonateIn, Target: target,
		IP: "10.0.0.5", Detail: "read only, 15m",
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := st.AppendAudit(ctx, AuditEntry{Action: AuditLoginFailed, IP: "10.0.0.9"}); err != nil {
		t.Fatalf("append anonymous: %v", err)
	}
	entries, err := st.ListAudit(ctx, AuditImpersonateIn, "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("filter by action returned %d entries", len(entries))
	}
	e := entries[0]
	if e.Actor != actor || e.Target != target || e.Detail != "read only, 15m" {
		t.Fatalf("entry = %+v", e)
	}
	// A failed login has no actor, which must not break the insert.
	all, err := st.ListAudit(ctx, "", "", 10)
	if err != nil || len(all) != 2 {
		t.Fatalf("all entries = %d (%v), want 2", len(all), err)
	}
}
