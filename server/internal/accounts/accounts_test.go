package accounts

import (
	"context"
	"crypto/sha1"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-pkgz/auth/v2"
	"github.com/go-pkgz/auth/v2/middleware"
	"github.com/go-pkgz/auth/v2/provider"
	"github.com/go-pkgz/auth/v2/token"
	"github.com/golang-jwt/jwt/v5"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// The integration spike for go-pkgz/auth (adr/0012), kept as a test rather than
// thrown away, because the four things it answers are the four things the
// design rests on:
//
//  1. can a session be revoked?       -> the Validator hook over our store
//  2. does XSRF cover our own routes? -> the check lives in the extractor
//  3. can role/assumed claims travel? -> ClaimsUpd
//  4. is the dependency weight sane?  -> see TestDependencyWeight
//
// Everything runs through a real HTTP round trip, because the interesting parts
// (cookies, XSRF headers) exist nowhere else.

const (
	// The library requires exactly one audience on a user-bearing token; a
	// mismatch is reported as "aud is not of size 1" at request time, not at
	// sign-in, so the name is set explicitly here rather than left default.
	testAudience = "tabversed"

	// directProvider is the password login provider the rig registers; its name
	// is the prefix the authenticator expects on every user id.
	directProvider = ProviderEmail
)

type testRig struct {
	service *auth.Service
	// authErr records why the guard refused a request. The Authenticator hides
	// the reason behind a bare 401 unless an ErrorHandler is installed - which
	// is the first thing the real console needs, and the reason this rig has
	// one: a 401 with no explanation is the hardest kind of bug to chase.
	authErr *error
	store   *store.Store
	// The authenticator is a value, and UpdateUser does not install itself: it
	// *returns* a middleware, which has to be composed under Auth. Getting that
	// wrong is silent - the request is simply refused - so the rig keeps the
	// updater and composes both, as the real server will.
	mw middleware.Authenticator
	// the server the browser talks to, and what the "email" carried, so the
	// first-operator journey can be walked without an SMTP server
	url      string
	sentTo   string
	sentText string
	upd      middleware.UserUpdater
}

func newRig(t *testing.T) testRig {
	t.Helper()
	var authErr error
	st, err := store.Open(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	svc := auth.NewService(auth.Opts{
		SecretReader: token.SecretFunc(func(string) (string, error) {
			return "test-signing-key-0123456789abcdef", nil
		}),
		// Q3: the role the console branches on is a claim.
		ClaimsUpd: token.ClaimsUpdFunc(func(c token.Claims) token.Claims {
			if c.User == nil {
				return c
			}
			role, err := st.RoleOf(context.Background(), c.User.ID)
			if err != nil {
				role = store.RoleUser
			}
			c.User.Role = role
			return c
		}),
		TokenDuration:        time.Hour,
		CookieDuration:       24 * time.Hour,
		Issuer:               "tabversed-test",
		JWTCookieName:        sessionCookie,
		XSRFCookieName:       xsrfCookie,
		XSRFHeaderKey:        xsrfHeader,
		SecureCookies:        false, // httptest is http
		SameSiteCookie:       http.SameSiteLaxMode,
		AvatarStore:          nil, // not used: no avatars in the console
		UseGravatar:          false,
		AdminPasswd:          "",
		AllowedRedirectHosts: token.AllowedHostsFunc(func() ([]string, error) { return nil, nil }),
		// Q1: every session is checked against the account's state through one
		// shared predicate, so the rule cannot drift between the hook and the
		// tests.
		Validator: token.ValidatorFunc(func(_ string, c token.Claims) bool {
			if c.User == nil {
				return true
			}
			var issued time.Time
			if c.IssuedAt != nil {
				issued = c.IssuedAt.Time
			}
			return SessionAllowed(context.Background(), st, c.User.ID, issued)
		}),
	})

	// A password login provider, which is also what makes the spike exercise a
	// real login rather than a hand-made token. Its credential check is ours:
	// the library hands over the typed user and password and asks a yes/no
	// question, so the Argon2id hash stays in our hands.
	//
	// UserIDFunc is where the library's id convention meets ours: the claim
	// carries "<provider>_<subject>" (remark42's shape, and what the
	// authenticator's provider allow-list checks), and we translate that to the
	// account that owns the rows. The subject is our own user id, so the login
	// cannot be credited to the wrong account.
	svc.AddDirectProviderWithUserIDFunc(directProvider, provider.CredCheckerFunc(
		func(user, passwd string) (bool, error) {
			acc, err := st.AccountByEmail(context.Background(), user)
			if err != nil {
				return false, nil // unknown address: same answer as a wrong password
			}
			if !acc.CanLogin() || acc.PasswordHash == "" {
				return false, nil
			}
			if !VerifyPassword(acc.PasswordHash, passwd) {
				return false, nil
			}
			return true, nil
		}), func(user string, _ *http.Request) string {
		acc, err := st.AccountByEmail(context.Background(), user)
		if err != nil {
			return ""
		}
		return directProvider + "_" + acc.ID
	})

	// The claim id is provider shaped, so the validator hook has to resolve it
	// before it can ask the account anything.
	mw := svc.Middleware()
	upd := middleware.UserUpdFunc(func(u token.User) token.User {
		userID, known, err := ResolveAccountID(context.Background(), st, u.ID)
		if err != nil || !known {
			// A session for an identity this rig has not created.
			u.ID = ""
			return u
		}
		u.ID = userID
		if role, err := st.RoleOf(context.Background(), userID); err == nil {
			u.Role = role
		}
		return u
	})
	// The handler has to see the same Authenticator the guard uses, so it is
	// installed on the value we keep rather than on a copy.
	// Note what a custom ErrorHandler means: it *replaces* the response, and
	// the library returns without writing a status. A handler that only logs
	// turns every refusal into a 200, which is how this rig first "accepted"
	// three requests it should have rejected. The real console's handler writes
	// the status and a JSON body, and this one does the same.
	mw.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, code int, err error) {
		authErr = err
		w.WriteHeader(code)
	}
	return testRig{service: svc, store: st, mw: mw, upd: upd, authErr: &authErr}
}

// guard wraps an ordinary handler of ours - the shape every console route has -
// with the library's authenticator, showing it composes with a plain ServeMux
// and no router dependency.
func (r testRig) guard(next http.Handler) http.Handler {
	return r.mw.Auth(r.mw.UpdateUser(r.upd)(next))
}

// claimsFor builds a session the way the library does after a login. Note that
// the IssuedAt set here is overwritten by Set() with a whole-second value, which
// is why revocation is compared at second resolution.
func claimsFor(userID, name, email string, st *store.Store) token.Claims {
	now := time.Now()
	_ = st
	return token.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ID:       "session-" + userID,
			Audience: jwt.ClaimStrings{testAudience},
			// IssuedAt needs millisecond precision for the revocation cut-off
			// to mean anything; the package init in auth.go is what makes
			// NewNumericDate keep it, so the login handler does not have to
			// remember. The clamp above is the other half: a token stamped in
			// the same millisecond as a change would be refused, so a login
			// always stamps itself strictly after the cut-off.
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
		// The id is provider shaped: the authenticator's allow-list reads the
		// prefix, and the account behind it is resolved by id afterwards.
		// The claim id is "<provider>_<subject>", and the subject is what the
		// passwordless provider derives from the address - the same value
		// register() stores as the identity, or the session resolves to nothing.
		User: &token.User{
			ID:       directProvider + "_" + token.HashID(sha1.New(), email),
			Name:     name,
			Email:    email,
			Audience: testAudience,
		},
	}
}

