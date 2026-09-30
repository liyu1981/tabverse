package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
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
// Two credentials reach the console API, and neither is a password in a URL:
//
//   - a session cookie, from a signed-in account (adr/0012). This is the way a
//     person uses the console.
//   - TABVERSED_ADMIN_TOKEN as a bearer header, which stays as the break-glass
//     path: a locked-out deployment can still reach its own data.
//
// A session is scoped to the account that owns it. The admin token is not
// scoped at all, which is exactly why it is for operators and nothing else.
func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return s.consoleCredential(next, false)
}

// consoleCredential resolves the caller's credential once and then hands over.
//
// The session is resolved by the library's *soft* guard first, which puts the
// signed-in account in the request context when the session is valid and lets
// the request through untouched when it is not. That is what lets one route
// accept either credential: after the soft guard, a valid session is visible in
// the context, and anything else falls through to the admin token. A hard guard
// here would write its own 401 and never reach the break-glass path.
func (s *Server) consoleCredential(next http.HandlerFunc, operatorOnly bool) http.HandlerFunc {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// An assumed identity replaces the session's account for this request,
		// and only for reads: the operator is looking through somebody else's
		// console, and every mutating route is refused.
		if assumed := s.assumedAccountID(r); assumed != "" {
			if actor, err := s.accounts.AssumedActor(r); err == nil && actor != "" {
				r = withAssume(r, actor, s.assumeDeadline(r))
			}
			if s.refuseIfAssumedAndMutating(w, r) {
				return
			}
			if s.adminTokenValid(r) || s.signedIn(r) {
				next(w, r)
				return
			}
			s.refuse(w, r)
			return
		}
		// A signed-in person may act on their own account, so a session is
		// enough to be here; resolveScope decides which account.
		if s.signedIn(r) && (!operatorOnly || s.isOperator(r)) {
			next(w, r)
			return
		}
		if s.adminTokenValid(r) {
			next(w, r)
			return
		}
		s.refuse(w, r)
	})
	if !s.accountsAllowed() {
		return handler
	}
	return func(w http.ResponseWriter, r *http.Request) {
		s.accounts.Trace(handler).ServeHTTP(w, r)
	}
}

// refuse explains why a request did not carry a usable credential. The three
// answers are deliberately different, because they need different fixes:
// nothing configured at all (404, the operator has a setup problem), no
// credential (401, sign in), and a credential that is real but not an operator
// (403, this view is not for you).
func (s *Server) refuse(w http.ResponseWriter, r *http.Request) {
	signedIn := s.accountsAllowed() && s.hasSession(r)
	if !s.cfg.AdminEnabled() && !signedIn {
		writeErr(w, http.StatusNotFound, "admin_disabled",
			"the console API is disabled: set TABVERSED_ADMIN_TOKEN, or TABVERSED_AUTH=accounts to let people sign in")
		return
	}
	if signedIn {
		writeErr(w, http.StatusForbidden, "forbidden",
			"this view is for operator accounts")
		return
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		writeErr(w, http.StatusUnauthorized, "missing_token",
			"sign in, or provide Authorization: Bearer <admin token>")
		return
	}
	if !adminTokenMatches(s.cfg.AdminToken, strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))) {
		writeErr(w, http.StatusUnauthorized, "invalid_token", "not the admin token")
		return
	}
	// Only reachable if the token matched, which the callers already handled.
	writeErr(w, http.StatusUnauthorized, "invalid_token", "not accepted")
}

// adminOnly is admin plus the operator role: the user query interface and the
// account list. A plain user's session stops here.
func (s *Server) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return s.consoleCredential(next, true)
}

// signedIn reports whether the request carries a session that resolved to an
// account. The soft guard has already run by the time this is called, so the
// answer is "is the user in the context", not "is there a cookie".
func (s *Server) signedIn(r *http.Request) bool {
	if s.accounts == nil {
		return false
	}
	_, err := s.accounts.AccountFromRequest(r)
	return err == nil
}

func (s *Server) isOperator(r *http.Request) bool {
	return s.accounts != nil && s.accounts.IsAdminRequest(r)
}

