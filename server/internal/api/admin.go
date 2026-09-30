package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strconv"
	"strings"

	"github.com/liyu1981/tabverse/server/internal/auth"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// The admin API is the server side operator surface behind the web console
// (adr/0009). It is the only way to make the deployment multi tenant: an
// operator creates accounts here, mints their pairing codes, and can revoke a
// device or token that leaked.
//
// It is read only for user *data* on purpose. The console browses what is
// stored; editing records from outside the extension would fight the LWW
// protocol (a record written here carries no device, and the next sync from
// the real device would win on a clock this process does not have).

// admin is the admin-token middleware. Unlike auth() it resolves no user: an
// admin is not a device, it is the operator of the deployment, and every
// handler below takes the account it acts on explicitly.
//
// Unlike extractToken() it only reads the Authorization header. The
// ?access_token= form exists for the WebSocket handshake, where browsers
// cannot set headers; an admin token is typed into a form, so there is no
// reason to also accept it in a URL, where it would end up in access logs.
func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.cfg.AdminEnabled() {
			writeErr(w, http.StatusNotFound, "admin_disabled",
				"the admin API is disabled: set TABVERSED_ADMIN_TOKEN to enable it")
			return
		}
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing_token",
				"provide Authorization: Bearer <admin token>")
			return
		}
		if !adminTokenMatches(s.cfg.AdminToken, strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))) {
			writeErr(w, http.StatusUnauthorized, "invalid_token", "not the admin token")
			return
		}
		next(w, r)
	}
}

// adminTokenMatches compares in constant time over the SHA-256 of both sides,
// so the comparison is not length-or-content dependent.
func adminTokenMatches(configured, presented string) bool {
	want := sha256.Sum256([]byte(configured))
	got := sha256.Sum256([]byte(presented))
	return subtle.ConstantTimeCompare(want[:], got[:]) == 1
}

// ---- deployment -----------------------------------------------------------

// handleAdminConfig tells the console what the deployment allows before it
// asks for a token: whether the admin API is on at all, and which version is
// running. It is unauthenticated on purpose, and reveals nothing an attacker
// could not learn from the fact that the port answers.
func (s *Server) handleAdminConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"admin_enabled": s.cfg.AdminEnabled(),
		"version":       s.cfg.Version,
	})
}

// handleAdminTotals returns the deployment wide counters for the header.
func (s *Server) handleAdminTotals(w http.ResponseWriter, r *http.Request) {
	totals, err := s.store.Totals(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, totals)
}

// ---- accounts -------------------------------------------------------------

// handleAdminListUsers lists every account with its counters.
func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

// handleAdminCreateUser creates an account. This is the multi tenant entry
// point: with an admin token a deployment can hold any number of accounts, and
// they are isolated from each other by user_id exactly like devices are.
func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		// DeviceName is used when the operator asks for a device right away
		// (the console does, for the "add a device" flow); empty means "just
		// create the account".
		DeviceName string `json:"device_name"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "unnamed"
	}
	if len(name) > 120 {
		writeErr(w, http.StatusBadRequest, "bad_request", "name is too long")
		return
	}
	user, err := s.store.CreateUser(r.Context(), newID("usr_"), name)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if req.DeviceName != "" {
		// The operator is holding a token for a device they are about to hand
		// over, same shape as the bootstrap response.
		s.writeDevice(w, r, user.ID, req.DeviceName)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}

// handleAdminGetUser is the console's account page: the account, its stats,
// its devices and its tokens in one response.
func (s *Server) handleAdminGetUser(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	ctx := r.Context()
	if err := s.store.RequireUser(ctx, userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	user, err := s.store.GetUser(ctx, userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	stats, err := s.store.UserStats(ctx, userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	devices, err := s.store.ListDevices(ctx, userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	tokens, err := s.store.ListTokens(ctx, userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":    user,
		"stats":   stats,
		"devices": devices,
		"tokens":  tokens,
	})
}

// handleAdminRenameUser changes the account's display name. Data is untouched.
func (s *Server) handleAdminRenameUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "name must not be empty")
		return
	}
	if err := s.store.RenameUser(r.Context(), r.PathValue("user_id"), name); err != nil {
		writeStoreErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminDeleteUser removes the account and all of its records, devices
// and tokens. The console asks for a typed confirmation; the server does not
// implement a trash, so a mistake here is only recoverable from a backup.
func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	ctx := r.Context()
	user, err := s.store.GetUser(ctx, userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if err := s.store.DeleteUser(ctx, userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	s.logger.Info("admin deleted user", "user", userID, "name", user.Name)
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminCreateInvite mints a pairing code for a *specific* account, so an
// operator can add a device to an account they did not create. A device token
// is a bearer credential for that account's data, so this is the endpoint the
// admin token guards most tightly.
func (s *Server) handleAdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	var req struct {
		TTLSeconds int `json:"ttl_seconds"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	if req.TTLSeconds == 0 {
		req.TTLSeconds = 900
	}
	if req.TTLSeconds < 60 || req.TTLSeconds > 86400 {
		writeErr(w, http.StatusBadRequest, "bad_request", "ttl_seconds must be within [60, 86400]")
		return
	}
	ctx := r.Context()
	if err := s.store.RequireUser(ctx, userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	display, normalized := auth.NewInviteCode()
	expires, err := s.store.CreateInvite(ctx, auth.HashToken(normalized), userID,
		int64(req.TTLSeconds)*1000)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user_id":    userID,
		"code":       display,
		"expires_at": expires,
	})
}

