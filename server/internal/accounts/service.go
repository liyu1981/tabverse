package accounts

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"time"

	"github.com/go-pkgz/auth/v2"
	"github.com/go-pkgz/auth/v2/avatar"
	"github.com/go-pkgz/auth/v2/middleware"
	"github.com/go-pkgz/auth/v2/provider"
	"github.com/go-pkgz/auth/v2/token"
	"github.com/golang-jwt/jwt/v5"

	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// ProviderEmail is the name the passwordless email login registers under. It is
// also the prefix the library expects on a claim id, which is why the console's
// user ids arrive as "tabverse_usr_...".
const ProviderEmail = "tabverse"

// sessionCookie / xsrfCookie keep their names stable across restarts so a
// deployment behind a proxy does not lose its cookies when an operator changes
// nothing but the environment.
const (
	sessionCookie = "tv_session"
	xsrfCookie    = "tv_xsrf"
	xsrfHeader    = "X-XSRF-Token"
	// testAudienceForClaims is the single audience every session carries: the
	// library's extractor refuses a user-bearing token whose aud is not exactly
	// one value, and the audience is what it later promotes onto the user.
	testAudienceForClaims = "tabversed"
)

// Service is the console's account layer: the library's service, wired to our
// store, plus the two hooks that make its tokens mean something here.
type Service struct {
	auth  *auth.Service
	store *store.Store
	cfg   config.Config
	log   *slog.Logger
	// mw is the authenticator *value*, configured once. Handlers and guards must
	// share it: it is a struct, and UpdateUser does not install itself, it
	// returns a middleware (see ADR 0012).
	mw middleware.Authenticator
	// authErr surfaces the reason the guard refused a request, for logging. The
	// library's own reporting is a bare 401.
	authErr error
	// sendOverride replaces the mail sender in tests, so the whole sign-in
	// journey - form, link, session - can be walked without an SMTP server.
	sendOverride func(address, text string) error
	// secureCookies is the resolved value: false when the public URL is plain
	// http, because a browser drops a Secure cookie there.
	secureCookies bool
	// publicURL is where the console lives, as configured. The sign-in link and
	// the post-sign-in redirect are both built from it, so a person who follows
	// the link ends up in the console rather than staring at JSON.
	publicURL string
}

// ConsoleURL is the address the console is reached at, as configured.
func (s *Service) ConsoleURL() string { return s.publicURL }