func (s *Server) adminTokenValid(r *http.Request) bool {
	if !s.cfg.AdminEnabled() {
		return false
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return false
	}
	return adminTokenMatches(s.cfg.AdminToken, strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
}

// accountsAllowed reports whether the account layer is switched on.
func (s *Server) accountsAllowed() bool { return s.accounts != nil }

// hasSession reports whether the request carries a session cookie at all. The
// presence of a cookie is not proof of a valid one, so this only decides which
// refusal to send; validity is settled by signedIn.
func (s *Server) hasSession(r *http.Request) bool {
	if s.accounts == nil {
		return false
	}
	if c, err := r.Cookie(accountsSessionCookie); err == nil && c.Value != "" {
		return true
	}
	return r.Header.Get(accountsCSRFHeader) != ""
}

// resolveScope answers the only question the console handlers need: which
// account is this request about?
//
//   - an operator may name any account
//   - a signed-in person may only name their own
//   - the break-glass admin token may name any
//
// A person-signed request with somebody else's id is a 403, not a silent
// rewrite: quietly serving the caller's own data would make a broken console
// look like it works.
func (s *Server) resolveScope(w http.ResponseWriter, r *http.Request, requested string) (string, bool) {
	// An assumed identity is the subject: the operator asked to see *this*
	// account, so the account they named is the one every route should act on.
	if assumed := s.assumedAccountID(r); assumed != "" {
		if requested == "" || requested == assumed {
			return assumed, true
		}
		writeErr(w, http.StatusBadRequest, "impersonating",
			"you are looking at another account; stop impersonating to act on this one")
		return "", false
	}
	if s.adminTokenValid(r) {
		return requested, true
	}
	own := ""
	if s.accounts != nil {
		if acc, err := s.accounts.AccountFromRequest(r); err == nil {
			own = acc.ID
		}
	}
	if own == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "sign in to continue")
		return "", false
	}
	if requested == "" || requested == own {
		return own, true
	}
	if s.accounts != nil && s.accounts.IsAdminRequest(r) {
		return requested, true
	}
	writeErr(w, http.StatusForbidden, "forbidden",
		"this account is not yours")
	return "", false
}

// discardRecorder is a ResponseWriter that records only whether the guard let
// the request through, for sessionAllowed's probe.
type discardRecorder struct {
	header  http.Header
	allowed bool
	code    int
}

func newDiscardRecorder() *discardRecorder {
	return &discardRecorder{header: http.Header{}}
}

func (d *discardRecorder) Header() http.Header         { return d.header }
func (d *discardRecorder) Write(b []byte) (int, error) { return len(b), nil }
func (d *discardRecorder) WriteHeader(code int)        { d.code = code }

// actorOf names the account behind the current session, for the audit log. The
// break-glass token has no account, so it is recorded empty rather than faked:
// "the admin token did this" is a different - and more interesting - fact than
// any account id.
func (s *Server) actorOf(r *http.Request) string {
	if s.accounts != nil {
		if acc, err := s.accounts.AccountFromRequest(r); err == nil {
			return acc.ID
		}
	}
	return ""
}

// adminTokenMatches compares in constant time over the SHA-256 of both sides,
// so the comparison does not leak the token through timing.
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

// handleAdminListUsers lists every account with its counters. Operator-only
// (routed through adminOnly): a person signing in sees their own account and
// nothing else, so the user query interface is the operator's.
func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