// handleAdminRevokeToken marks one token unusable. The raw token is not known
// to the server, so the console sends the stored hash it listed earlier.
func (s *Server) handleAdminRevokeToken(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	hash := r.PathValue("hash")
	if err := s.store.RevokeToken(r.Context(), userID, hash); err != nil {
		writeStoreErr(w, err)
		return
	}
	s.logger.Info("admin revoked token", "user", userID, "fingerprint", hash[:min(len(hash), 8)])
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminRevokeDevice revokes every live token of one device.
func (s *Server) handleAdminRevokeDevice(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	deviceID := r.PathValue("device_id")
	n, err := s.store.RevokeDevice(r.Context(), userID, deviceID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	s.logger.Info("admin revoked device", "user", userID, "device", deviceID, "tokens", n)
	w.WriteHeader(http.StatusNoContent)
}

// ---- data browsing (read only) -------------------------------------------

// handleAdminListTabspaces is the tabverse list: one row per saved tabverse
// with its counts, newest first.
func (s *Server) handleAdminListTabspaces(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	ctx := r.Context()
	if err := s.store.RequireUser(ctx, userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	limit, offset := paging(r)
	tabspaces, total, err := s.store.ListTabspaces(ctx, userID,
		r.URL.Query().Get("q"), limit, offset)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tabspaces": tabspaces,
		"total":     total,
		"limit":     limit,
		"offset":    offset,
	})
}

// handleAdminGetTabspace is the read only detail view of one tabverse: tabs in
// the stored order, plus the notes, todos, bookmarks and closed tabs that hang
// off it, ordered by the client's own aggregates.
func (s *Server) handleAdminGetTabspace(w http.ResponseWriter, r *http.Request) {
	bundle, err := s.store.GetTabspaceBundle(r.Context(),
		r.PathValue("user_id"), r.PathValue("tabspace_id"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, bundle)
}

// handleAdminListRecords is the raw record browser: any entity, optionally
// filtered to one tabverse, with a substring search over the payload. It is
// the escape hatch for a record the rendered views cannot make sense of.
func (s *Server) handleAdminListRecords(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	ctx := r.Context()
	if err := s.store.RequireUser(ctx, userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	limit, offset := paging(r)
	includeDeleted := false
	switch strings.ToLower(r.URL.Query().Get("deleted")) {
	case "1", "true", "yes":
		includeDeleted = true
	}
	records, total, err := s.store.ListRecords(ctx, userID, store.RecordFilter{
		Entity:         r.URL.Query().Get("entity"),
		TabspaceID:     r.URL.Query().Get("tabspace_id"),
		Query:          r.URL.Query().Get("q"),
		IncludeDeleted: includeDeleted,
		Limit:          limit,
		Offset:         offset,
	})
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"records": records,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// handleAdminSearch is the console's account wide search. Same FTS index the
// extension queries, scoped to one account, with the display title filled in
// so the hits can be listed.
func (s *Server) handleAdminSearch(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	q := r.URL.Query().Get("q")
	if strings.TrimSpace(q) == "" {
		writeJSON(w, http.StatusOK, map[string]any{"query": q, "hits": []store.AdminSearchHit{}})
		return
	}
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = s.cfg.SearchLimit
	}
	hits, err := s.store.SearchFor(r.Context(), userID, q, r.URL.Query().Get("entity"), limit)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if hits == nil {
		hits = []store.AdminSearchHit{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"query": q, "hits": hits})
}

// paging reads the shared limit/offset parameters, clamped to something a
// browser can render.
func paging(r *http.Request) (limit, offset int) {
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset, err = strconv.Atoi(r.URL.Query().Get("offset"))
	if err != nil || offset < 0 {
		offset = 0
	}
	return limit, offset
}
