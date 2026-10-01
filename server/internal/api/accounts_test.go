package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-pkgz/auth/v2/token"
	"github.com/golang-jwt/jwt/v5"

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// The console API answers to one credential now - a signed-in account
// (adr/0013) - and the interesting cases are the ones in between: a person
// reaching their own account, reaching somebody else's, and reaching an
// operator-only view.

func newAccountServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	return newServerWithConfig(t, testAdminEmail)
}

func newServerWithConfig(t *testing.T, adminEmail string) (*httptest.Server, *Server) {
	t.Helper()
	cfg := config.Config{
		Addr: ":0", DBPath: filepath.Join(t.TempDir(), "accounts-api.db"),
		MaxRecordBytes: 1 << 20, SyncBatchLimit: 100, SearchLimit: 50,
		Version: "test", AdminEmail: adminEmail,
		PublicURL:     "http://127.0.0.1:8223",
		SecureCookies: false, LinkByEmail: true, RequireEmailVerification: true,
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	s, err := New(cfg, st, hub.New(), nil)
	if err != nil {
		t.Fatalf("server: %v", err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, s
}

// newServerWithAdminEmail builds a deployment whose operator address may be
// empty, for the tests about what happens before the variable is set.
func newServerWithAdminEmail(t *testing.T, adminEmail string) (*httptest.Server, *Server) {
	t.Helper()
	return newServerWithConfig(t, adminEmail)
}

// restartWithAdminEmail opens the same database with a different configuration,
// which is what a restart with a new environment variable is.
func restartWithAdminEmail(t *testing.T, old *Server, adminEmail string) (*httptest.Server, *Server) {
	t.Helper()
	path := old.cfg.DBPath
	old.store.Close()
	cfg := old.cfg
	cfg.AdminEmail = adminEmail
	st, err := store.Open(path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	srv, err := New(cfg, st, hub.New(), nil)
	if err != nil {
		t.Fatalf("server: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, srv
}

// operatorSession returns a signed-in operator, which is how the console tests
// reach anything reserved for operators. There is no master credential any more
// (adr/0013), so an operator is an account that registered with
// TABVERSED_ADMIN_EMAIL.
func operatorSession(t *testing.T, ts *httptest.Server, s *Server) *sessionClient {
	t.Helper()
	// No manual promotion: registering with TABVERSED_ADMIN_EMAIL *is* the
	// operator bootstrap, so the tests use the real one.
	client := signInAs(t, ts, s, testAdminEmail)
	if role, _ := client.do(t, http.MethodGet, "/api/v1/console/me").body["role"].(string); role != store.RoleAdmin {
		t.Fatalf("the admin email should have made this an operator, role = %v", role)
	}
	// Helpers that stand in for a registration need the store, and the
	// operator session is where they get it from.
	client.srv = s
	return client
}

// signInAs registers an account and returns a signed-in client: the console
// session the tests use instead of the master credential that no longer exists.
//
// The order matters and mirrors the real flow. A row is created, the address is
// set, and only then is a session minted whose claim id is
// "<provider>_<account id>" - the shape the library's UserIDFunc produces. The
// single request that follows goes through the authenticator, so the identity is
// linked, a lone pre-account row is adopted if there is one, and the admin email
// becomes an operator. Minting a cookie and calling handlers directly would skip
// all of that, which is how a test ends up asserting something the product never
// does.
func signInAs(t *testing.T, ts *httptest.Server, s *Server, email string) *sessionClient {
	t.Helper()
	ctx := context.Background()
	created, err := s.store.CreateUser(ctx, "usr_"+shortHash(email), email)
	acc := store.Account{ID: created.ID, Name: created.Name, Email: email}
	if err != nil {
		// Signing in twice is not a failure: the account is already there.
		acc, err = s.store.AccountByEmail(ctx, email)
		if err != nil {
			t.Fatalf("create account: %v", err)
		}
	}
	if err := s.store.SetEmail(ctx, acc.ID, email); err != nil {
		t.Fatalf("set email: %v", err)
	}
	// Verifying an address revokes sessions issued before the proof, so a login
	// in the same second is refused once (accounts.SessionRevocationWindow).
	// A real person clicks the link and signs in a moment later; the test steps
	// over the same boundary rather than pretending it is not there.
	if err := s.store.MarkEmailVerified(ctx, acc.ID); err != nil {
		t.Fatalf("verify: %v", err)
	}
	waitOutRevocationWindow(t, s, acc.ID)

	rec := httptest.NewRecorder()
	mw := s.accounts.Middleware()
	if _, err := mw.JWTService.Set(rec, sessionClaimsFor(acc.ID, email)); err != nil {
		t.Fatalf("sign in: %v", err)
	}
	client := &sessionClient{cookies: rec.Result().Cookies(), ts: ts, xsrfHeader: "X-XSRF-Token"}
	client.do(t, http.MethodGet, "/api/v1/console/me")
	return client
}

// shortHash keeps a stable, readable id per address, so a test that refers to an
// account twice finds the same one.
func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:8])
}

type sessionClient struct {
	cookies    []*http.Cookie
	ts         *httptest.Server
	xsrfHeader string
	// srv is the server behind this session, for helpers that need the store
	// (registration, which is now how an account is created).
	srv *Server
}

func (c *sessionClient) assumeCookiePresent() bool {
	for _, cookie := range c.cookies {
		if cookie.Name == "tv_assume" && cookie.Value != "" {
			return true
		}
	}
	return false
}

// doJSON is do() with a body, for the calls that change something. The cookie
// handling is the browser's: Set-Cookie replaces or, for an empty value,
// deletes.
func (c *sessionClient) doJSON(t *testing.T, method, path string, body any) apiResp {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.ts.URL+path, reader)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, cookie := range c.cookies {
		req.AddCookie(cookie)
		if cookie.Name == "tv_xsrf" {
			req.Header.Set(c.xsrfHeader, cookie.Value)
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	c.keepCookies(res)
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("decode %s: %v", res.Request.URL, err)
		}
	}
	return apiResp{status: res.StatusCode, body: out, raw: string(raw)}
}

// keepCookies mirrors what a browser does with Set-Cookie, deletions included:
// a cookie with no value removes the one we were holding, which is how "stop
// impersonating" works in the tests.
func (c *sessionClient) keepCookies(res *http.Response) {
	for _, cookie := range res.Cookies() {
		kept := c.cookies[:0]
		for _, existing := range c.cookies {
			if existing.Name != cookie.Name {
				kept = append(kept, existing)
			}
		}
		c.cookies = kept
		if cookie.Value != "" {
			c.cookies = append(c.cookies, cookie)
		}
	}
}

func (c *sessionClient) postJSON(t *testing.T, path string, body map[string]string) apiResp {
	t.Helper()
	return c.doJSON(t, http.MethodPost, path, body)
}

func (c *sessionClient) do(t *testing.T, method, path string) apiResp {
	t.Helper()
	return c.doJSON(t, method, path, nil)
}

// A social login is the one bug in this file's neighbourhood that stays invisible
// until a real provider refuses it. The auth library is mounted under /auth, we
// strip that prefix before it sees the request, and it composes the provider's
// redirect URI from the path it was handed - so a URL without /auth produces a
// server that starts happily, offers a Google button, and answers every sign-in
// with Google's redirect_uri_mismatch. This asserts the URI that actually leaves
// the building.
func TestTheProviderRedirectURICarriesTheAuthRoutingPath(t *testing.T) {
	_, srv := newAccountServer(t)
	cfg := srv.cfg
	// a provider is only offered when it is configured, so configure one
	cfg.GoogleClientID = "cid.apps.googleusercontent.com"
	cfg.GoogleClientSecret = "secret"
	cfg.PublicURL = "https://tabversed.example"
	withGoogle, err := New(cfg, srv.store, hub.New(), nil)
	if err != nil {
		t.Fatalf("server with a google client: %v", err)
	}
	ts := httptest.NewServer(withGoogle.Handler())
	t.Cleanup(ts.Close)

	// no redirect following: the answer we want to look at is the 302 itself
	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	// No ?from=, exactly as the console's button asks: the server has to put the
	// console on it, or the provider answers and the browser lands on the
	// library's JSON dump of the user instead of the console (which is how a
	// perfectly good Google sign-in ended on a page of JSON).
	resp, err := client.Get(ts.URL + "/auth/google/login")
	if err != nil {
		t.Fatalf("follow the login route: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("the login route answered %d, want a redirect to the provider", resp.StatusCode)
	}
	location := resp.Header.Get("Location")
	if !strings.HasPrefix(location, "https://accounts.google.com/") {
		t.Fatalf("the login route did not redirect to Google: %s", location)
	}
	// this exact string is what has to be registered in Google's console
	want := "redirect_uri=" + url.QueryEscape("https://tabversed.example/auth/google/callback")
	if !strings.Contains(location, want) {
		t.Errorf("the provider was told a redirect URI Google would reject\n  location: %s\n  wanted to contain: %s",
			location, want)
	}
}

func TestConsoleMeBeforeAndAfterSignIn(t *testing.T) {
	ts, s := newAccountServer(t)

	// Before signing in, the page learns who it is talking to and what the
	// deployment offers - there is no longer a token to fall back on.
	r := (&sessionClient{ts: ts}).do(t, http.MethodGet, "/api/v1/console/me")
	r.mustStatus(t, http.StatusOK)
	if r.body["signed_in"] != false {
		t.Fatalf("signed out: %s", r.raw)
	}
	if r.body["admin_email"] != testAdminEmail {
		t.Fatalf("the page needs the operator address: %s", r.raw)
	}
	if _, ok := r.body["providers"].([]any); !ok {
		t.Fatalf("the page needs the provider list, even empty: %s", r.raw)
	}

	alice := signInAs(t, ts, s, "alice@example.com")
	r = alice.do(t, http.MethodGet, "/api/v1/console/me")
	r.mustStatus(t, http.StatusOK)
	if r.body["signed_in"] != true || r.body["user_id"] == "" {
		t.Fatalf("signed in: %s", r.raw)
	}
	if r.body["role"] != store.RoleUser {
		t.Fatalf("role = %v, want user: %s", r.body["role"], r.raw)
	}
	if r.body["csrf"] == "" || r.body["csrf_header"] == "" {
		t.Fatalf("the console needs the XSRF token to make a single request: %s", r.raw)
	}
}

func TestAPersonReachesTheirOwnAccountAndNobodyElses(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	bobID, _, err := s.store.UpsertIdentity(context.Background(), accounts.ProviderEmail,
		"subject-bob", "bob@example.com", "Bob", true)
	if err != nil {
		t.Fatalf("bob: %v", err)
	}
	me, _ := alice.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	// Their own account: yes, with no user id in the URL at all.
	r := alice.do(t, http.MethodGet, "/api/v1/admin/users/"+me)
	r.mustStatus(t, http.StatusOK)

	// Somebody else's: a clear refusal, not an empty page that looks fine.
	r = alice.do(t, http.MethodGet, "/api/v1/admin/users/"+bobID)
	r.mustStatus(t, http.StatusForbidden)
	if r.body["error"] != "forbidden" {
		t.Fatalf("expected a refusal, got %s", r.raw)
	}

	// And the data browser is scoped the same way.
	r = alice.do(t, http.MethodGet, "/api/v1/admin/users/"+bobID+"/tabspaces")
	r.mustStatus(t, http.StatusForbidden)
}

func TestAMintedDeviceTokenCannotStandInForASession(t *testing.T) {
	ts, s := newAccountServer(t)
	op := operatorSession(t, ts, s)
	_, token := seedUser(t, op, "carol")

	// A device token is a credential for the extension, not for the console.
	r := doJSON(t, http.MethodGet, ts.URL+"/api/v1/admin/users", token, nil)
	r.mustStatus(t, http.StatusUnauthorized)

	// And the console API with a session is a different thing from a device
	// token: the session works, the device token does not.
	dave := signInAs(t, ts, s, "dave@example.com")
	dave.do(t, http.MethodGet, "/api/v1/console/me").mustStatus(t, http.StatusOK)
}

func TestAPersonCannotReachTheOperatorViews(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")

	// The account list is the operator's: it is the user query interface.
	r := alice.do(t, http.MethodGet, "/api/v1/admin/users")
	r.mustStatus(t, http.StatusForbidden)
	if r.body["error"] != "forbidden" {
		t.Fatalf("expected forbidden, got %s", r.raw)
	}
	// So are the deployment totals.
	alice.do(t, http.MethodGet, "/api/v1/admin/totals").mustStatus(t, http.StatusForbidden)

	// Account creation is not an API at all: registration is the only way one
	// comes into existence (ADR 0014), so the endpoint is gone rather than
	// merely closed to people.
	before, _ := s.store.CountAccounts(context.Background())
	// The response is the console's HTML now (the SPA catches unknown paths), so
	// this is a raw request: what matters is that nothing was created.
	created := doRequest(t, ts, http.MethodPost, "/api/v1/admin/users")
	created.Body.Close()
	if created.StatusCode == http.StatusCreated {
		t.Fatal("there is still a way to create an account")
	}
	after, _ := s.store.CountAccounts(context.Background())
	if after != before {
		t.Fatalf("an account was created anyway: %d -> %d", before, after)
	}

	// An operator does reach them, and a device token does not: the extension's
	// credential is not a console credential.
	op := operatorSession(t, ts, s)
	op.do(t, http.MethodGet, "/api/v1/admin/users").mustStatus(t, http.StatusOK)
	_, deviceToken := seedUser(t, op, "carol")
	doJSON(t, http.MethodGet, ts.URL+"/api/v1/admin/users", deviceToken, nil).
		mustStatus(t, http.StatusUnauthorized)
}

// The bootstrap the deployment runs on: the first account registered with
// TABVERSED_ADMIN_EMAIL is the operator, with no secret handed out and no curl
// (adr/0013). A second person does not become one by the same route, which is
// what keeps a stray configuration from minting operators later.
func TestTheAdminEmailMakesTheFirstOperator(t *testing.T) {
	ts, s := newAccountServer(t)

	// Nobody yet, and the console says so.
	r := (&sessionClient{ts: ts}).do(t, http.MethodGet, "/api/v1/console/me")
	r.mustStatus(t, http.StatusOK)
	if r.body["operator_exists"] != false {
		t.Fatalf("a fresh deployment should have no operator: %s", r.raw)
	}
	if r.body["admin_email"] != testAdminEmail {
		t.Fatalf("the console needs to know the operator address: %s", r.raw)
	}

	// A different person registers first: an ordinary account.
	other := signInAs(t, ts, s, "someone@example.com")
	other.do(t, http.MethodGet, "/api/v1/admin/users").mustStatus(t, http.StatusForbidden)
	r = other.do(t, http.MethodGet, "/api/v1/console/me")
	if r.body["awaiting_operator"] == true {
		t.Fatalf("only the configured address is awaiting the role: %s", r.raw)
	}

	// The configured address registers and is the operator from the start.
	op := signInAs(t, ts, s, testAdminEmail)
	me := op.do(t, http.MethodGet, "/api/v1/console/me").body
	if me["role"] != store.RoleAdmin {
		t.Fatalf("registering with the admin email should be an operator: %v", me["role"])
	}
	op.do(t, http.MethodGet, "/api/v1/admin/users").mustStatus(t, http.StatusOK)
	op.do(t, http.MethodGet, "/api/v1/admin/totals").mustStatus(t, http.StatusOK)

	// And it is on the record.
	entries, err := s.store.ListAudit(context.Background(), store.AuditRoleChanged, "", 10)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("the first operator was not audited")
	}
}

// The upgrade path for a deployment that already has accounts: the variable is
// set *after* the fact, and a restart promotes the account that matches it.
// Without the restart nothing happens, which is what the console tells the
// person rather than pretending otherwise.
func TestStartupPromotesAnExistingAdminEmailAccount(t *testing.T) {
	ctx := context.Background()
	ts, s := newServerWithAdminEmail(t, "") // registered before the variable existed
	// The person uses the address that will *become* the operator address, but
	// at this point it is just an ordinary registration.
	existing := signInAs(t, ts, s, testAdminEmail)
	existingID, _ := existing.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	if acc, err := s.store.AccountByID(ctx, existingID); err != nil || acc.IsAdmin() {
		t.Fatalf("the account should not be an operator yet: %+v (%v)", acc, err)
	}
	// The console says what is missing.
	r := existing.do(t, http.MethodGet, "/api/v1/console/me")
	if r.body["awaiting_operator"] == true {
		t.Fatalf("without the variable configured there is nothing to await: %s", r.raw)
	}

	// Restart with the variable set - a second server over the same database.
	restarted, srv := restartWithAdminEmail(t, s, testAdminEmail)
	if err := srv.BootstrapOperator(ctx); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	acc, err := srv.store.AccountByID(ctx, existingID)
	if err != nil || !acc.IsAdmin() {
		t.Fatalf("the restart did not promote the account: %+v (%v)", acc, err)
	}
	fresh := signInAs(t, restarted, srv, testAdminEmail)
	fresh.do(t, http.MethodGet, "/api/v1/admin/users").mustStatus(t, http.StatusOK)
}

// ---- impersonation --------------------------------------------------------

// The impersonation contract, all of it: an operator can look at somebody
// else's account exactly as they see it, cannot change anything while doing so,
// cannot open the door onto another operator, and leaves an audit trail in both
// directions.
func TestImpersonationIsReadOnlyAndAudited(t *testing.T) {
	ts, s := newAccountServer(t)
	ctx := context.Background()

	// An operator and an ordinary person.
	root := signInAs(t, ts, s, "root@example.com")
	rootID, _ := root.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	if err := s.store.SetRole(ctx, rootID, store.RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}
	root = signInAs(t, ts, s, "root@example.com")

	alice := signInAs(t, ts, s, "alice@example.com")
	aliceID, _ := alice.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	// something of alice's to look at
	if _, r := push(t, ts, mintDeviceToken(t, ts, s, aliceID), []pushedRecord{
		{Entity: "tabspace", ID: "ts_alice", UpdatedAt: 1700000000000,
			Payload: `{"id":"ts_alice","name":"Alice work","tabIds":[]}`},
	}); r.status != http.StatusOK {
		t.Fatalf("seed: %s", r.raw)
	}

	// Start looking through her eyes. do() keeps the cookies the server set,
	// which is how the browser would behave.
	r := root.do(t, http.MethodPost, "/api/v1/admin/users/"+aliceID+"/impersonate")
	r.mustStatus(t, http.StatusOK)
	if r.body["read_only"] != true {
		t.Fatalf("impersonation should be read only: %s", r.raw)
	}
	if !root.assumeCookiePresent() {
		t.Fatal("no assumed identity cookie came back")
	}

	// She now sees her own account, with her data.
	r = root.do(t, http.MethodGet, "/api/v1/admin/users/"+aliceID+"/tabspaces")
	r.mustStatus(t, http.StatusOK)
	if total, _ := r.body["total"].(float64); total != 1 {
		t.Fatalf("the operator should see her tabverse: %s", r.raw)
	}
	// And the console can tell it is assuming, for the banner.
	r = root.do(t, http.MethodGet, "/api/v1/console/impersonation")
	r.mustStatus(t, http.StatusOK)
	if r.body["assuming"] != true || r.body["read_only"] != true {
		t.Fatalf("impersonation status: %s", r.raw)
	}
	if r.body["as"] != "alice@example.com" {
		t.Fatalf("impersonation should name the account: %s", r.raw)
	}

	// Everything that would change something is refused, and the refusal is
	// recorded rather than swallowed.
	before, err := s.store.ListAudit(ctx, store.AuditImpersonateFail, aliceID, 10)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	r = root.do(t, http.MethodPost, "/api/v1/admin/users/"+aliceID+"/invites")
	r.mustStatus(t, http.StatusForbidden)
	if r.body["error"] != "read_only" {
		t.Fatalf("expected read_only, got %s", r.raw)
	}
	after, err := s.store.ListAudit(ctx, store.AuditImpersonateFail, aliceID, 10)
	if err != nil || len(after) != len(before)+1 {
		t.Fatalf("a refused write under impersonation was not audited: %d -> %d (%v)",
			len(before), len(after), err)
	}

	// Entering was audited too, naming both sides.
	entries, err := s.store.ListAudit(ctx, store.AuditImpersonateIn, aliceID, 10)
	if err != nil || len(entries) != 1 {
		t.Fatalf("no impersonation_start entry: %+v (%v)", entries, err)
	}
	if entries[0].Actor != rootID {
		t.Fatalf("the entry does not name the operator: %+v", entries[0])
	}

	// Stop, and the operator is themselves again.
	root.do(t, http.MethodPost, "/api/v1/console/impersonate/stop").
		mustStatus(t, http.StatusNoContent)
	r = root.do(t, http.MethodGet, "/api/v1/console/impersonation")
	if r.body["assuming"] != false {
		t.Fatalf("still assuming after stop: %s", r.raw)
	}
	// ...and can write again.
	root.do(t, http.MethodPost, "/api/v1/admin/users/"+rootID+"/invites").
		mustStatus(t, http.StatusCreated)

	out, err := s.store.ListAudit(ctx, store.AuditImpersonateOut, aliceID, 10)
	if err != nil || len(out) != 1 {
		t.Fatalf("no impersonate_end entry: %+v (%v)", out, err)
	}
}

func TestAnOperatorCannotImpersonateAnotherOperator(t *testing.T) {
	ts, s := newAccountServer(t)
	ctx := context.Background()

	first := signInAs(t, ts, s, "first@example.com")
	firstID, _ := first.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	if err := s.store.SetRole(ctx, firstID, store.RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}
	second := signInAs(t, ts, s, "second@example.com")
	secondID, _ := second.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	if err := s.store.SetRole(ctx, secondID, store.RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}

	first = signInAs(t, ts, s, "first@example.com")
	r := first.do(t, http.MethodPost, "/api/v1/admin/users/"+secondID+"/impersonate")
	r.mustStatus(t, http.StatusForbidden)
	if r.body["error"] != "cannot_impersonate_admin" {
		t.Fatalf("expected a refusal, got %s", r.raw)
	}
	// And the attempt is on the record.
	entries, err := s.store.ListAudit(ctx, store.AuditImpersonateFail, secondID, 10)
	if err != nil || len(entries) != 1 {
		t.Fatalf("the refused attempt was not audited: %+v (%v)", entries, err)
	}
}

func TestAPersonCannotImpersonateAtAll(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	bobID, _, err := s.store.UpsertIdentity(context.Background(), accounts.ProviderEmail,
		"sub-bob", "bob@example.com", "Bob", true)
	if err != nil {
		t.Fatalf("bob: %v", err)
	}
	r := alice.do(t, http.MethodPost, "/api/v1/admin/users/"+bobID+"/impersonate")
	r.mustStatus(t, http.StatusForbidden)
	if r.body["error"] == "" {
		t.Fatalf("expected an explanation, got %s", r.raw)
	}
}

// mintDeviceToken pairs a device for an account through the console's own
// flow, so a test can seed that account's data.
func mintDeviceToken(t *testing.T, ts *httptest.Server, s *Server, userID string) string {
	t.Helper()
	acc, err := s.store.AccountByID(context.Background(), userID)
	if err != nil {
		t.Fatalf("account %s: %v", userID, err)
	}
	// A session for the account that owns the device: the same path a person
	// takes, without a browser.
	owner := signInAs(t, ts, s, acc.Email)
	r := owner.doJSON(t, http.MethodPost,
		"/api/v1/admin/users/"+acc.ID+"/invites?ttl_seconds=300", nil)
	r.mustStatus(t, http.StatusCreated)
	c, _ := r.body["code"].(string)
	paired := doJSON(t, http.MethodPost, ts.URL+"/api/v1/auth/pair", "",
		map[string]string{"invite_code": c, "device_name": "seed"})
	paired.mustStatus(t, http.StatusCreated)
	tok, _ := paired.body["token"].(string)
	if tok == "" {
		t.Fatalf("no device token: %s", paired.raw)
	}
	return tok
}

// waitOutRevocationWindow sleeps until a session issued now would be newer than
// the account's revocation cut-off. It normally returns immediately.
func waitOutRevocationWindow(t *testing.T, s *Server, userID string) {
	t.Helper()
	cut, err := s.store.TokensValidAfter(context.Background(), userID)
	if err != nil {
		t.Fatalf("cut-off: %v", err)
	}
	if time.Now().Unix() > time.UnixMilli(cut).Unix() {
		return
	}
	time.Sleep(time.Until(time.UnixMilli(cut).Truncate(time.Second).Add(time.Second)) + 10*time.Millisecond)
}

// sessionClaimsFor builds the claims the library would sign after a login: a
// provider shaped id, exactly as accounts.ResolveAccountID expects, and the
// address the provider reported, which is what the account is linked by.
func sessionClaimsFor(userID, email string) token.Claims {
	now := time.Now()
	return token.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "session-" + userID,
			Audience:  jwt.ClaimStrings{"tabversed"},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
		User: &token.User{
			ID:       accounts.ProviderEmail + "_" + userID,
			Name:     userID,
			Email:    email,
			Audience: "tabversed",
		},
	}
}

// ---- the journey a person actually takes ----------------------------------

// The first-operator journey, walked end to end: the console's form, the link
// the "email" carries, the session that link produces, and the operator role
// that comes with it.
//
// Two things about the auth library made this worth writing rather than
// assuming. Its verify provider reads the address from the *query string* as
// `address` (a POST body is ignored, and a missing `site` produces a token the
// extractor later rejects), and its default message is a bare JWT rather than a
// link. Both the form and the template are ours to get right, and a mistake in
// either is a bare 400 or an unusable message.
func TestTheFirstOperatorJourney(t *testing.T) {
	ts, s := newAccountServer(t)

	var sentTo, sentText string
	s.accounts.SetSenderOverride(func(address, text string) error {
		sentTo, sentText = address, text
		return nil
	})

	// 1. the console's sign-in form
	query := url.Values{
		"user":    {testAdminEmail},
		"address": {testAdminEmail},
		"site":    {"http://127.0.0.1:8223"},
	}
	form := doRequest(t, ts, http.MethodPost,
		"/api/v1/console/signin-link?"+query.Encode())
	if form.StatusCode != http.StatusOK {
		t.Fatalf("the sign-in form = %d, want 200: %s", form.StatusCode, readAll(t, form))
	}
	if sentTo != testAdminEmail {
		t.Fatalf("the link went to %q, want %q (response: %s)", sentTo, testAdminEmail, readAll(t, form))
	}
	if !strings.Contains(sentText, "/auth/"+accounts.ProviderEmail+"/login?token=") {
		t.Fatalf("the message has no clickable link: %q", sentText)
	}
	if !strings.Contains(sentText, "30 minutes") {
		t.Fatalf("the message does not say the link expires: %q", sentText)
	}

	// 2. following the link, as a person would
	// The link is absolute, because the person may be on another machine; the
	// test's server is on a different port, so only the path is replayed.
	link := strings.TrimSpace(sentText[strings.Index(sentText, "http"):])
	link = link[:strings.IndexAny(link, " \n")]
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("the link is not a url: %q (%v)", link, err)
	}
	link = u.RequestURI()
	followed := doRequest(t, ts, http.MethodGet, link)
	// Following the link has to end in the console. Without a `from`, the
	// library signs the person in and then renders the user as JSON, which is a
	// successful sign-in that looks like a dead end.
	if followed.StatusCode != http.StatusSeeOther {
		t.Fatalf("following the link = %d, want a redirect to the console: %s",
			followed.StatusCode, readAll(t, followed))
	}
	if to := followed.Header.Get("Location"); to != "http://127.0.0.1:8223" {
		t.Fatalf("the sign-in sends the person to %q, want the console", to)
	}
	var session, xsrf *http.Cookie
	for _, c := range followed.Cookies() {
		switch c.Name {
		case "tv_session":
			session = c
		case "tv_xsrf":
			xsrf = c
		}
	}
	if session == nil {
		t.Fatalf("the link did not sign anybody in; cookies: %v", followed.Cookies())
	}

	// 3. that session is the operator
	client := &sessionClient{ts: ts, cookies: []*http.Cookie{session, xsrf}, xsrfHeader: "X-XSRF-Token"}
	me := client.do(t, http.MethodGet, "/api/v1/console/me").body
	if me["signed_in"] != true {
		t.Fatalf("the session from the link does not work: %v", me)
	}
	if me["role"] != store.RoleAdmin {
		t.Fatalf("the first operator is %v, want admin", me["role"])
	}
	// ...and it reaches the operator views, which is the whole point.
	client.do(t, http.MethodGet, "/api/v1/admin/users").mustStatus(t, http.StatusOK)
	// The link is single use.
	again := doRequest(t, ts, http.MethodGet, link)
	if again.StatusCode == http.StatusOK {
		// The library answers a replay with 403 (consumed) or 200 with a
		// *new* link depending on whether a confirmation store is configured;
		// what must never happen is a second session for the same token.
		var replaySession *http.Cookie
		for _, c := range again.Cookies() {
			if c.Name == "tv_session" {
				replaySession = c
			}
		}
		if replaySession != nil && replaySession.Value == session.Value {
			t.Fatal("following the same link twice produced a live session")
		}
	}
}