// handleAdminCreateUser creates an account. Operator-only, because a person
// creates their own by signing in.
// This is the multi tenant entry
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
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
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
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	if err := s.store.RenameUser(r.Context(), userID, name); err != nil {
		writeStoreErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminSetRole promotes or demotes an account. Operator-only, and it
// exists because there has to be a way to *make* the first operator: the
// bootstrap admin token is not an account, so without this nobody would ever be
// able to see the user query interface.
func (s *Server) handleAdminSetRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if err := s.store.SetRole(r.Context(), userID, req.Role); err != nil {
		// SetRole refuses to demote the last admin; that is a conflict, not a
		// malformed request.
		if strings.Contains(err.Error(), "last admin") {
			writeErr(w, http.StatusConflict, "last_admin", err.Error())
			return
		}
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditRoleChanged,
		IP: clientIP(r), Detail: req.Role,
	})
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminDeleteUser removes the account and all of its records, devices
// and tokens. The console asks for a typed confirmation; the server does not
// implement a trash, so a mistake here is only recoverable from a backup.
func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	ctx := r.Context()
	// Deleting an account is irreversible, so the request has to carry the id
	// back as a typed confirmation. Without it, a mis-clicked button in a
	// console that is one tab away from the wrong account is unrecoverable.
	if confirm := r.URL.Query().Get("confirm"); confirm != userID {
		writeErr(w, http.StatusBadRequest, "confirmation_required",
			"pass ?confirm="+userID+" to delete this account and everything it stored")
		return
	}
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
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
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
	// Minting a code is how a device gets in, and a person can now do it for
	// themselves, so it is audited with the actor - not just the account.
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor:  s.actorOf(r),
		Target: userID,
		Action: store.AuditPairingCode,
		IP:     clientIP(r),
		Detail: "ttl " + strconv.Itoa(req.TTLSeconds) + "s",
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"user_id":    userID,
		"code":       display,
		"expires_at": expires,
	})
}

// handleAdminRevokeToken marks one token unusable. The raw token is not known
// to the server, so the console sends the stored hash it listed earlier.
func (s *Server) handleAdminRevokeToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	hash := r.PathValue("hash")
	if err := s.store.RevokeToken(r.Context(), userID, hash); err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditTokenRevoked,
		IP: clientIP(r), Detail: "token " + hash[:min(len(hash), 8)],
	})
	s.logger.Info("admin revoked token", "user", userID, "fingerprint", hash[:min(len(hash), 8)])
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminRevokeDevice revokes every live token of one device.
func (s *Server) handleAdminRevokeDevice(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	deviceID := r.PathValue("device_id")
	n, err := s.store.RevokeDevice(r.Context(), userID, deviceID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditDeviceRevoked,
		IP: clientIP(r), Detail: fmt.Sprintf("%s, %d token(s)", deviceID, n),
	})
	s.logger.Info("admin revoked device", "user", userID, "device", deviceID, "tokens", n)
	w.WriteHeader(http.StatusNoContent)
}

// ---- archiving (ADR 0011) -------------------------------------------------
//
// Archiving is how a dead credential is tidied away, never how data is
// removed: the rows keep syncing to the user's devices and can be brought
// back. See adr/0011 for why it cannot be a delete.

// handleAdminArchiveToken retires one revoked token from the console's lists.
func (s *Server) handleAdminArchiveToken(w http.ResponseWriter, r *http.Request) {
	s.archiveToken(w, r, true)
}

// handleAdminUnarchiveToken brings a retired token back into the lists. It
// stays revoked: unarchiving does not re-enable access.
func (s *Server) handleAdminUnarchiveToken(w http.ResponseWriter, r *http.Request) {
	s.archiveToken(w, r, false)
}

func (s *Server) archiveToken(w http.ResponseWriter, r *http.Request, archive bool) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	hash := r.PathValue("hash")
	var outcome store.ArchiveOutcome
	var err error
	if archive {
		outcome, err = s.store.ArchiveToken(r.Context(), userID, hash)
	} else {
		outcome, err = s.store.UnarchiveToken(r.Context(), userID, hash)
	}
	if err != nil {
		writeArchiveErr(w, err)
		return
	}
	s.logArchive("token", userID, hash, archive, outcome)
	writeJSON(w, http.StatusOK, outcome)
}

// handleAdminArchiveDevice retires a revoked, abandoned device.
func (s *Server) handleAdminArchiveDevice(w http.ResponseWriter, r *http.Request) {
	s.archiveDevice(w, r, true)
}

// handleAdminUnarchiveDevice brings a retired device back into the lists.
func (s *Server) handleAdminUnarchiveDevice(w http.ResponseWriter, r *http.Request) {
	s.archiveDevice(w, r, false)
}

func (s *Server) archiveDevice(w http.ResponseWriter, r *http.Request, archive bool) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	deviceID := r.PathValue("device_id")
	var outcome store.ArchiveOutcome
	var err error
	if archive {
		outcome, err = s.store.ArchiveDevice(r.Context(), userID, deviceID, s.cfg.DeviceInactiveDays)
	} else {
		outcome, err = s.store.UnarchiveDevice(r.Context(), userID, deviceID)
	}
	if err != nil {
		writeArchiveErr(w, err)
		return
	}
	s.logArchive("device", userID, deviceID, archive, outcome)
	writeJSON(w, http.StatusOK, outcome)
}

