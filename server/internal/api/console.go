package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/auth"
	"github.com/liyu1981/tabverse/server/internal/store"
	"github.com/liyu1981/tabverse/server/internal/webui"
)

// The console's session endpoints (adr/0012). Two of them, because that is all
// the login flow needs: the library owns the rest, under /auth/.
//
// Everything the console needs to know about who it is talking as arrives from
// /console/me, so the page has one source of truth and no second guess about
// which credential it is holding.

// signinAddressCookie remembers the address a passwordless sign-in link was
// sent to, so the register page can offer it back. The claim for that provider
// only carries a hash of the address, not the address itself (adr/0029), so
// without this the person has to retype what they just typed.
const signinAddressCookie = "tv_signin_address"

// signinAddressTTL matches the link's own 30 minute life, in seconds.
const signinAddressTTL = 30 * 60

func (s *Server) handleConsoleMe(w http.ResponseWriter, r *http.Request) {
	// Accounts are unconditional (adr/0013), so this endpoint has one shape.
	// The page's whole job is to read it and decide what to show.
	acc, err := s.accounts.AccountFromRequest(r)
	if err != nil {
		out := map[string]any{
			"signed_in":       false,
			"providers":       s.cfg.SocialProviders(),
			"admin_email":     s.cfg.AdminEmail,
			"operator_exists": s.operatorExists(r),
			"csrf_header":     accountsCSRFHeader,
			// Whether the passwordless email path is offered at all (off on the
			// official flavour): the sign-in view hides the address form when it
			// is false and shows only the social buttons.
			"email_registration": !s.cfg.DisableEmailRegistration,
			// Signed out: there is no account, so nothing is pending.
			"pending_registration": false,
			// Whether the operator gates new accounts on an invitation: the
			// register page then asks for the code (unless the address is the
			// operator's own, which is exempt) and offers to request one.
			"invite_required": s.cfg.RegistrationRequiresInvite,
			// Whether a link can actually be posted. The sign-in view says where
			// the link went, and it used to say "no mail server is configured" to
			// everybody, which is false on every deployment that has one.
			"smtp": s.cfg.MailConfigured(),
			// "resend" | "smtp" | "" - which transport the console's send
			// button would use, and whether it can send at all.
			"mail_transport": s.cfg.MailTransport(),
			// Whether there is a site to go back to at "/": this build carries the
			// documentation or only the redirect page, and the bar shows its
			// "tabverse" link back on that answer (adr/0024).
			"docs": webui.HasDocs(),
		}
		// A valid session whose subject has no account: the person authenticated
		// with a provider, but the account is a separate step now. The console
		// shows the register page instead of creating one (adr/0029). The claim's
		// own email is offered when the provider supplied it.
		if pending, ok := s.accounts.PendingRegistrationFromRequest(r); ok {
			out["needs_registration"] = true
			out["csrf"] = s.csrfToken(r)
			// The passwordless provider's claim has no address in it, so the
			// address the link was sent to comes back from the cookie set when it
			// was requested. A social provider's own address is already on the
			// claim and wins.
			email := pending.Email
			if email == "" && pending.Provider == accounts.ProviderEmail {
				if c, err := r.Cookie(signinAddressCookie); err == nil {
					email = c.Value
				}
			}
			out["registration"] = map[string]any{
				"provider": pending.Provider,
				"email":    email,
				"name":     pending.Name,
			}
		}
		writeJSON(w, http.StatusOK, out)
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
		"signed_in":          true,
		"user_id":            acc.ID,
		"name":               acc.Name,
		"email":              acc.Email,
		"role":               role,
		"email_verified":     acc.EmailVerifiedAt != nil,
		"created_at":         acc.CreatedAt,
		"csrf_header":        accountsCSRFHeader,
		"csrf":               s.csrfToken(r),
		"stats":              stats,
		"devices":            devices,
		"providers":          s.cfg.SocialProviders(),
		"admin_email":        s.cfg.AdminEmail,
		"operator_exists":    operator,
		"email_registration": !s.cfg.DisableEmailRegistration,
		// Set when this account came from a login with no invitation yet: the
		// console shows the "request received" notice instead of the account.
		"pending_registration": acc.Pending(),
		// Whether new accounts need an invitation on this server.
		"invite_required": s.cfg.RegistrationRequiresInvite,
		"smtp":            s.cfg.MailConfigured(),
		"mail_transport":  s.cfg.MailTransport(),
		// Whether there is a site to go back to at "/", for the same button as
		// above: the flag does not depend on who is asking.
		"docs": webui.HasDocs(),
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
	if s.cfg.DisableEmailRegistration {
		writeErr(w, http.StatusForbidden, "email_registration_disabled",
			"this server signs in with a social provider only")
		return
	}
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
	// No account is created here any more: asking for the link proves the
	// address, and the account is made by the explicit register step that
	// follows (adr/0029). The invite policy is applied there too, so an uninvited
	// address gets a link whose register page says so, rather than a silent
	// refusal here.
	//
	// The register page needs the address again after the link is followed, and
	// the passwordless claim hashes it into the subject instead of carrying it,
	// so remember it here for as long as the link is good.
	http.SetCookie(w, &http.Cookie{
		Name: signinAddressCookie, Value: addrKey, Path: webui.Mount,
		MaxAge: signinAddressTTL, HttpOnly: true, Secure: s.cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	})
	// The rewrite into the shape the library dispatches on. The `from` that
	// brings the person back to the console is not set here: Handlers() puts it on
	// every provider login, server side, so the two sign-in flows cannot drift.
	// The address is lower-cased before it is hashed, so the subject the session
	// resolves through matches the address Register will hash (it lower-cases
	// too), and one mailbox is one account however it was typed.
	hijack := r.Clone(r.Context())
	q := hijack.URL.Query()
	q.Set("address", addrKey)
	hijack.URL.RawQuery = q.Encode()
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

// handleConsoleRegister creates the account for a session that authenticated
// but has none. It is the explicit second step of the login-and-registration
// split (adr/0029): nothing else creates an account for a signed-in subject, so
// a session that outlives its account cannot resurrect it or invent a new one.
//
// It runs under the soft guard, so the pending session is visible but not
// required: a request with no such session is refused.
func (s *Server) handleConsoleRegister(w http.ResponseWriter, r *http.Request) {
	pending, ok := s.accounts.PendingRegistrationFromRequest(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "no_pending_registration",
			"sign in with a provider before creating an account")
		return
	}
	var req struct {
		Email   string `json:"email"`
		Agree   bool   `json:"agree"`
		Code    string `json:"code"`
		Request bool   `json:"request"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	if !req.Agree {
		writeErr(w, http.StatusBadRequest, "agreement_required",
			"agree to the user agreement to create an account")
		return
	}
	codeHash := ""
	if code := auth.NormalizeInviteCode(req.Code); code != "" {
		codeHash = auth.HashToken(code)
	}
	userID, err := s.accounts.Register(r.Context(), pending, req.Email, "", codeHash, req.Request)
	if err != nil {
		switch {
		case errors.Is(err, store.ErrInviteRequired):
			writeErr(w, http.StatusForbidden, "invite_required",
				"this server is invite-only; ask the operator to invite your address")
		case errors.Is(err, accounts.ErrEmailMismatch):
			writeErr(w, http.StatusBadRequest, "email_mismatch",
				"create the account with the address the sign-in link was sent to")
		default:
			writeStoreErr(w, err)
		}
		return
	}
	// The agreement is recorded on the account and in the audit log, in the same
	// transaction the account was made in spirit: a failure to stamp it is a
	// warning, not a reason to fail a registration that already happened.
	if err := s.store.SetTermsAccepted(r.Context(), userID); err != nil {
		s.logger.Warn("could not record the user agreement", "user", userID, "err", err)
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: userID, Target: userID, Action: store.AuditTermsAccepted, IP: clientIP(r),
	})
	// The address cookie has done its job; drop it so a later registration does
	// not inherit a stale one.
	http.SetCookie(w, &http.Cookie{
		Name: signinAddressCookie, Value: "", Path: webui.Mount, MaxAge: -1,
		HttpOnly: true, Secure: s.cfg.SecureCookies,
	})
	// A normal registration signs the pending session out, so the next sign-in
	// resolves to the new account. A *request* keeps the session: it now resolves
	// to the pending account, and the console shows the waiting notice the moment
	// the page re-reads who it is talking as (adr/0029).
	if !req.Request {
		s.accounts.SignOut(w)
	}
	w.WriteHeader(http.StatusNoContent)
}