// New builds the account service.
//
// The signing secret is resolved first and is the reason this can be called
// during startup without ceremony: an explicit TABVERSED_AUTH_SECRET wins, and
// otherwise one is generated on first boot and kept in server_secrets, so a
// restart does not sign everybody out and two processes racing to boot agree.
func New(cfg config.Config, st *store.Store, logger *slog.Logger) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	secret, generated, err := signingSecret(cfg, st)
	if err != nil {
		return nil, err
	}
	if generated {
		logger.Warn("generated a session signing key and stored it in the database; " +
			"set TABVERSED_AUTH_SECRET to keep sessions across a database restore")
	}

	publicURL := strings.TrimRight(cfg.PublicURL, "/")
	if publicURL == "" {
		// The links we send have to be absolute; without an explicit public URL
		// the best guess is loopback, which is right for a local install and
		// obviously wrong otherwise - hence the warning.
		publicURL = "http://127.0.0.1:8223"
		logger.Warn("TABVERSED_PUBLIC_URL is not set: account links will point at " +
			publicURL + ", which a remote browser cannot reach")
	}

	// A Secure cookie is dropped by the browser over plain http, which turns a
	// successful sign-in into a redirect that lands on the console still signed
	// out - the most confusing possible failure, and the default on a LAN. So
	// the attribute follows the scheme of the public URL, loudly.
	secureCookies := cfg.SecureCookies
	if strings.HasPrefix(publicURL, "http://") {
		if secureCookies {
			logger.Warn("the console is served over plain http, so session cookies cannot be " +
				"Secure; they will travel in the clear. Put https:// in " +
				"TABVERSED_PUBLIC_URL for anything but a network you trust.")
		}
		secureCookies = false
	}

	// What the provider library is told its own root is: the public console plus
	// the routing path it is mounted under.
	authRoot := strings.TrimSuffix(publicURL, "/") + "/auth"

	s := &Service{store: st, cfg: cfg, log: logger, publicURL: publicURL, secureCookies: secureCookies}

	svc := auth.NewService(auth.Opts{
		SecretReader: token.SecretFunc(func(string) (string, error) { return secret, nil }),
		// The routing path is part of the URL, not of the mount. We serve the
		// library under /auth (server.go strips the prefix before it gets here),
		// and the provider composes its redirect URI as
		// URL + <the request path minus its last segment> + /callback - from the
		// *stripped* path. So the prefix has to be in the URL or the callback
		// comes out as /google/callback instead of /auth/google/callback, and
		// every provider answers redirect_uri_mismatch. (The library's own
		// comment says the same thing: rootURL/{routingPath}/provider/callback.)
		URL:           authRoot,
		TokenDuration: 12 * time.Hour,
		// The cookie outlives the token so a refresh does not interrupt the user;
		// the window is bounded by the revocation cut-off, not by this.
		CookieDuration: 30 * 24 * time.Hour,
		Issuer:         "tabversed",
		SecureCookies:  secureCookies,
		SameSiteCookie: http.SameSiteLaxMode,
		JWTCookieName:  sessionCookie,
		XSRFCookieName: xsrfCookie,
		XSRFHeaderKey:  xsrfHeader,
		// Safe methods do not need the echo; state changing ones do.
		XSRFIgnoreMethods: []string{http.MethodGet, http.MethodHead, http.MethodOptions},
		// Avatars are not used anywhere in the console. avatar.NoOp is what the
		// library documents for that, and it is not the reason the binary grew:
		// the avatar package is imported by the top-level auth package whatever
		// we pass (ADR 0012).
		AvatarStore: avatar.NewNoOp(),
		UseGravatar: false,
		ClaimsUpd:   token.ClaimsUpdFunc(s.claimRoles),
		Validator:   token.ValidatorFunc(s.validate),
		// The post-sign-in redirect is checked against this list by the
		// library. It holds our own host, so the only place a sign-in can send
		// somebody is the console itself - a crafted `?from=` in a link cannot
		// walk a person off to another site after they authenticate.
		AllowedRedirectHosts: token.AllowedHostsFunc(func() ([]string, error) {
			if u, err := url.Parse(publicURL); err == nil && u.Hostname() != "" {
				return []string{u.Hostname()}, nil
			}
			return nil, nil
		}),
		Logger: loggerAdapter{logger},
	})

	s.auth = svc
	// Passwordless email: the person is sent a link, the link signs them in.
	// No password to choose, forget, reuse or leak, and the library already
	// treats the address as proven because it owns the send.
	// The library's default message is a bare JWT, which is not something a
	// person can click. The template is where the sign-in link is built, so it
	// is ours to write - and the 30 minute expiry is the library's, so it
	// belongs in the message.
	mail := newSender(cfg, logger, publicURL)
	svc.AddVerifProvider(ProviderEmail, signInEmailTemplate(publicURL),
		provider.SenderFunc(func(address, text string) error {
			if s.sendOverride != nil {
				return s.sendOverride(address, text)
			}
			return mail.Send(address, text)
		}))
	// The credential checker exists for a future password login and for
	// deployments that want one; with passwordless it is never reached.
	svc.AddDirectProvider("password", provider.CredCheckerFunc(func(string, string) (bool, error) {
		return false, nil
	}))

	// Social logins, only when configured. Each registers under its own name,
	// and the console asks for the list rather than guessing.
	if cfg.GitHubClientID != "" {
		svc.AddProvider("github", cfg.GitHubClientID, cfg.GitHubClientSecret)
	}
	if cfg.GoogleClientID != "" {
		svc.AddProvider("google", cfg.GoogleClientID, cfg.GoogleClientSecret)
	}
	// A self hosted OpenID Connect provider is *not* wired, on purpose: the
	// library's custom provider speaks plain OAuth2 against a bespoke userinfo
	// shape rather than OIDC discovery with id_token validation, and a login
	// button that half-works is worse than none. See config.SocialProviders.
	if cfg.DevMode {
		// The library's fake OAuth server: a login form that lets a developer
		// pick a user, and a non-interactive mode for tests. This is the "easy
		// way to test in dev" the whole library choice turned on.
		svc.AddDevProvider("127.0.0.1", 8084)
	}

	// The authenticator is snapshotted *after* the providers are registered, and
	// it is a value: taking it earlier yields one with an empty provider
	// allow-list, and every request is then refused with "provider is not
	// allowed" - the same shape of mistake as UpdateUser not installing itself.
	s.mw = svc.Middleware()
	s.mw.ErrorHandler = s.onAuthError
	return s, nil
}