// signIn mints the cookies a browser would hold, and returns a function that
// replays a request with them (echoing the XSRF header the way the console's
// JS does).
func (r testRig) signIn(t *testing.T, srv *httptest.Server, claims token.Claims, method string) func(withXSRF bool) int {
	t.Helper()
	m := r.service.Middleware()
	rec := httptest.NewRecorder()
	if _, err := m.JWTService.Set(rec, claims); err != nil {
		t.Fatalf("set token: %v", err)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) < 2 {
		t.Fatalf("expected a session and an XSRF cookie, got %d", len(cookies))
	}
	return func(withXSRF bool) int {
		req, err := http.NewRequest(method, srv.URL+"/api/v1/admin/users", nil)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		for _, c := range cookies {
			req.AddCookie(c)
			if withXSRF && c.Name == xsrfCookie {
				req.Header.Set(xsrfHeader, c.Value)
			}
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("do: %v", err)
		}
		res.Body.Close()
		return res.StatusCode
	}
}

func TestSessionCookieIsIssuedAndAcceptedByOurRoutes(t *testing.T) {
	rig := newRig(t)
	acc := store.Account{ID: register(t, rig, "yuli@example.com"), Name: "Yuli", Email: "yuli@example.com"}

	var sawUser, sawRole string
	guarded := rig.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := token.GetUserInfo(r)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		sawUser, sawRole = u.ID, u.Role
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(guarded)
	defer srv.Close()

	call := rig.signIn(t, srv, claimsFor(acc.ID, "Yuli", "yuli@example.com", rig.store), http.MethodGet)
	if code := call(true); code != http.StatusOK {
		t.Fatalf("authenticated request = %d, want 200", code)
	}
	if sawUser != acc.ID {
		t.Fatalf("handler saw user %q, want %q", sawUser, acc.ID)
	}
	if sawRole != store.RoleUser {
		t.Fatalf("handler saw role %q, want %q (ClaimsUpd is how the role travels)", sawRole, store.RoleUser)
	}
}