// doRequest sends one request and does *not* follow redirects: following the
// sign-in link answers "where did the person end up", which is a different
// question from "did the link redirect them into the console".
func doRequest(t *testing.T, ts *httptest.Server, method, path string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	return res
}

func readAll(t *testing.T, res *http.Response) string {
	t.Helper()
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return string(raw)
}

// TestDebugJourney prints what each step of the sign-in flow leaves behind, for
// the times when the session is refused and the only clue is in the store.
func TestDebugJourney(t *testing.T) {
	ts, s := newAccountServer(t)
	var sentTo, sentText string
	s.accounts.SetSenderOverride(func(a, txt string) error { sentTo, sentText = a, txt; return nil })
	q := url.Values{"user": {testAdminEmail}, "address": {testAdminEmail}, "site": {"http://127.0.0.1:8223"}}
	form := doRequest(t, ts, http.MethodPost, "/api/v1/console/signin-link?"+q.Encode())
	t.Logf("form: %d %s", form.StatusCode, readAll(t, form))
	t.Logf("sent to %q: %q", sentTo, sentText)
	link := sentText[strings.Index(sentText, "http"):]
	link = link[:strings.IndexAny(link, " \\n")]
	if u, err := url.Parse(link); err == nil {
		link = u.RequestURI()
	}
	t.Logf("requesting %s", link)
	followed := doRequest(t, ts, http.MethodGet, link)
	t.Logf("follow: %d %s", followed.StatusCode, readAll(t, followed))
	for _, c := range followed.Cookies() {
		t.Logf("cookie %s", c.Name)
	}
	rows, err := s.store.DB().QueryContext(context.Background(),
		`SELECT u.id, u.email, u.role, i.provider, i.subject FROM users u LEFT JOIN identities i ON i.user_id = u.id`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, email, role sql.NullString
		var provider, subject sql.NullString
		if err := rows.Scan(&id, &email, &role, &provider, &subject); err != nil {
			t.Fatalf("scan: %v", err)
		}
		t.Logf("user %s email=%q role=%q identity=%q/%q",
			id.String, email.String, role.String, provider.String, subject.String)
	}
}