// Handlers exposes the library's login routes (mount at /auth/).
func (s *Service) Handlers() http.Handler {
	authHandler, _ := s.auth.Handlers()
	return authHandler
}

// Guard wraps one of our handlers with the session check, the account mapping
// and the XSRF verification, in that order.
func (s *Service) Guard(next http.Handler) http.Handler {
	return s.mw.Auth(s.mw.UpdateUser(middleware.UserUpdFunc(s.updater))(next))
}

// Trace is the soft guard: it resolves the claims when a session is present and
// lets the request through either way. It exists for the two endpoints the
// console calls *before* it knows whether anyone is signed in - /console/me and
// sign out - which must answer "not signed in" rather than refuse.
func (s *Service) Trace(next http.Handler) http.Handler {
	return s.mw.Trace(s.mw.UpdateUser(middleware.UserUpdFunc(s.updater))(next))
}

// GuardAdminOnly is Guard plus the operator role, for the user query interface.
func (s *Service) GuardAdminOnly(next http.Handler) http.Handler {
	return s.mw.AdminOnly(s.mw.Auth(s.mw.UpdateUser(middleware.UserUpdFunc(s.updater))(next)))
}

// SignInHeader is the response header the console reads its XSRF token from. The
// cookie is not HttpOnly on purpose - the page has to echo it - and this makes
// the console's job explicit rather than "parse a cookie with JS".
const SignInHeader = xsrfHeader

// CSRFHeader is the name the console must send back.
func (s *Service) CSRFHeader() string { return xsrfHeader }

// claimRoles fills the role into every claim, so the console branches on a
// claim rather than on a second round trip.
func (s *Service) claimRoles(c token.Claims) token.Claims {
	if c.User == nil {
		return c
	}
	acc, err := s.store.AccountByID(context.Background(), c.User.ID)
	if err != nil {
		c.User.Role = store.RoleUser
		return c
	}
	if acc.Role == "" {
		c.User.Role = store.RoleUser
	} else {
		c.User.Role = acc.Role
	}
	return c
}

// updater rewrites the claim's user id to our account row and attaches the role.
// It runs on every authenticated request, which is why the account lookup is a
// single indexed read and why the mapping lives in one function.
func (s *Service) updater(u token.User) token.User {
	ctx := context.Background()
	// Kept because u.ID is rewritten to our account id below, and the provider
	// prefix - which decides which login this was, and whether the address it
	// implies has been proven - only exists on the claim.
	claimID := u.ID
	// This is where an external login becomes one of our accounts: the subject
	// is looked up, and if the server has never seen it, the account is created
	// now. It runs on the first authenticated request of a new registration and
	// on every request after that.
	userID, known, err := ResolveAccountID(ctx, s.store, claimID)
	if err != nil {
		// A retired subject: the account it belonged to is gone and this
		// session has nothing to attach to.
		u.ID = ""
		u.Email = ""
		return u
	}
	if !known {
		newID, _, err := s.store.UpsertIdentity(ctx, s.providerOf(claimID), claimID, u.Email, u.Name, s.cfg.LinkByEmail)
		if err != nil {
			// A login we cannot place is a login we do not attribute to anybody.
			u.ID = ""
			u.Email = ""
			return u
		}
		userID, known = newID, true
	}
	u.ID = userID
	// The operator bootstrap runs on the way past, so the first person to
	// register with the admin address is the operator from their very first
	// request (adr/0013).
	if _, err := s.promoteIfFirstOperator(ctx, userID, u.Email); err != nil {
		s.log.Warn("operator bootstrap failed", "err", err)
	}
	acc, err := s.store.AccountByID(ctx, userID)
	// The email provider proves the address by the fact that this request
	// carries a session: the only way to have one is to have followed the link
	// that was sent to it. The claim does not even carry the address, so this is
	// the only place the proof exists.
	if err == nil && acc.EmailVerifiedAt == nil && s.cfg.RequireEmailVerification &&
		s.providerOf(claimID) == ProviderEmail {
		if err := s.store.MarkEmailVerified(ctx, userID); err != nil {
			s.log.Warn("cannot record email verification", "err", err)
		} else {
			acc.EmailVerifiedAt = &time.Time{}
			_ = s.store.AppendAudit(ctx, store.AuditEntry{
				Actor: userID, Target: userID, Action: store.AuditEmailVerified,
				Detail: "proved by following the emailed sign-in link",
			})
		}
	}
	switch {
	case err != nil:
		u.ID = ""
	case s.cfg.RequireEmailVerification && acc.EmailVerifiedAt == nil:
		// Still unproven: an account an operator created by hand, or one whose
		// link was never followed.
		u.ID = ""
	case !acc.CanLogin():
		u.ID = ""
	default:
		u.Role = acc.Role
		if u.Role == "" {
			u.Role = store.RoleUser
		}
	}
	return u
}

