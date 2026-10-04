package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// The session lifetime is the server's to enforce, and until ADR 0021 it was
// not: the library ignores a cookie-borne token's expiry and re-mints it, so a
// console session slid for as long as it was used. These are the tests for the
// other half of that story - that it ends, that it can be ended early, that a
// sign-in is written down, and that the link that mints one cannot be replayed.

// newSessionServer is newServerWithConfig with the knobs the session tests need
// to turn. The session lifetimes are set explicitly here, as Load would.
func newSessionServer(t *testing.T, adminEmail string, tweak func(*config.Config)) (*httptest.Server, *Server) {
	t.Helper()
	cfg := config.Config{
		Addr: ":0", DBPath: filepath.Join(t.TempDir(), "session-api.db"),
		MaxRecordBytes: 1 << 20, SyncBatchLimit: 100, SearchLimit: 50,
		Version: "test", AdminEmail: adminEmail,
		PublicURL:     "http://127.0.0.1:8223",
		SecureCookies: false, LinkByEmail: true, RequireEmailVerification: true,
		SessionTTL: 24 * time.Hour, SessionCookieTTL: 24 * time.Hour,
	}
	if tweak != nil {
		tweak(&cfg)
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

// expiredSessionClient mints a session whose token is already past its expiry:
// the state the library used to wave through and then refresh.
func expiredSessionClient(t *testing.T, ts *httptest.Server, s *Server, email string) *sessionClient {
	t.Helper()
	fresh := signInAs(t, ts, s, email)
	userID := fresh.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	rec := httptest.NewRecorder()
	claims := sessionClaimsFor(userID, email)
	past := time.Now().Add(-time.Minute)
	claims.ExpiresAt = jwt.NewNumericDate(past)
	claims.IssuedAt = jwt.NewNumericDate(past)
	if _, err := s.accounts.Middleware().JWTService.Set(rec, claims); err != nil {
		t.Fatalf("mint an expired session: %v", err)
	}
	var session, xsrf *http.Cookie
	for _, c := range rec.Result().Cookies() {
		switch c.Name {
		case "tv_session":
			session = c
		case "tv_xsrf":
			xsrf = c
		}
	}
	if session == nil {
		t.Fatal("no session cookie was minted")
	}
	return &sessionClient{
		ts: ts, cookies: []*http.Cookie{session, xsrf},
		xsrfHeader: "X-XSRF-Token", srv: s,
	}
}

// realSession walks the whole sign-in - the console's form, then the link it
// emails - and returns the session that produced.
//
// It exists because a session cannot be faked into existence for these tests.
// The library derives the claim's subject from the address, so the identity row
// that revocation is checked against only exists once a real sign-in has been
// through EnsureAccount; minting claims by hand (as signInAs does) produces a
// session whose subject resolves to nothing, and SessionAllowed treats an
// unknown subject as "a registration that has not happened yet" and allows it.
//
// `label` is the display name that goes into the link. The confirmation token
// carries no id of its own, so two requests made in the same second with the
// same name produce a byte-identical link, and redeeming it a second time is a
// replay - correctly refused. Varying the name is how this asks for two links.
func realSession(t *testing.T, s *Server, ts *httptest.Server, email, label string) *sessionClient {
	t.Helper()
	var sentText string
	s.accounts.SetSenderOverride(func(_ string, text string) error {
		sentText = text
		return nil
	})
	q := url.Values{
		"user": {label}, "address": {email}, "site": {"http://127.0.0.1:8223"},
	}
	res := doRequest(t, ts, http.MethodPost, "/api/v1/console/signin-link?"+q.Encode())
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.Contains(sentText, "?token=") {
		t.Fatalf("asking for a link: %d, nothing sent", res.StatusCode)
	}
	link := strings.TrimSpace(sentText[strings.Index(sentText, "http"):])
	link = link[:strings.IndexAny(link, " \n")]
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	followed := doRequest(t, ts, http.MethodGet, u.RequestURI())
	followed.Body.Close()
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
		t.Fatalf("following the link did not sign %s in", email)
	}
	client := &sessionClient{
		ts: ts, cookies: []*http.Cookie{session, xsrf},
		xsrfHeader: "X-XSRF-Token", srv: s,
	}
	// The one request that resolves the identity row, so the sessions this test
	// makes are revocable ones.
	if me := client.do(t, http.MethodGet, "/api/v1/console/me").body; me["signed_in"] != true {
		t.Fatalf("the real sign-in does not work: %v", me)
	}
	return client
}

// The hole this closes: a token that says it expired still authenticated,
// because the library treats a cookie-borne token's expiry as advisory and then
// re-mints it with a full cookie duration.
func TestExpiredSessionIsRefusedAndItsCookiesCleared(t *testing.T) {
	ts, s := newSessionServer(t, testAdminEmail, nil)
	client := expiredSessionClient(t, ts, s, testAdminEmail)

	// /me is under the soft guard, so it answers rather than refusing - and the
	// answer is "nobody is signed in".
	if me := client.do(t, http.MethodGet, "/api/v1/console/me").body; me["signed_in"] != false {
		t.Fatalf("an expired session still reads as signed in: %v", me)
	}
	// The refusal also clears the cookies, so the browser stops presenting a
	// credential the server will never honour again. do() mirrors a browser's
	// cookie jar, so a deleted cookie is simply gone from the client.
	for _, c := range client.cookies {
		if c.Name == "tv_session" {
			t.Fatal("the stale session cookie was left in the browser")
		}
	}

	// A guarded route is a plain 401.
	if r := client.do(t, http.MethodGet, "/api/v1/admin/users"); r.status != http.StatusUnauthorized {
		t.Fatalf("an expired session on an operator route = %d, want 401: %s", r.status, r.raw)
	}
}

// 0 is the documented "this deployment does not want a server-side bound", so it
// has to keep the pre-hardening behaviour rather than expiring everything at
// once (or, worse, falling back to the library's 15 minute default).
func TestZeroSessionTTLMeansNoBound(t *testing.T) {
	ts, s := newSessionServer(t, testAdminEmail, func(c *config.Config) {
		c.SessionTTL = 0
		c.SessionCookieTTL = 0
	})
	client := expiredSessionClient(t, ts, s, testAdminEmail)
	if me := client.do(t, http.MethodGet, "/api/v1/console/me").body; me["signed_in"] != true {
		t.Fatalf("SessionTTL=0 should not expire anything: %v", me)
	}
}

// "Sign out everywhere" ends this browser's session and every other one, and
// says so in the audit log.
func TestRevokeSessionsEndsEverySession(t *testing.T) {
	ts, s := newSessionServer(t, testAdminEmail, nil)
	first := realSession(t, s, ts, testAdminEmail, testAdminEmail)
	userID, _ := first.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	// A second browser on the same account: "everywhere" is every session of
	// *this* account, not every account on the server. Asking for the link again
	// is a second real sign-in, which is the only honest way to have two.
	second := realSession(t, s, ts, testAdminEmail, "a second browser")
	if second == first {
		t.Fatal("the two sessions are the same object")
	}

	first.doJSON(t, http.MethodPost, "/api/v1/console/revoke-sessions", nil).
		mustStatus(t, http.StatusNoContent)

	for name, client := range map[string]*sessionClient{"the caller": first, "the other browser": second} {
		if body := client.do(t, http.MethodGet, "/api/v1/console/me").body; body["signed_in"] != false {
			t.Fatalf("%s is still signed in after the revocation: %v", name, body)
		}
	}

	entries, err := s.store.ListAudit(context.Background(), store.AuditSessionsRevoked, "", 10)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(entries) != 1 || entries[0].Target != userID {
		t.Fatalf("the revocation was not audited against the account: %+v", entries)
	}
}

// The device tokens are a different credential and must survive it: "sign out
// everywhere" is about the console, and a person who read it as "unpair my
// devices" would be very unhappy about the data that stopped syncing.
func TestRevokeSessionsLeavesDeviceTokensAlone(t *testing.T) {
	_, op := newAdminServer(t)
	_, deviceToken := seedUser(t, op, "alice")

	// Before: the device syncs.
	_, before := push(t, op.ts, deviceToken, []pushedRecord{
		{Entity: "tabspace", ID: "ts_before", UpdatedAt: 1700000000000,
			Payload: `{"id":"ts_before","name":"before","tabIds":[]}`},
	})
	if before.status != http.StatusOK {
		t.Fatalf("the device does not sync before the revocation: %s", before.raw)
	}

	op.doJSON(t, http.MethodPost, "/api/v1/console/revoke-sessions", nil).
		mustStatus(t, http.StatusNoContent)

	// After: it still does. The sync path is a bearer token out of the tokens
	// table; if the revocation had reached it, this would be a 401.
	_, after := push(t, op.ts, deviceToken, []pushedRecord{
		{Entity: "tabspace", ID: "ts_after", UpdatedAt: 1700000001000,
			Payload: `{"id":"ts_after","name":"still syncing","tabIds":[]}`},
	})
	if after.status != http.StatusOK {
		t.Fatalf("the device stopped syncing after a console revocation: %s", after.raw)
	}

	// And it can still read, which is checked with the device token rather than
	// the console's: the revocation signed *this* browser out, so the operator
	// routes are exactly what can no longer be called here.
	pull := doJSON(t, http.MethodGet, op.ts.URL+"/api/v1/sync?since=0", deviceToken, nil)
	pull.mustStatus(t, http.StatusOK)
	rows, _ := pull.body["records"].([]any)
	if len(rows) != 2 {
		t.Fatalf("want both records on the device, got %d: %s", len(rows), pull.raw)
	}
}

// The operator's version of the same call, for the case where the person to fix
// is not the one at the keyboard.
func TestOperatorCanRevokeSomebodyElsesSessions(t *testing.T) {
	_, op := newAdminServer(t)
	userID, _ := seedUser(t, op, "alice")

	op.doJSON(t, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/revoke-sessions", nil).
		mustStatus(t, http.StatusNoContent)

	entries, err := op.srv.store.ListAudit(context.Background(), store.AuditSessionsRevoked, userID, 10)
	if err != nil || len(entries) != 1 {
		t.Fatalf("the operator revocation was not audited against the account: %+v (%v)", entries, err)
	}
}

// A plain account cannot use the operator route to end somebody else's
// sessions.
func TestRevokeSessionsIsScopedToTheCaller(t *testing.T) {
	_, op := newAdminServer(t)
	userID, _ := seedUser(t, op, "alice")
	plain := signInAs(t, op.ts, op.srv, "plain@example.com")
	if r := plain.doJSON(t, http.MethodPut,
		"/api/v1/admin/users/"+userID+"/revoke-sessions", nil); r.status == http.StatusNoContent {
		t.Fatalf("a plain account revoked somebody else's sessions: %s", r.raw)
	}
}

// The sign-in link creates an account and sends mail, so it is the one endpoint
// a stranger can reach that has an effect in the world.
func TestSigninLinkIsThrottled(t *testing.T) {
	ts, s := newSessionServer(t, testAdminEmail, nil)
	s.accounts.SetSenderOverride(func(string, string) error { return nil })

	q := url.Values{
		"user": {testAdminEmail}, "address": {testAdminEmail},
		"site": {"http://127.0.0.1:8223"},
	}
	// Five an hour is the per-address limit.
	for i := 1; i <= 5; i++ {
		res := doRequest(t, ts, http.MethodPost, "/api/v1/console/signin-link?"+q.Encode())
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("request %d = %d, want 200", i, res.StatusCode)
		}
	}
	res := doRequest(t, ts, http.MethodPost, "/api/v1/console/signin-link?"+q.Encode())
	body := readAll(t, res)
	if res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("the sixth request = %d, want 429: %s", res.StatusCode, body)
	}
	// The refusal must not become an account directory: it is the same body
	// whoever the address is.
	if !strings.Contains(body, "rate_limited") {
		t.Fatalf("the refusal is not the documented one: %s", body)
	}
}