// A console served over plain http cannot have Secure cookies: the browser
// drops them, so a sign-in that works on the server looks like it worked and
// then signs the person straight back out.
func TestPlainHttpGetsUsableCookies(t *testing.T) {
	ts, s := newAccountServer(t) // the fixture serves http://127.0.0.1:8223

	var sentText string
	s.accounts.SetSenderOverride(func(_, text string) error {
		sentText = text
		return nil
	})
	q := url.Values{
		"user":    {testAdminEmail},
		"address": {testAdminEmail},
		"site":    {"http://127.0.0.1:8223"},
	}
	doRequest(t, ts, http.MethodPost, "/api/v1/console/signin-link?"+q.Encode()).Body.Close()

	link := sentText[strings.Index(sentText, "http"):]
	link = link[:strings.IndexAny(link, " \n")]
	if u, err := url.Parse(link); err == nil {
		link = u.RequestURI()
	}
	followed := doRequest(t, ts, http.MethodGet, link)
	followed.Body.Close()
	if followed.StatusCode != http.StatusSeeOther {
		t.Fatalf("following the link = %d, want a redirect to the console", followed.StatusCode)
	}
	for _, c := range followed.Cookies() {
		if c.Name == "tv_session" && c.Secure {
			t.Fatal("a Secure session cookie over plain http: the browser would drop it, " +
				"and the sign-in would appear to work and then sign the person out")
		}
	}
}

