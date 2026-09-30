package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-pkgz/auth/v2/token"
	"github.com/golang-jwt/jwt/v5"

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// The console API now answers to two credentials, and the interesting cases are
// the ones in between: a signed-in person reaching their own account, reaching
// somebody else's, and reaching an operator-only view (adr/0012).

func newAccountServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	cfg := config.Config{
		Addr: ":0", DBPath: filepath.Join(t.TempDir(), "accounts-api.db"),
		MaxRecordBytes: 1 << 20, SyncBatchLimit: 100, SearchLimit: 50,
		Version: "test", AdminToken: testAdminToken,
		AuthMode: "accounts", PublicURL: "http://127.0.0.1:8223",
		SecureCookies: false, LinkByEmail: true, RequireEmailVerification: true,
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	svc, err := accounts.New(cfg, st, nil)
	if err != nil {
		t.Fatalf("accounts: %v", err)
	}
	s := New(cfg, st, hub.New(), nil).WithAccounts(svc)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, s
}

// signInAs creates an account and returns a signed-in client: a cookie jar and
// the XSRF header the console has to send back.
func signInAs(t *testing.T, ts *httptest.Server, s *Server, email string) *sessionClient {
	t.Helper()
	ctx := context.Background()
	userID, _, err := s.store.UpsertIdentity(ctx, accounts.ProviderEmail,
		"subject-"+email, email, email, true)
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := s.store.MarkEmailVerified(ctx, userID); err != nil {
		t.Fatalf("verify: %v", err)
	}

	// Verifying an address revokes sessions issued before the proof, so a login
	// in the same second is refused once (accounts.SessionRevocationWindow).
	// A real person clicks the link and signs in a moment later; the test has
	// to step over the same boundary rather than pretend it is not there.
	waitOutRevocationWindow(t, s, userID)

	// The library owns login, so the test signs in the way it does: a session
	// token through its own token service, then a request carrying it.
	rec := httptest.NewRecorder()
	claims := sessionClaimsFor(userID)
	mw := s.accounts.Middleware()
	if _, err := mw.JWTService.Set(rec, claims); err != nil {
		t.Fatalf("sign in: %v", err)
	}
	return &sessionClient{cookies: rec.Result().Cookies(), ts: ts, xsrfHeader: "X-XSRF-Token"}
}

type sessionClient struct {
	cookies    []*http.Cookie
	ts         *httptest.Server
	xsrfHeader string
}

func (c *sessionClient) assumeCookiePresent() bool {
	for _, cookie := range c.cookies {
		if cookie.Name == "tv_assume" && cookie.Value != "" {
			return true
		}
	}
	return false
}

func (c *sessionClient) do(t *testing.T, method, path string) apiResp {
	t.Helper()
	req, err := http.NewRequest(method, c.ts.URL+path, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
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
	// Keep the cookies the server sets, the way a browser would: that is how
	// impersonation's assumed identity arrives at the next request.
	for _, cookie := range res.Cookies() {
		// A cookie with no value is a deletion, and a browser really does drop
		// it. Ignoring deletions would make a "stop impersonating" test pass
		// while the browser had not actually stopped.
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
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("decode %s: %v", res.Request.URL, err)
		}
	}
	return apiResp{status: res.StatusCode, body: out, raw: string(raw)}
}