// The audit trail answers "who signed in, when, from where" - the question an
// operator asks after an incident, and the one AuditLogin existed unused for.
func TestSigninIsAudited(t *testing.T) {
	ts, s := newSessionServer(t, testAdminEmail, nil)
	var sentText string
	s.accounts.SetSenderOverride(func(_ string, text string) error {
		sentText = text
		return nil
	})
	q := url.Values{
		"user": {testAdminEmail}, "address": {testAdminEmail},
		"site": {"http://127.0.0.1:8223"},
	}
	doRequest(t, ts, http.MethodPost, "/api/v1/console/signin-link?"+q.Encode()).Body.Close()

	link := strings.TrimSpace(sentText[strings.Index(sentText, "http"):])
	link = link[:strings.IndexAny(link, " \n")]
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	followed := doRequest(t, ts, http.MethodGet, u.RequestURI())
	followed.Body.Close()

	entries, err := s.store.ListAudit(context.Background(), store.AuditLogin, "", 10)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("want one sign-in recorded, got %d: %+v", len(entries), entries)
	}
	if !strings.Contains(entries[0].Detail, accounts.ProviderEmail) {
		t.Fatalf("the sign-in does not say which provider signed it in: %+v", entries[0])
	}

	// A link that is not one is recorded as a failure rather than dropped.
	doRequest(t, ts, http.MethodGet,
		"/auth/"+accounts.ProviderEmail+"/login?token=not-a-real-token").Body.Close()
	failed, err := s.store.ListAudit(context.Background(), store.AuditLoginFailed, "", 10)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(failed) != 1 {
		t.Fatalf("want one failed sign-in recorded, got %d: %+v", len(failed), failed)
	}
}

