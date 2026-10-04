package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// The console's session endpoints (adr/0012). Two of them, because that is all
// the login flow needs: the library owns the rest, under /auth/.
//
// Everything the console needs to know about who it is talking as arrives from
// /console/me, so the page has one source of truth and no second guess about
// which credential it is holding.

func (s *Server) handleConsoleMe(w http.ResponseWriter, r *http.Request) {
	// Accounts are unconditional (adr/0013), so this endpoint has one shape.
	// The page's whole job is to read it and decide what to show.
	acc, err := s.accounts.AccountFromRequest(r)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"signed_in":       false,
			"providers":       s.cfg.SocialProviders(),
			"admin_email":     s.cfg.AdminEmail,
			"operator_exists": s.operatorExists(r),
			"csrf_header":     accountsCSRFHeader,
		})
		return
	}

	// The one-time device token is *not* included here and never is again: the
	// server stores only its hash, and the console shows a fingerprint.
	devices, err := s.store.ListDevices(r.Context(), acc.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	stats, err := s.store.UserStats(r.Context(), acc.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	// A row that predates the role column reads as an ordinary account, and the
	// page should never have to know that.
	role := acc.Role
	if role == "" {
		role = store.RoleUser
	}
	operator := s.operatorExists(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"signed_in":       true,
		"user_id":         acc.ID,
		"name":            acc.Name,
		"email":           acc.Email,
		"role":            role,
		"email_verified":  acc.EmailVerifiedAt != nil,
		"created_at":      acc.CreatedAt,
		"csrf_header":     accountsCSRFHeader,
		"csrf":            s.csrfToken(r),
		"stats":           stats,
		"devices":         devices,
		"providers":       s.cfg.SocialProviders(),
		"admin_email":     s.cfg.AdminEmail,
		"operator_exists": operator,
		// Set when this person is the address the operator is expected to be but
		// nobody has claimed the role yet. The server can only fix that on the
		// next start, so the console says so rather than pretending.
		"awaiting_operator": s.awaitingOperator(r, acc),
	})
}

// operatorExists reports whether anybody on this deployment is an operator.
func (s *Server) operatorExists(r *http.Request) bool {
	n, err := s.store.CountAdmins(r.Context())
	return err == nil && n > 0
}

// awaitingOperator is true for the account whose address is TABVERSED_ADMIN_EMAIL
// on a deployment that has no operator yet.
func (s *Server) awaitingOperator(r *http.Request, acc store.Account) bool {
	if s.cfg.AdminEmail == "" {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(acc.Email), s.cfg.AdminEmail) {
		return false
	}
	return !s.operatorExists(r)
}