func TestConsoleMeBeforeAndAfterSignIn(t *testing.T) {
	ts, s := newAccountServer(t)

	// Before signing in, the page learns the deployment is in account mode -
	// that is how it knows to show a login form at all.
	r := (&sessionClient{ts: ts}).do(t, http.MethodGet, "/api/v1/console/me")
	r.mustStatus(t, http.StatusOK)
	if r.body["signed_in"] != false || r.body["accounts_enabled"] != true {
		t.Fatalf("signed out: %s", r.raw)
	}
	if r.body["admin_token"] != true {
		t.Fatalf("the break-glass token should still be advertised: %s", r.raw)
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
	_, token := seedUser(t, ts, "carol")

	// A device token is a credential for the extension, not for the console.
	r := doJSON(t, http.MethodGet, ts.URL+"/api/v1/admin/users", token, nil)
	r.mustStatus(t, http.StatusUnauthorized)

	// And the console API with a session is a different thing from a bearer
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
	// So are the deployment totals and account creation.
	alice.do(t, http.MethodGet, "/api/v1/admin/totals").mustStatus(t, http.StatusForbidden)
	alice.do(t, http.MethodPost, "/api/v1/admin/users").
		mustStatus(t, http.StatusForbidden)

	// The break-glass token still reaches them, which is the point of it.
	adminDo(t, ts, http.MethodGet, "/api/v1/admin/users", testAdminToken, nil).
		mustStatus(t, http.StatusOK)
}

func TestAnOperatorSessionReachesTheOperatorViews(t *testing.T) {
	ts, s := newAccountServer(t)
	ctx := context.Background()
	root := signInAs(t, ts, s, "root@example.com")
	rootID, _ := root.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	if err := s.store.SetRole(ctx, rootID, store.RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}
	// The role travels in the claim, so a *new* session is needed to see it -
	// which is the honest behaviour: a role change takes effect on next sign-in
	// or on the token's refresh, not silently mid-session.
	fresh := signInAs(t, ts, s, "root@example.com")
	r := fresh.do(t, http.MethodGet, "/api/v1/admin/users")
	r.mustStatus(t, http.StatusOK)
	users, _ := r.body["users"].([]any)
	if len(users) == 0 {
		t.Fatalf("operator sees no accounts: %s", r.raw)
	}
}

func TestSignOutClearsTheSession(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	alice.do(t, http.MethodGet, "/api/v1/console/me").mustStatus(t, http.StatusOK)

	r := alice.do(t, http.MethodPost, "/api/v1/console/signout")
	r.mustStatus(t, http.StatusNoContent)
	// The jar still holds the old cookies, so this checks the audit entry and
	// that the endpoint exists rather than that the browser forgot the cookie.
	entries, err := s.store.ListAudit(context.Background(), store.AuditLogout, "", 10)
	if err != nil || len(entries) != 1 {
		t.Fatalf("sign out was not audited: %+v (%v)", entries, err)
	}
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

// sessionClaimsFor builds the claims the library would sign after a login. The
// id is provider shaped, exactly as accounts.ResolveAccountID expects.
func sessionClaimsFor(userID string) token.Claims {
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
			Audience: "tabversed",
		},
	}
}

// TestSessionFailureIsExplainable keeps the diagnosis that unblocked this whole
// feature: a refused session reports *why*. Every one of these sessions was
// refused for a different reason, and while the guard only said "401" the only
// way to tell them apart was to instrument it - which is worth guarding, because
// the next person to add a session path will hit the same wall.
func TestSessionFailureIsExplainable(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	t.Logf("cookies: %d", len(alice.cookies))
	for _, c := range alice.cookies {
		t.Logf("  %s (httponly=%v) = %.40s...", c.Name, c.HttpOnly, c.Value)
	}
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/console/me", nil)
	for _, c := range alice.cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	s.accounts.Guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := token.GetUserInfo(r)
		t.Logf("inside Guard: user=%+v err=%v", u, err)
	})).ServeHTTP(rec, req)
	t.Logf("guard status=%d body=%.120s", rec.Code, rec.Body.String())
	// The guard writes 401 for "no valid session" and the reason is available
	// separately; a future change that loses either half shows up here.
	if rec.Code == http.StatusUnauthorized && s.accounts.LastAuthError() == nil {
		t.Fatal("a refused session must record why it was refused")
	}
}

// The point of accounts: a person can add a device to their own account
// without an operator, which is the chicken-and-egg problem ADR 0012 set out to
// remove. The code is minted for them, and for nobody else.
func TestAPersonMintsTheirOwnPairingCode(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	me, _ := alice.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	r := alice.do(t, http.MethodPost, "/api/v1/admin/users/"+me+"/invites?ttl_seconds=300")
	r.mustStatus(t, http.StatusCreated)
	code, _ := r.body["code"].(string)
	if code == "" {
		t.Fatalf("no code returned: %s", r.raw)
	}
	if r.body["user_id"] != me {
		t.Fatalf("the code is for %v, want %s", r.body["user_id"], me)
	}

	// It works: the extension can redeem it and get a device token.
	paired := doJSON(t, http.MethodPost, ts.URL+"/api/v1/auth/pair", "",
		map[string]string{"invite_code": code, "device_name": "my laptop"})
	paired.mustStatus(t, http.StatusCreated)
	if paired.body["user_id"] != me {
		t.Fatalf("the paired device belongs to %v, want %s", paired.body["user_id"], me)
	}
	if _, ok := paired.body["token"].(string); !ok {
		t.Fatalf("no device token: %s", paired.raw)
	}

	// And it is audited, because "this person added a device" is exactly the
	// question an operator asks.
	entries, err := s.store.ListAudit(context.Background(), "", me, 50)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("pairing by a person left no audit trail")
	}
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
	if r.body["as"] == "" || r.body["as"] == aliceID {
		t.Fatalf("impersonation does not name the account: %s", r.raw)
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
	// The operator token: this is test scaffolding standing in for "the
	// person signs in and pairs their own device", and it is the credential
	// that path does not need a browser for.
	r := adminDo(t, ts, http.MethodPost,
		"/api/v1/admin/users/"+acc.ID+"/invites?ttl_seconds=300", testAdminToken, nil)
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