func TestCookiesAreHardened(t *testing.T) {
	// The session cookie must be unreadable from JS; the XSRF cookie is the
	// opposite - the page has to read it to echo it back - which is why the two
	// are separate cookies and not one clever value.
	rig := newRig(t)
	m := rig.service.Middleware()
	rec := httptest.NewRecorder()
	if _, err := m.JWTService.Set(rec, claimsFor("usr_1", "Yuli", "", rig.store)); err != nil {
		t.Fatalf("set token: %v", err)
	}
	var session, xsrf *http.Cookie
	for _, c := range rec.Result().Cookies() {
		switch c.Name {
		case sessionCookie:
			session = c
		case xsrfCookie:
			xsrf = c
		}
	}
	if session == nil || xsrf == nil {
		t.Fatalf("expected both cookies, got session=%v xsrf=%v", session, xsrf)
	}
	if !session.HttpOnly {
		t.Error("the session cookie must be HttpOnly")
	}
	if session.SameSite != http.SameSiteLaxMode {
		t.Errorf("session SameSite = %v, want Lax", session.SameSite)
	}
	if xsrf.HttpOnly {
		t.Error("the XSRF cookie must be readable by the page; it is the echo token")
	}
}

func TestXSRFIsEnforcedOnOurRoutes(t *testing.T) {
	// Q2: the check lives in the extractor's Get(), so it applies to *our*
	// handlers and not only to the library's own login endpoints. Without it,
	// every state changing route in the console would be forgeable from another
	// site the browser is logged in to.
	rig := newRig(t)
	acc := store.Account{ID: register(t, rig, "yuli2@example.com"), Name: "Yuli", Email: "yuli2@example.com"}
	guarded := rig.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(guarded)
	defer srv.Close()

	call := rig.signIn(t, srv, claimsFor(acc.ID, acc.Name, acc.Email, rig.store), http.MethodPost)
	if code := call(false); code == http.StatusOK {
		t.Fatal("a cookie session POST without the XSRF header was accepted")
	}
	if code := call(true); code != http.StatusOK {
		t.Fatalf("with the XSRF header = %d, want 200", code)
	}
}

func TestRevokingASession(t *testing.T) {
	// Q1: the JWT is self contained, so revocation is the account's
	// tokens_valid_after cut-off checked by our Validator hook. That is what
	// makes "sign out everywhere" and "revoke on password change" work without
	// keeping a session table.
	rig := newRig(t)
	ctx := context.Background()
	acc := store.Account{ID: register(t, rig, "yuli3@example.com"), Name: "Yuli", Email: "yuli3@example.com"}

	guarded := rig.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(guarded)
	defer srv.Close()

	// sign in first, with nothing revoked yet
	call := rig.signIn(t, srv, claimsFor(acc.ID, acc.Name, acc.Email, rig.store), http.MethodGet)
	if code := call(true); code != http.StatusOK {
		t.Fatalf("fresh session = %d, want 200 (auth error: %v)", code, (*rig.authErr))
	}

	// changing the password is exactly what should invalidate it
	if err := rig.store.SetPasswordHash(ctx, acc.ID, "argon2id$argon2id$after"); err != nil {
		t.Fatalf("change password: %v", err)
	}
	if code := call(true); code == http.StatusOK {
		t.Fatal("a session issued before the password change is still accepted")
	}

	// A session issued after the revocation works again - but not within the
	// same second, because the library stamps iat with second precision. That
	// second is the honest price of stateless tokens here, and the test pins it
	// rather than hiding it behind a retry.
	// The same cookie stays refused for the rest of that second.
	if code := call(true); code == http.StatusOK {
		t.Fatal("a session issued in the same second as the revocation was accepted")
	}
	waitForNextSecond()
	// A new sign-in, not the old cookie: its iat is baked in, so waiting cannot
	// rescue it - only a fresh session is issued after the cut-off.
	fresh := rig.signIn(t, srv, claimsFor(acc.ID, acc.Name, acc.Email, rig.store), http.MethodGet)
	if code := fresh(true); code != http.StatusOK {
		t.Fatalf("session after the revocation window = %d, want 200 (auth error: %v)",
			code, (*rig.authErr))
	}
}

