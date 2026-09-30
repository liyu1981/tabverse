package accounts

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
}

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

	s := &Service{store: st, cfg: cfg, log: logger}

	svc := auth.NewService(auth.Opts{
		SecretReader:  token.SecretFunc(func(string) (string, error) { return secret, nil }),
		TokenDuration: 12 * time.Hour,
		// The cookie outlives the token so a refresh does not interrupt the user;
		// the window is bounded by the revocation cut-off, not by this.
		CookieDuration: 30 * 24 * time.Hour,
		Issuer:         "tabversed",
		URL:            publicURL,
		SecureCookies:  cfg.SecureCookies,
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
		AvatarStore:          avatar.NewNoOp(),
		UseGravatar:          false,
		ClaimsUpd:            token.ClaimsUpdFunc(s.claimRoles),
		Validator:            token.ValidatorFunc(s.validate),
		AllowedRedirectHosts: token.AllowedHostsFunc(func() ([]string, error) { return nil, nil }),
		Logger:               loggerAdapter{logger},
	})

	s.auth = svc
	// Passwordless email: the person is sent a link, the link signs them in.
	// No password to choose, forget, reuse or leak, and the library already
	// treats the address as proven because it owns the send.
	mail := newSender(cfg, logger, publicURL)
	svc.AddVerifProvider(ProviderEmail, "", provider.SenderFunc(mail.Send))
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
	userID, _, err := s.store.UpsertIdentity(ctx, s.providerOf(u.ID), u.ID, u.Email, u.Name, s.cfg.LinkByEmail)
	if err != nil {
		// A login we cannot place is a login we do not attribute to anybody. The
		// guard will refuse it, and the console shows the sign-in error.
		u.ID = ""
		u.Email = ""
		return u
	}
	u.ID = userID
	acc, err := s.store.AccountByID(ctx, userID)
	switch {
	case err != nil:
		u.ID = ""
	case s.cfg.RequireEmailVerification && acc.EmailVerifiedAt == nil && s.providerOf(u.ID) == ProviderEmail:
		// An address the server has not proven yet cannot sign in. The
		// passwordless flow proves it every time, so this only bites an account
		// an operator created by hand.
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

// Middleware exposes the authenticator for callers that need the raw library
// surface (signing a session in a test, reading claims). Route handlers should
// use Guard, which composes the two middlewares in the right order.
func (s *Service) Middleware() middleware.Authenticator { return s.mw }

// Assume mints a short-lived, read-only identity for an operator looking at
// somebody else's account, in its own cookie so the operator's own session
// survives and "stop" is possible.
//
// The token is signed by the same secret and carries the assumed account, so it
// is a real session rather than a server-side flag: if the cookie is lost, the
// assumed identity is lost with it, which is the right failure direction.
func (s *Service) Assume(w http.ResponseWriter, accountID, actorID string, until time.Time) error {
	now := time.Now()
	claims := token.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "assume-" + accountID,
			Audience:  jwt.ClaimStrings{testAudienceForClaims},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(until),
		},
		User: &token.User{
			ID:       ProviderEmail + "_" + accountID,
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
			Secure:   s.cfg.SecureCookies,
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
	accountID, err := ResolveAccountID(context.Background(), s.store, claims.User.ID)
	if err != nil {
		return "", err
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