// validate is the revocation hook: it runs inside the extractor, before the
// claim is rewritten, so it resolves the account itself.
func (s *Service) validate(_ string, c token.Claims) bool {
	if c.User == nil {
		return true
	}
	var issued time.Time
	if c.IssuedAt != nil {
		issued = c.IssuedAt.Time
	}
	return SessionAllowed(context.Background(), s.store, c.User.ID, issued)
}

func (s *Service) providerOf(sessionID string) string {
	if i := strings.IndexByte(sessionID, '_'); i > 0 {
		return sessionID[:i]
	}
	return sessionID
}

// onAuthError records why a request was refused. A custom handler *replaces* the
// library's response, so this one also writes the status: a handler that only
// logs turns every refusal into a 200, which is a genuinely nasty way to lose
// an afternoon (ADR 0012).
func (s *Service) onAuthError(w http.ResponseWriter, r *http.Request, code int, err error) {
	s.authErr = err
	s.log.Debug("session refused", "path", r.URL.Path, "code", code, "err", err)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": "unauthorized", "message": "sign in to continue",
	})
}

// AccountFromRequest returns the account behind the current session, or
// ErrNotFound when there is no session.
func (s *Service) AccountFromRequest(r *http.Request) (store.Account, error) {
	u, err := token.GetUserInfo(r)
	if err != nil || u.ID == "" {
		return store.Account{}, store.ErrNotFound
	}
	return s.store.AccountByID(context.Background(), u.ID)
}

// IsAdminRequest reports whether the session belongs to an operator.
func (s *Service) IsAdminRequest(r *http.Request) bool {
	u, err := token.GetUserInfo(r)
	if err != nil {
		return false
	}
	return u.Role == store.RoleAdmin
}

// LastAuthError is the most recent refusal, for logging and tests.
func (s *Service) LastAuthError() error { return s.authErr }

// firstOf returns the first non-empty claim from an OIDC userinfo response.
func firstOf(data provider.UserData, keys ...string) string {
	for _, k := range keys {
		if v := data.Value(k); v != "" {
			return v
		}
	}
	return ""
}

func signingSecret(cfg config.Config, st *store.Store) (string, bool, error) {
	if cfg.AuthSecret != "" {
		return cfg.AuthSecret, false, nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", false, err
	}
	value, err := st.PutServerSecret(context.Background(), "session_signing_key",
		base64.RawURLEncoding.EncodeToString(raw))
	if err != nil {
		return "", false, err
	}
	return value, value == base64.RawURLEncoding.EncodeToString(raw), nil
}

// signInEmailTemplate is the message the sender delivers. The link points at
// the library's own verify endpoint, which is what turns the token in it into a
// session; the wording says the link is single use and short lived, because both
// are true and neither is obvious.
func signInEmailTemplate(publicURL string) string {
	// The library dispatches on the path *suffix*, so the sign-in link is
	// /auth/<provider>/login - without the /login the handler 404s, and the
	// person gets a link to nothing.
	link := strings.TrimRight(publicURL, "/") + "/auth/" + ProviderEmail + "/login?token={{.Token}}"
	return fmt.Sprintf(`Sign in to Tabverse

Hello {{.User}},

Use this link to sign in to your Tabverse console:

%s

The link works once and expires in 30 minutes. If you did not ask to sign in,
ignore this: nothing has changed.
`, link)
}

// Middleware exposes the authenticator for callers that need the raw library
// surface (signing a session in a test, reading claims). Route handlers should
// use Guard, which composes the two middlewares in the right order.
func (s *Service) Middleware() middleware.Authenticator { return s.mw }

// SetSenderOverride replaces the sign-in mail sender. Test only: it is the only
// way to see the link that a person would have received.
func (s *Service) SetSenderOverride(fn func(address, text string) error) {
	s.sendOverride = fn
}