// Deleting is the one thing a person may do to their own account without an
// operator, and the one thing an operator may not do to their own: the first is
// the ordinary expectation of an account system, the second would leave the
// deployment with no way back in.
func TestDeletingAccounts(t *testing.T) {
	ts, s := newAccountServer(t)
	ctx := context.Background()
	own := signInAs(t, ts, s, "alice@example.com")
	ownID, _ := own.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	// The confirmation is required whatever else is true: this one is
	// irreversible.
	r := own.doJSON(t, http.MethodDelete, "/api/v1/admin/users/"+ownID, nil)
	r.mustStatus(t, http.StatusBadRequest)
	if r.body["error"] != "confirmation_required" {
		t.Fatalf("an unconfirmed delete = %s", r.raw)
	}

	// A person, on their own account, with the confirmation: allowed.
	own.doJSON(t, http.MethodDelete,
		"/api/v1/admin/users/"+ownID+"?confirm="+ownID, nil).
		mustStatus(t, http.StatusNoContent)
	if _, err := s.store.AccountByID(ctx, ownID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("the account is still there: %v", err)
	}

	// An operator, on their own account: refused, with the reason.
	op := operatorSession(t, ts, s)
	opID, _ := op.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	r = op.doJSON(t, http.MethodDelete,
		"/api/v1/admin/users/"+opID+"?confirm="+opID, nil)
	r.mustStatus(t, http.StatusConflict)
	if r.body["error"] != "cannot_delete_self" {
		t.Fatalf("an operator deleting their own account = %s", r.raw)
	}
	// ...and the account is still there, which is the point.
	if _, err := s.store.AccountByID(ctx, opID); err != nil {
		t.Fatalf("the operator's account was deleted anyway: %v", err)
	}
}