func (s *Server) handleConsoleSignOut(w http.ResponseWriter, r *http.Request) {
	if s.accounts != nil {
		acc, err := s.accounts.AccountFromRequest(r)
		if err == nil {
			// Signing out is a session event, so it is audited. It does not
			// revoke: the cut-off would sign the person out everywhere, and
			// "log out here" is not what they asked for.
			_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
				Actor: acc.ID, Action: store.AuditLogout, IP: clientIP(r),
			})
		}
		s.accounts.SignOut(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleConsoleRevokeSessions ends every console session this account has,
// including the one making the call (ADR 0021). It is the answer to "I think
// somebody else got into my account", and it is deliberately not the same thing
// as signing out, which only forgets this browser.
func (s *Server) handleConsoleRevokeSessions(w http.ResponseWriter, r *http.Request) {
	s.revokeSessions(w, r, "")
}

// handleAdminRevokeSessions is the operator doing the same for somebody else.
func (s *Server) handleAdminRevokeSessions(w http.ResponseWriter, r *http.Request) {
	s.revokeSessions(w, r, r.PathValue("user_id"))
}

func (s *Server) revokeSessions(w http.ResponseWriter, r *http.Request, requested string) {
	userID, ok := s.resolveScope(w, r, requested)
	if !ok {
		return
	}
	if err := s.store.RevokeAllSessions(r.Context(), userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	actor := userID
	if s.accounts != nil {
		if me, err := s.accounts.AccountFromRequest(r); err == nil {
			actor = me.ID
		}
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: actor, Target: userID, Action: store.AuditSessionsRevoked,
		IP: clientIP(r), Detail: "console sessions ended; device tokens untouched",
	})
	s.logger.Info("console sessions revoked", "user", userID, "by", actor)
	// The caller's own cookie is now worthless, so it is cleared here rather
	// than leaving the page to make one more request and be refused.
	if s.accounts != nil && actor == userID {
		s.accounts.SignOut(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

// selfHosted reports whether a social login is even possible: the OAuth
// callbacks need a public URL the provider can reach, and a LAN address is not
// one. The console hides the social buttons rather than offering something that
// cannot work.
func (s *Server) selfHosted() bool {
	return s.cfg.PublicURL != "" && s.cfg.PublicURL != "http://127.0.0.1:8223"
}

// csrfToken reads the XSRF cookie the library set, which the page has to echo
// back in the header on every state changing request.
func (s *Server) csrfToken(r *http.Request) string {
	if c, err := r.Cookie("tv_xsrf"); err == nil {
		return c.Value
	}
	return ""
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		// Left as the first entry: the deployment's proxy decides the format,
		// and the audit log wants something a human can read.
		if i := indexByte(fwd, ','); i > 0 {
			return fwd[:i]
		}
		return fwd
	}
	return r.RemoteAddr
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// BootstrapOperator runs the operator bootstrap at startup: an account that
// already uses TABVERSED_ADMIN_EMAIL becomes the operator, so setting the
// variable on an existing deployment and restarting is all it takes (adr/0013).
func (s *Server) BootstrapOperator(ctx context.Context) error {
	return s.accounts.PromoteAdminEmail(ctx)
}

// handleConsoleSigninLink asks the server to email a sign-in link, and is what
// the console's form posts to.
//
// The account is created *here*, before the library sends anything, because the
// order matters: the library derives a stable subject from the address and puts
// it in the session claim, and a session is checked against our accounts before
// the claim is mapped to one - so an account that does not exist yet would have
// its first request refused. Asking for the link creates the account; following
// the link is what proves the address.
//
// The rest is the library's: this rewrites the path into the shape its handler
// dispatches on and hands over, so token issuance, the message and the redirect
// all stay where they are.
func (s *Server) handleConsoleSigninLink(w http.ResponseWriter, r *http.Request) {
	email := strings.TrimSpace(r.URL.Query().Get("address"))
	if email == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "address is required")
		return
	}
	// Throttled before anything else happens, so a refusal costs one map lookup
	// and not an account row. The address is lower-cased first: otherwise
	// Alice@x.com and alice@x.com are two budgets for one mailbox.
	addrKey := strings.ToLower(email)
	if !s.signinByAddress.allow(addrKey) {
		s.refuseSigninLink(w, r, addrKey)
		return
	}
	if ip := clientIP(r); !s.signinByIP.allow(ip) {
		s.refuseSigninLink(w, r, ip)
		return
	}
	// The account and the identity the session will resolve to, both created
	// before the link goes out: a session is checked against our accounts before
	// the claim is mapped to one, so an account that did not exist yet would have
	// its first request refused.
	if _, err := s.accounts.EnsureAccount(r.Context(), email, r.URL.Query().Get("user")); err != nil {
		writeStoreErr(w, err)
		return
	}
	// The rewrite into the shape the library dispatches on. The `from` that
	// brings the person back to the console is not set here: Handlers() puts it on
	// every provider login, server side, so the two sign-in flows cannot drift.
	hijack := r.Clone(r.Context())
	hijack.URL.Path = "/" + accounts.ProviderEmail + "/login"
	s.accounts.Handlers().ServeHTTP(w, hijack)
}

// refuseSigninLink answers a throttled request. The body is the same for both
// limits and says nothing about whether the address is registered, so the
// endpoint cannot be used to find out who has an account.
func (s *Server) refuseSigninLink(w http.ResponseWriter, r *http.Request, key string) {
	s.logger.Warn("sign-in link throttled", "key", key, "ip", clientIP(r))
	writeErr(w, http.StatusTooManyRequests, "rate_limited",
		"too many sign-in links requested; wait an hour and try again")
}