// Assume mints a short-lived, read-only identity for an operator looking at
// somebody else's account, in its own cookie so the operator's own session
// survives and "stop" is possible.
//
// The token is signed by the same secret and carries the assumed account, so it
// is a real session rather than a server-side flag: if the cookie is lost, the
// assumed identity is lost with it, which is the right failure direction.
func (s *Service) Assume(w http.ResponseWriter, accountID, actorID string, until time.Time) error {
	// The claim has to carry the account's *identity subject*, not its row id: a
	// session id that does not resolve back to the account is a session that
	// does not work, and the resolver goes through the identities table.
	subject, ok, err := s.store.SubjectForAccount(context.Background(), accountID, ProviderEmail)
	if err != nil {
		return err
	}
	if !ok {
		return store.ErrNotFound
	}
	now := time.Now()
	claims := token.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "assume-" + accountID,
			Audience:  jwt.ClaimStrings{testAudienceForClaims},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(until),
		},
		User: &token.User{
			ID:       ProviderEmail + "_" + subject,
			Name:     accountID,
			Audience: testAudienceForClaims,
			Attributes: map[string]any{
				"assumed_by":    actorID,
				"read_only":     true,
				"assumed_until": until.UnixMilli(),
			},
		},
	}
	// Signed through the library's own token service, then re-emitted under a
	// different cookie name: the claims come from the one implementation that
	// knows the secret and the claim shape, and the cookie name is ours.
	rec := httptest.NewRecorder()
	if _, err := s.mw.JWTService.Set(rec, claims); err != nil {
		return err
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name != sessionCookie {
			continue
		}
		assumed := &http.Cookie{
			Name:     assumeCookieName,
			Value:    c.Value,
			Path:     "/",
			HttpOnly: true,
			Secure:   s.secureCookies,
			SameSite: http.SameSiteLaxMode,
			Expires:  until,
			MaxAge:   int(time.Until(until).Seconds()),
		}
		http.SetCookie(w, assumed)
		return nil
	}
	return store.ErrNotFound
}

// assumeCookieName is the cookie an assumed identity travels in.
const assumeCookieName = "tv_assume"

// AssumedAccountID resolves the assumed identity from its cookie, refusing an
// expired or malformed one.
func (s *Service) AssumedAccountID(r *http.Request) (string, error) {
	c, err := r.Cookie(assumeCookieName)
	if err != nil || c.Value == "" {
		return "", store.ErrNotFound
	}
	claims, err := s.mw.JWTService.Parse(c.Value)
	if err != nil || claims.User == nil {
		return "", store.ErrNotFound
	}
	accountID, known, err := ResolveAccountID(context.Background(), s.store, claims.User.ID)
	if err != nil || !known {
		// An assumed identity is minted against an account that exists, so an
		// unknown subject here means the cookie is not ours.
		return "", store.ErrNotFound
	}
	// The cookie's own expiry is enforced by the browser, but a replayed one
	// must not outlive it either.
	if until, ok := claims.User.Attributes["assumed_until"]; ok {
		if ms, ok := until.(float64); ok && time.Now().After(time.UnixMilli(int64(ms))) {
			return "", store.ErrNotFound
		}
	}
	return accountID, nil
}

// AssumedActor reports which operator is behind the assumed identity, so the
// audit log can name them even when the session cookie is a different browser.
func (s *Service) AssumedActor(r *http.Request) (string, error) {
	c, err := r.Cookie(assumeCookieName)
	if err != nil || c.Value == "" {
		return "", store.ErrNotFound
	}
	claims, err := s.mw.JWTService.Parse(c.Value)
	if err != nil {
		return "", store.ErrNotFound
	}
	actor := AssumedFrom(claims)
	if actor == "" {
		return "", store.ErrNotFound
	}
	return actor, nil
}

// AssumedUntil is the expiry the assumed identity was minted with.
func (s *Service) AssumedUntil(r *http.Request) (time.Time, error) {
	c, err := r.Cookie(assumeCookieName)
	if err != nil || c.Value == "" {
		return time.Time{}, store.ErrNotFound
	}
	claims, err := s.mw.JWTService.Parse(c.Value)
	if err != nil {
		return time.Time{}, store.ErrNotFound
	}
	if claims.ExpiresAt != nil {
		return claims.ExpiresAt.Time, nil
	}
	return time.Time{}, store.ErrNotFound
}

// ClearAssume drops the assumed identity cookie.
func (s *Service) ClearAssume(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: assumeCookieName, Value: "", Path: "/", HttpOnly: true,
		MaxAge: -1, SameSite: http.SameSiteLaxMode,
	})
}

