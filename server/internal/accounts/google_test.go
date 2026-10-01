package accounts

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-pkgz/auth/v2/provider"
	"github.com/go-pkgz/auth/v2/token"

	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// Google's userinfo document, as it arrives after the email scope is granted.
const googleUserInfo = `{
  "sub": "107346332299748234521",
  "name": "Yu Li",
  "given_name": "Yu",
  "family_name": "Li",
  "picture": "https://lh3.googleusercontent.com/a/photo",
  "email": "yli@example.com",
  "email_verified": true
}`

// googleData parses a userinfo document the way the library does before handing
// it to the mapping.
func googleData(t *testing.T, body string) provider.UserData {
	t.Helper()
	var doc provider.UserData
	if err := json.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatalf("the test document is not JSON: %v", err)
	}
	return doc
}

// discardLogger keeps the library's debug output out of the test output.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

// The mapping is the whole reason this file exists: without the email scope
// there is no address in the document, and this console cannot do without an
// address (see google.go).
func TestGoogleUserKeepsTheAddress(t *testing.T) {
	u := googleUser(googleData(t, googleUserInfo), nil)

	if u.Email != "yli@example.com" {
		t.Errorf("email = %q, want the address Google sent", u.Email)
	}
	if u.Name != "Yu Li" || u.Picture == "" {
		t.Errorf("name/picture not carried over: %+v", u)
	}
	// `sub`, not `id`: Google's OAuth userinfo has no id field
	if !strings.HasPrefix(u.ID, "google_") || len(u.ID) <= len("google_") {
		t.Errorf("id = %q, want the hashed sub prefixed with the provider", u.ID)
	}
	// ...and the same subject always gives the same account
	if again := googleUser(googleData(t, googleUserInfo), nil); again.ID != u.ID {
		t.Errorf("the same subject mapped to two ids: %q and %q", u.ID, again.ID)
	}
	// a different subject must not
	other := googleUser(googleData(t, strings.Replace(googleUserInfo, "107346332299748234521", "222222222222222222222", 1)), nil)
	if other.ID == u.ID {
		t.Error("two subjects mapped to one account")
	}
}

// Google's own statement that the address is verified is what lets a Google
// sign-in prove it, the same way following an emailed link does (adr/0017).
func TestGoogleVerifiedFlagTravelsOnTheClaim(t *testing.T) {
	verified := googleUser(googleData(t, googleUserInfo), nil)
	if !verified.BoolAttr(emailVerifiedAttr) {
		t.Error("email_verified=true did not set the claim attribute")
	}

	unverified := googleUser(googleData(t,
		strings.Replace(googleUserInfo, `"email_verified": true`, `"email_verified": false`, 1)), nil)
	if unverified.BoolAttr(emailVerifiedAttr) {
		t.Error("email_verified=false set the claim attribute anyway")
	}

	// a document without the field at all must not claim proof
	absent := googleUser(googleData(t, `{"sub":"1","email":"yli@example.com"}`), nil)
	if absent.BoolAttr(emailVerifiedAttr) {
		t.Error("a document without email_verified set the claim attribute")
	}
}

func TestGoogleUserSurvivesMissingFields(t *testing.T) {
	// Google says none of the optional fields are required, so none of this may
	// be fatal - and none of it may collide with everybody else's account.
	u := googleUser(googleData(t, `{"sub":"42"}`), nil)
	if u.Name == "" {
		t.Error("no display name: the account would render blank everywhere")
	}
	if u.Email != "" {
		t.Errorf("email = %q out of a document with none", u.Email)
	}
	if u.BoolAttr(emailVerifiedAttr) {
		t.Error("a document with no address claimed to be verified")
	}

	// no subject at all is the dangerous one: hashing "" would give every such
	// login the same account
	empty := googleUser(googleData(t, `{}`), nil)
	if empty.ID != "" {
		t.Errorf("a document with no subject got id %q, want none", empty.ID)
	}
}

// The end of the chain: a claim that says the provider vouched for the address
// has to produce a *usable* account under the default settings, which is the
// thing that was broken before - an unproven account is refused on every request.
func TestAGoogleClaimProvesTheAddress(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "google.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	cfg := config.Config{
		DBPath: "google.db", PublicURL: "https://tabs.example",
		LinkByEmail: true, RequireEmailVerification: true,
		GoogleClientID: "cid.apps.googleusercontent.com", GoogleClientSecret: "secret",
	}
	svc, err := New(cfg, st, discardLogger())
	if err != nil {
		t.Fatalf("service: %v", err)
	}
	if got := cfg.SocialProviders(); len(got) != 1 || got[0] != "google" {
		t.Fatalf("providers = %v, want [google]", got)
	}

	ctx := context.Background()
	claim := googleUser(googleData(t, googleUserInfo), nil)
	out := svc.updater(claim)
	if out.ID == "" {
		t.Fatal("a verified Google login was refused with the default settings")
	}
	acc, err := st.AccountByEmail(ctx, "yli@example.com")
	if err != nil {
		t.Fatalf("the account was not created with the address: %v", err)
	}
	if acc.EmailVerifiedAt == nil {
		t.Error("the account is not marked verified after a provider that vouched for it")
	}
	if !acc.CanLogin() {
		t.Error("the account cannot log in")
	}
}

// ...while a provider that says nothing about the address leaves the account
// unproven, which is the honest outcome: the address exists, nobody vouched for
// it, and TABVERSED_REQUIRE_EMAIL_VERIFICATION is on.
func TestAnUnprovenProviderLoginIsStillRefused(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "github.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	cfg := config.Config{
		DBPath: "github.db", PublicURL: "https://tabs.example",
		LinkByEmail: true, RequireEmailVerification: true,
	}
	svc, err := New(cfg, st, discardLogger())
	if err != nil {
		t.Fatalf("service: %v", err)
	}

	// what the library's GitHub preset produces: an id, a name, a picture, and
	// no address at all
	claim := token.User{ID: "github_abc123", Name: "yli", Picture: "https://avatars/1"}
	out := svc.updater(claim)
	if out.ID != "" {
		t.Error("a login with no proven address was accepted under the default settings")
	}
}