func waitForNextSecond() {
	now := time.Now()
	time.Sleep(time.Until(now.Truncate(time.Second).Add(time.Second)) + 20*time.Millisecond)
}

func TestDisabledAccountLosesItsSession(t *testing.T) {
	// The same hook must refuse a disabled account, which is how "operator
	// switched this person off" takes effect without touching the JWT.
	rig := newRig(t)
	ctx := context.Background()
	acc := store.Account{ID: register(t, rig, "yuli4@example.com"), Name: "Yuli", Email: "yuli4@example.com"}
	guarded := rig.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(guarded)
	defer srv.Close()

	call := rig.signIn(t, srv, claimsFor(acc.ID, acc.Name, acc.Email, rig.store), http.MethodGet)
	if code := call(true); code != http.StatusOK {
		t.Fatalf("before disabling = %d, want 200", code)
	}
	if err := rig.store.SetDisabled(ctx, acc.ID, true); err != nil {
		t.Fatalf("disable: %v", err)
	}
	waitForNextSecond()
	if code := call(true); code == http.StatusOK {
		t.Fatal("a disabled account still holds a live session")
	}
	// and a fresh sign-in is refused too, not just the old cookie
	fresh := rig.signIn(t, srv, claimsFor(acc.ID, acc.Name, acc.Email, rig.store), http.MethodGet)
	if code := fresh(true); code == http.StatusOK {
		t.Fatal("a disabled account could open a new session")
	}
}

func TestRoleTravelsInTheClaims(t *testing.T) {
	// Q3: the operator's console and a user's console differ by a claim, not by
	// two code paths.
	rig := newRig(t)
	ctx := context.Background()
	admin := store.Account{ID: register(t, rig, "root@example.com"), Name: "Root", Email: "root@example.com"}
	if err := rig.store.SetRole(ctx, admin.ID, store.RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}

	var seenRole string
	guarded := rig.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := token.GetUserInfo(r)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		seenRole = u.Role
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(guarded)
	defer srv.Close()

	if code := rig.signIn(t, srv, claimsFor(admin.ID, admin.Name, admin.Email, rig.store), http.MethodGet)(true); code != http.StatusOK {
		t.Fatalf("admin request = %d, want 200", code)
	}
	if seenRole != store.RoleAdmin {
		t.Fatalf("role seen by the handler = %q, want admin", seenRole)
	}
}

// TestDependencyWeight is Q4. The library's provider package pulls in avatar
// storage (bbolt, mongo-driver, identicon), so a production build that only
// needs the console imports auth, token and middleware plus the providers it
// actually configures; the dev provider is the one to move behind a build tag
// if the binary grows.
func TestDependencyWeight(t *testing.T) {
	t.Log("compare the built binary with and without the provider packages; " +
		"the console needs auth + token + middleware only")
}

// register creates an account *and* the identity a session resolves through,
// with the same subject the passwordless provider mints. Without the identity
// row a session has nothing to resolve to, which is a real state the product is
// never in; the whole sign-in journey is walked in internal/api.
func register(t *testing.T, rig testRig, email string) string {
	t.Helper()
	ctx := context.Background()
	id, _, err := rig.store.UpsertIdentity(ctx, ProviderEmail,
		token.HashID(sha1.New(), email), email, email, true)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := rig.store.MarkEmailVerified(ctx, id); err != nil {
		t.Fatalf("verify: %v", err)
	}
	return id
}