// AssumedFrom reports the operator behind an assumed identity.
func AssumedFrom(claims token.Claims) string {
	if claims.User == nil {
		return ""
	}
	v, _ := claims.User.Attributes["assumed_by"].(string)
	return v
}

// SignOut clears the session cookies.
func (s *Service) SignOut(w http.ResponseWriter) {
	s.mw.JWTService.Reset(w)
}

// EnsureAccount makes sure the account behind an email address exists, together
// with the identity row the session will resolve to.
//
// It has to happen *before* the link is sent, and it has to use the same
// subject the library will put in the claim, because a session is checked
// against our accounts before the claim is mapped to one. The passwordless
// provider derives that subject by hashing the address, so the same derivation
// is applied here; the journey test in internal/api walks the whole flow, so a
// change in the library's derivation fails there rather than silently at
// someone's first sign-in.
func (s *Service) EnsureAccount(ctx context.Context, email, name string) (string, error) {
	// Hash exactly the string that was given: the library hashes whatever
	// arrives in the `address` parameter, so normalising it here and not there
	// would derive a different subject, and the first sign-in would create a
	// second account instead of finding this one. The console lowercases the
	// address before sending, so the two always see the same string.
	email = strings.TrimSpace(email)
	if email == "" {
		return "", fmt.Errorf("email is required")
	}
	// The subject alone: the claim is "<provider>_<subject>", and the resolver
	// splits on the first underscore, so storing the prefix here would make the
	// row unmatchable and quietly create a second account on first sign-in.
	subject := token.HashID(sha1.New(), email)
	userID, _, err := s.store.UpsertIdentity(ctx, ProviderEmail, subject, email, name, s.cfg.LinkByEmail)
	return userID, err
}

// IsAdminEmail reports whether an address is the one the operator is expected
// to be. Case and surrounding space are ignored, because a person types their
// own address and gets it subtly wrong.
func (s *Service) IsAdminEmail(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	return email != "" && s.cfg.AdminEmail != "" && email == s.cfg.AdminEmail
}

// promoteIfFirstOperator makes the account an operator when it is the admin
// address and nobody is one yet. It is the whole bootstrap (adr/0013): there is
// no secret to hand out, and once an operator exists the address grants nothing,
// so leaving the variable set cannot become a stale privilege.
//
// Returns whether a promotion happened, so the caller can log and audit it.
func (s *Service) promoteIfFirstOperator(ctx context.Context, userID, email string) (bool, error) {
	// The passwordless provider does not put the address in the claim - it
	// hashes it into the subject - so the account is asked for its own when the
	// claim has none. The account row is the authority on who this is.
	if email == "" {
		acc, err := s.store.AccountByID(ctx, userID)
		if err != nil {
			return false, nil
		}
		email = acc.Email
	}
	if !s.IsAdminEmail(email) {
		return false, nil
	}
	admins, err := s.store.CountAdmins(ctx)
	if err != nil {
		return false, err
	}
	if admins > 0 {
		return false, nil
	}
	if err := s.store.SetRole(ctx, userID, store.RoleAdmin); err != nil {
		return false, err
	}
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: userID, Target: userID, Action: store.AuditRoleChanged,
		Detail: "first operator: registered with TABVERSED_ADMIN_EMAIL",
	})
	s.log.Info("first operator", "user", userID)
	return true, nil
}

// PromoteAdminEmail runs the bootstrap against an account that already exists,
// which is how a deployment that already had accounts gains its operator: set
// the variable and restart.
func (s *Service) PromoteAdminEmail(ctx context.Context) error {
	if s.cfg.AdminEmail == "" {
		return nil
	}
	admins, err := s.store.CountAdmins(ctx)
	if err != nil {
		return err
	}
	if admins > 0 {
		return nil
	}
	acc, err := s.store.AccountByEmail(ctx, s.cfg.AdminEmail)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Not an error: the operator has simply not registered yet, and the
			// startup log already says so.
			return nil
		}
		return err
	}
	promoted, err := s.promoteIfFirstOperator(ctx, acc.ID, acc.Email)
	if err != nil {
		return err
	}
	if promoted {
		s.log.Info("promoted the existing account to operator, because its address is "+
			"TABVERSED_ADMIN_EMAIL", "user", acc.ID, "email", acc.Email)
	}
	return nil
}