// The sign-in link is a session wearing a 30 minute expiry, so "works once" is a
// claim about the server. With the confirmation store in the database it holds
// across a restart, which the library's in-memory default did not.
func TestSigninLinkCannotBeRedeemedTwice(t *testing.T) {
	ts, s := newSessionServer(t, testAdminEmail, nil)
	var sentText string
	s.accounts.SetSenderOverride(func(_ string, text string) error {
		sentText = text
		return nil
	})
	q := url.Values{
		"user": {testAdminEmail}, "address": {testAdminEmail},
		"site": {"http://127.0.0.1:8223"},
	}
	doRequest(t, ts, http.MethodPost, "/api/v1/console/signin-link?"+q.Encode()).Body.Close()
	link := strings.TrimSpace(sentText[strings.Index(sentText, "http"):])
	link = link[:strings.IndexAny(link, " \n")]
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("link: %v", err)
	}

	first := doRequest(t, ts, http.MethodGet, u.RequestURI())
	first.Body.Close()
	var live string
	for _, c := range first.Cookies() {
		if c.Name == "tv_session" {
			live = c.Value
		}
	}
	if live == "" {
		t.Fatal("following the link did not sign anybody in")
	}

	second := doRequest(t, ts, http.MethodGet, u.RequestURI())
	body := readAll(t, second)
	if second.StatusCode != http.StatusForbidden {
		t.Fatalf("replaying a used link = %d, want 403: %s", second.StatusCode, body)
	}
	for _, c := range second.Cookies() {
		if c.Name == "tv_session" && c.Value != "" {
			t.Fatalf("the replayed link issued a second live session")
		}
	}
}

// HSTS is a claim about the deployment, so it is only made where the deployment
// already serves https.
func TestHSTSOnlyOverHTTPS(t *testing.T) {
	secureTS, _ := newSessionServer(t, testAdminEmail, func(c *config.Config) {
		c.SecureCookies = true
		c.PublicURL = "https://console.example.com"
	})
	plainTS, _ := newSessionServer(t, testAdminEmail, nil)

	hsts := func(ts *httptest.Server) string {
		res := doRequest(t, ts, http.MethodGet, "/healthz")
		defer res.Body.Close()
		return res.Header.Get("Strict-Transport-Security")
	}
	if got := hsts(secureTS); got == "" {
		t.Fatal("an https deployment sent no HSTS header")
	}
	if got := hsts(plainTS); got != "" {
		t.Fatalf("a plain http deployment claimed https: %q", got)
	}
}
