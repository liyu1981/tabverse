package api

import (
	"net/http"
	"time"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// Impersonation (adr/0012 phase 5): an operator can look at an account exactly
// as its owner sees it, to answer "is their data there?" without asking them.
//
// What it deliberately is *not*:
//
//   - not a write path. A record written through an assumed session would carry
//     no device and no trustworthy client clock, so the next honest sync from
//     the real device would win the LWW comparison - and the operator would have
//     silently edited a user's data. Every mutating route answers 403 while a
//     session is assumed.
//   - not a cloak. The assumed identity lives in its own cookie, so the
//     operator's real session is untouched and "stop" is one request.
//   - not silent. Entering and leaving are both audited, the console shows a
//     banner with a countdown, and the window is short.

// assumeTTL is how long one assumed session lasts. Long enough to answer a
// question, short enough that an operator who walks away does not leave a
// window open behind them.
const assumeTTL = 15 * time.Minute

// The context keys ride on the existing ctxKey enum, and the values are kept as
// strings because that is what context.WithValue can hold.
const (
	ctxKeyAssumedFrom  = ctxKey(100)
	ctxKeyAssumedUntil = ctxKey(101)
)

func assumeFrom(r *http.Request) string {
	v, _ := r.Context().Value(ctxKeyAssumedFrom).(string)
	return v
}

func assumeUntil(r *http.Request) time.Time {
	v, _ := r.Context().Value(ctxKeyAssumedUntil).(string)
	if v == "" {
		return time.Time{}
	}
	until, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}
	}
	return until
}

func withAssume(r *http.Request, from string, until time.Time) *http.Request {
	ctx := contextWith(r.Context(), ctxKeyAssumedFrom, from)
	ctx = contextWith(ctx, ctxKeyAssumedUntil, until.Format(time.RFC3339))
	return r.WithContext(ctx)
}

// handleConsoleImpersonateStart assumes an account, read only.
func (s *Server) handleConsoleImpersonateStart(w http.ResponseWriter, r *http.Request) {
	actor, err := s.accounts.AccountFromRequest(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "sign in first")
		return
	}
	target, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	if target == actor.ID {
		writeErr(w, http.StatusBadRequest, "already_you", "this is already your account")
		return
	}
	acc, err := s.store.AccountByID(r.Context(), target)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	// An operator looking at another operator is how a mistake becomes a habit.
	if acc.IsAdmin() {
		_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
			Actor: actor.ID, Target: target, Action: store.AuditImpersonateFail,
			IP: clientIP(r), Detail: "refused: target is an operator",
		})
		writeErr(w, http.StatusForbidden, "cannot_impersonate_admin",
			"an operator cannot look through another operator's account")
		return
	}

	until := time.Now().Add(assumeTTL)
	if err := s.accounts.Assume(w, target, actor.ID, until); err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: actor.ID, Target: target, Action: store.AuditImpersonateIn,
		IP: clientIP(r), Detail: "read only until " + until.Format(time.RFC3339),
	})
	s.logger.Info("impersonation started",
		"actor", actor.ID, "target", target, "until", until)
	writeJSON(w, http.StatusOK, map[string]any{
		"assumed": target, "as": acc.Name, "until": until, "read_only": true,
	})
}

// handleConsoleImpersonateStop drops the assumed identity.
func (s *Server) handleConsoleImpersonateStop(w http.ResponseWriter, r *http.Request) {
	if s.accounts == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	target := s.assumedAccountID(r)
	s.accounts.ClearAssume(w)
	if actor, err := s.accounts.AccountFromRequest(r); err == nil && target != "" {
		_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
			Actor: actor.ID, Target: target, Action: store.AuditImpersonateOut,
			IP: clientIP(r),
		})
		s.logger.Info("impersonation ended", "actor", actor.ID, "target", target)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleConsoleImpersonation reports what the console is currently assuming, so
// the banner can be drawn from the server's answer rather than from what the
// page remembers doing.
func (s *Server) handleConsoleImpersonation(w http.ResponseWriter, r *http.Request) {
	target := s.assumedAccountID(r)
	if target == "" {
		writeJSON(w, http.StatusOK, map[string]any{"assuming": false})
		return
	}
	acc, err := s.store.AccountByID(r.Context(), target)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"assuming": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"assuming":    true,
		"as":          acc.Name,
		"user_id":     acc.ID,
		"as_operator": assumeFrom(r) != "",
		"until":       assumeUntil(r),
		"read_only":   true,
	})
}

// assumedAccountID resolves the assumed identity, or "" when there is none. It
// is the single place that decides whose account a request is about while an
// operator is looking through someone else's.
func (s *Server) assumedAccountID(r *http.Request) string {
	if s.accounts == nil {
		return ""
	}
	id, err := s.accounts.AssumedAccountID(r)
	if err != nil {
		return ""
	}
	return id
}

// assumeDeadline reads the expiry the assumed cookie was minted with, so the
// banner's countdown and the server agree.
func (s *Server) assumeDeadline(r *http.Request) time.Time {
	if until, err := s.accounts.AssumedUntil(r); err == nil {
		return until
	}
	return time.Now().Add(assumeTTL)
}

// isMutation reports whether a request changes anything. The assumed session
// refuses exactly these.
func isMutation(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}

// refuseIfAssumedAndMutating is the read-only guarantee, in one place.
func (s *Server) refuseIfAssumedAndMutating(w http.ResponseWriter, r *http.Request) bool {
	from := assumeFrom(r)
	if from == "" || !isMutation(r) {
		return false
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: from, Target: s.assumedAccountID(r), Action: store.AuditImpersonateFail,
		IP: clientIP(r), Detail: r.Method + " " + r.URL.Path + " refused: read only",
	})
	writeErr(w, http.StatusForbidden, "read_only",
		"you are looking at this account read only; stop impersonating to change anything")
	return true
}

// isAssumedRequest reports whether a session is currently assumed, which the
// console uses to badge every screen.
func (s *Server) isAssumedRequest(r *http.Request) bool { return assumeFrom(r) != "" }
