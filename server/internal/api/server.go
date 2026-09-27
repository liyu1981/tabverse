package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/liyu1981/tabverse/server/internal/auth"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
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
}

func New(cfg config.Config, st *store.Store, h *hub.Hub, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{cfg: cfg, store: st, hub: h, logger: logger}
}

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

	return withCORS(mux)
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
		userID, deviceID, err := s.store.LookupToken(r.Context(), auth.HashToken(token))
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, http.StatusUnauthorized, "invalid_token", "token unknown or revoked")
				return
			}
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
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