// handleAdminArchiveDeviceRecords hides the records a retired device last
// wrote from the console's default views. They keep syncing to the user's
// devices, and "include archived" brings them back into the console.
func (s *Server) handleAdminArchiveDeviceRecords(w http.ResponseWriter, r *http.Request) {
	s.archiveDeviceRecords(w, r, true)
}

// handleAdminUnarchiveDeviceRecords is the way back.
func (s *Server) handleAdminUnarchiveDeviceRecords(w http.ResponseWriter, r *http.Request) {
	s.archiveDeviceRecords(w, r, false)
}

func (s *Server) archiveDeviceRecords(w http.ResponseWriter, r *http.Request, archive bool) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	deviceID := r.PathValue("device_id")
	var outcome store.ArchiveOutcome
	var err error
	if archive {
		outcome, err = s.store.ArchiveDeviceRecords(r.Context(), userID, deviceID, s.cfg.DeviceInactiveDays)
	} else {
		outcome, err = s.store.UnarchiveDeviceRecords(r.Context(), userID, deviceID)
	}
	if err != nil {
		writeArchiveErr(w, err)
		return
	}
	action := "unarchived"
	if archive {
		action = "archived"
	}
	s.logger.Info("admin archived device records",
		"user", userID, "device", deviceID, "action", action,
		"records", outcome.Archived+outcome.Unarchived)
	writeJSON(w, http.StatusOK, outcome)
}

// writeArchiveErr turns the archive preconditions into HTTP the console can act
// on: 409 with the reason, so the UI can say "revoke it first" rather than
// "something went wrong".
func writeArchiveErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotRevoked):
		writeErr(w, http.StatusConflict, "not_revoked", err.Error())
	case errors.Is(err, store.ErrActive):
		writeErr(w, http.StatusConflict, "still_active", err.Error())
	default:
		writeStoreErr(w, err)
	}
}

func (s *Server) logArchive(kind, userID, subject string, archive bool, outcome store.ArchiveOutcome) {
	action := "unarchived"
	if archive {
		action = "archived"
	}
	s.logger.Info("admin "+action+" "+kind,
		"user", userID, kind, subject,
		"archived", outcome.Archived, "unarchived", outcome.Unarchived)
}

// ---- data browsing (read only) -------------------------------------------

// handleAdminListTabspaces is the tabverse list: one row per saved tabverse
// with its counts, newest first.
func (s *Server) handleAdminListTabspaces(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	ctx := r.Context()
	if err := s.store.RequireUser(ctx, userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	limit, offset := paging(r)
	tabspaces, total, err := s.store.ListTabspaces(ctx, userID,
		r.URL.Query().Get("q"), flag(r, "archived"), limit, offset)
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
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	bundle, err := s.store.GetTabspaceBundle(r.Context(), userID, r.PathValue("tabspace_id"))
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
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
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
		Entity:          r.URL.Query().Get("entity"),
		TabspaceID:      r.URL.Query().Get("tabspace_id"),
		Query:           r.URL.Query().Get("q"),
		IncludeDeleted:  includeDeleted,
		IncludeArchived: flag(r, "archived"),
		Limit:           limit,
		Offset:          offset,
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
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	q := r.URL.Query().Get("q")
	if strings.TrimSpace(q) == "" {
		writeJSON(w, http.StatusOK, map[string]any{"query": q, "hits": []store.AdminSearchHit{}})
		return
	}
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = s.cfg.SearchLimit
	}
	hits, err := s.store.SearchFor(r.Context(), userID, q, r.URL.Query().Get("entity"),
		limit, flag(r, "archived"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if hits == nil {
		hits = []store.AdminSearchHit{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"query": q, "hits": hits})
}

// flag reads a boolean query parameter in the 1/true/yes/on spellings.
func flag(r *http.Request, name string) bool {
	switch strings.ToLower(r.URL.Query().Get(name)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
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
