package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/auth"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
	"github.com/liyu1981/tabverse/server/internal/webui"
)

type ctxKey int

const (
	ctxKeyUser ctxKey = iota
	ctxKeyDevice
)

// Server wires the HTTP surface of tabversed.
type Server struct {
	cfg    config.Config
	store  *store.Store
	hub    *hub.Hub
	logger *slog.Logger
	// accounts is the console's account layer. It is never nil: accounts are
	// unconditional as of adr/0013, and building it here rather than by the
	// caller means there is no "console without accounts" state to get wrong -
	// which is exactly the state that used to exist, and the one that had to be
	// checked in every middleware.
	accounts *accounts.Service
	// signinThrottle bounds the one endpoint a stranger can reach that has an
	// effect in the world: asking for a sign-in link creates an account and
	// sends mail. Two limits, because either one alone is half the answer - a
	// per-address cap stops one mailbox being bombed, a per-IP cap stops one
	// script walking a list of addresses (ADR 0021).
	signinByAddress *throttle
	signinByIP      *throttle
}

// New builds the server, account layer included. It can fail, because the
// account layer resolves its signing secret and that touches the database.
func New(cfg config.Config, st *store.Store, h *hub.Hub, logger *slog.Logger) (*Server, error) {
	if logger == nil {
		logger = slog.Default()
	}
	svc, err := accounts.New(cfg, st, logger)
	if err != nil {
		return nil, fmt.Errorf("account layer: %w", err)
	}
	return &Server{
		cfg: cfg, store: st, hub: h, logger: logger, accounts: svc,
		signinByAddress: newThrottle(5, time.Hour),
		signinByIP:      newThrottle(20, time.Hour),
	}, nil
}

// The cookie and header names the console's JavaScript needs. They are exported
// by the accounts package rather than duplicated here, because a mismatch shows
// up as a 401 on every request and nothing else.
const (
	accountsSessionCookie = "tv_session"
	accountsCSRFHeader    = "X-XSRF-Token"
)

// Handler builds the route table. Route patterns use the Go 1.22+ method
// aware syntax on purpose: no router dependency, no magic.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealth)

	mux.HandleFunc("POST /api/v1/auth/bootstrap", s.handleBootstrap)
	mux.HandleFunc("POST /api/v1/auth/pair", s.handlePair)
	mux.HandleFunc("POST /api/v1/auth/invites", s.auth(s.handleCreateInvite))

	mux.HandleFunc("GET /api/v1/sync", s.auth(s.handlePull))
	mux.HandleFunc("POST /api/v1/sync", s.auth(s.handlePush))
	mux.HandleFunc("GET /api/v1/entities/{entity}/{id}", s.auth(s.handleGetEntity))
	mux.HandleFunc("DELETE /api/v1/entities/{entity}/{id}", s.auth(s.handleDeleteEntity))
	mux.HandleFunc("GET /api/v1/search", s.auth(s.handleSearch))

	// WebSocket upgrade does its own auth (browsers cannot set headers on
	// a WebSocket handshake, so a query parameter is also accepted).
	mux.HandleFunc("GET /api/v1/sync/stream", s.handleStream)

	// Admin API: the operator surface behind the console (adr/0009). Every
	// route answers 404 while TABVERSED_ADMIN_TOKEN is unset, so a personal
	// deployment has no admin attack surface at all.
	admin := func(h http.HandlerFunc) http.HandlerFunc { return s.admin(h) }
	mux.HandleFunc("GET /api/v1/admin/config", s.handleAdminConfig) // unauthenticated: tells the console whether to ask for a token
	mux.HandleFunc("GET /api/v1/admin/totals", s.adminOnly(s.handleAdminTotals))
	mux.HandleFunc("GET /api/v1/admin/users", s.adminOnly(s.handleAdminListUsers))
	// There is no POST /api/v1/admin/users: registration is the only way an
	// account is created (ADR 0014).
	mux.HandleFunc("GET /api/v1/admin/users/{user_id}", admin(s.handleAdminGetUser))
	mux.HandleFunc("PUT /api/v1/admin/users/{user_id}", admin(s.handleAdminRenameUser))
	mux.HandleFunc("PUT /api/v1/admin/users/{user_id}/role", s.adminOnly(s.handleAdminSetRole))
	mux.HandleFunc("DELETE /api/v1/admin/users/{user_id}", admin(s.handleAdminDeleteUser))
	mux.HandleFunc("POST /api/v1/admin/users/{user_id}/invites", admin(s.handleAdminCreateInvite))
	mux.HandleFunc("DELETE /api/v1/admin/users/{user_id}/devices/{device_id}", admin(s.handleAdminRevokeDevice))
	mux.HandleFunc("DELETE /api/v1/admin/users/{user_id}/tokens/{hash}", admin(s.handleAdminRevokeToken))
	// archiving a dead credential and the records it last wrote (adr/0011).
	// Reversible, and never a delete: those rows keep syncing to the user's
	// devices, they only stop showing up in the console's default views.
	mux.HandleFunc("PUT /api/v1/admin/users/{user_id}/tokens/{hash}/archive", admin(s.handleAdminArchiveToken))
	mux.HandleFunc("DELETE /api/v1/admin/users/{user_id}/tokens/{hash}/archive", admin(s.handleAdminUnarchiveToken))
	mux.HandleFunc("PUT /api/v1/admin/users/{user_id}/devices/{device_id}/archive", admin(s.handleAdminArchiveDevice))
	mux.HandleFunc("DELETE /api/v1/admin/users/{user_id}/devices/{device_id}/archive", admin(s.handleAdminUnarchiveDevice))
	mux.HandleFunc("PUT /api/v1/admin/users/{user_id}/devices/{device_id}/records/archive", admin(s.handleAdminArchiveDeviceRecords))
	mux.HandleFunc("DELETE /api/v1/admin/users/{user_id}/devices/{device_id}/records/archive", admin(s.handleAdminUnarchiveDeviceRecords))
	// read only data browsing
	mux.HandleFunc("GET /api/v1/admin/users/{user_id}/tabspaces", admin(s.handleAdminListTabspaces))
	mux.HandleFunc("GET /api/v1/admin/users/{user_id}/tabspaces/{tabspace_id}", admin(s.handleAdminGetTabspace))
	// ...and the one write over user data: a delete, which tombstones the
	// tabverse and its records so the devices learn about it too (adr/0015).
	mux.HandleFunc("DELETE /api/v1/admin/users/{user_id}/tabspaces/{tabspace_id}", admin(s.handleAdminDeleteTabspace))
	mux.HandleFunc("GET /api/v1/admin/users/{user_id}/records", admin(s.handleAdminListRecords))
	mux.HandleFunc("GET /api/v1/admin/users/{user_id}/search", admin(s.handleAdminSearch))

	// The library's login routes, mounted where the console expects them.
	{
		mux.Handle("/auth/", http.StripPrefix("/auth", s.accounts.Handlers()))
		// The soft guard, because these two are what the page calls before it
		// knows whether anyone is signed in.
		mux.Handle("GET /api/v1/console/me", s.accounts.Trace(http.HandlerFunc(s.handleConsoleMe)))
		mux.Handle("POST /api/v1/console/signout", s.accounts.Trace(http.HandlerFunc(s.handleConsoleSignOut)))
		mux.Handle("GET /api/v1/console/impersonation", s.accounts.Trace(http.HandlerFunc(s.handleConsoleImpersonation)))
		mux.Handle("POST /api/v1/console/impersonate/stop", s.accounts.Trace(http.HandlerFunc(s.handleConsoleImpersonateStop)))
		// The sign-in form posts here rather than straight to the library, so
		// the account exists before the link that claims it.
		mux.HandleFunc("POST /api/v1/console/signin-link", s.handleConsoleSigninLink)
		// "Sign out everywhere" (ADR 0021). Ending the account's own console
		// sessions is a session action, so it sits with the session routes and
		// not with the operator ones; the same call for somebody else's account
		// is an operator action, below.
		mux.HandleFunc("POST /api/v1/console/revoke-sessions", s.admin(s.handleConsoleRevokeSessions))
		mux.HandleFunc("PUT /api/v1/admin/users/{user_id}/revoke-sessions",
			s.adminOnly(s.handleAdminRevokeSessions))
		// Pairing a browser extension from the console's own page (the official
		// server wizard, adr/0020). It takes the console credential - a session
		// for one's own account - and nothing else: no invite, no operator. The
		// token it returns is handed to the extension over the
		// externally_connectable channel, which is why the page is the one that
		// has to be signed in rather than the code having to be carried.
		mux.HandleFunc("POST /api/v1/console/pair", s.admin(s.handleConsolePair))
		// Starting an assumed identity is an operator action, so it goes
		// through the same gate as the operator views.
		mux.Handle("POST /api/v1/admin/users/{user_id}/impersonate",
			s.adminOnly(http.HandlerFunc(s.handleConsoleImpersonateStart).ServeHTTP))
	}

	// The console itself: embedded static files. The page is public (a login
	// screen has to be loadable to exist) and every API call it makes is
	// authorized by a session or the admin token.
	mux.Handle("/", webui.Handler())

	return withCORS(withHSTS(mux, s.cfg.SecureCookies))
}

// ---- middleware -----------------------------------------------------------

// auth authenticates a request through its bearer token.
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := s.extractToken(r)
		if !ok {
			writeErr(w, http.StatusUnauthorized, "missing_token", "provide Authorization: Bearer <token>")
			return
		}
		hash := auth.HashToken(token)
		userID, deviceID, err := s.store.LookupToken(r.Context(), hash)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, http.StatusUnauthorized, "invalid_token", "token unknown or revoked")
				return
			}
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		// Record device activity for the console. Best effort: a failed
		// telemetry write must not fail a request that is already authorized.
		if err := s.store.TouchToken(r.Context(), hash); err != nil {
			s.logger.Debug("token touch failed", "err", err)
		}
		ctx := r.Context()
		ctx = contextWith(ctx, ctxKeyUser, userID)
		ctx = contextWith(ctx, ctxKeyDevice, deviceID)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) extractToken(r *http.Request) (string, bool) {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer ")), true
	}
	if q := r.URL.Query().Get("access_token"); q != "" {
		return q, true
	}
	return "", false
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withHSTS tells the browser to insist on https for this host for a year.
//
// Only when the session cookie is Secure, i.e. when the deployment already
// decided it is served over https: a browser ignores the header on a plain http
// response, and sending it from a plain http deployment would be a claim this
// server cannot make. includeSubDomains is left off deliberately - the console
// may share a domain with things that are not ours (ADR 0021).
func withHSTS(next http.Handler, secure bool) http.Handler {
	if !secure {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		next.ServeHTTP(w, r)
	})
}

// ---- helpers --------------------------------------------------------------

// handleHealth is an unauthenticated liveness probe.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": s.cfg.Version,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

// writeStoreErr maps store errors onto HTTP responses.
func writeStoreErr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return errors.New("invalid JSON body")
	}
	return nil
}

func newID(prefix string) string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(raw)
}
