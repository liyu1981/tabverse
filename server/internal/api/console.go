package api

import (
	"errors"
	"net/http"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// The console's session endpoints (adr/0012). Two of them, because that is all
// the login flow needs: the library owns the rest, under /auth/.
//
// Everything the console needs to know about who it is talking as arrives from
// /console/me, so the page has one source of truth and no second guess about
// which credential it is holding.

func (s *Server) handleConsoleMe(w http.ResponseWriter, r *http.Request) {
	if s.accounts == nil {
		// A deployment with accounts switched off still serves the page, which
		// then falls back to the admin token. Saying so here lets the page make
		// that choice without a second endpoint.
		writeJSON(w, http.StatusOK, map[string]any{
			"accounts_enabled": false,
			"admin_token":      s.cfg.AdminEnabled(),
			"self_hosted":      s.selfHosted(),
			"providers":        []string{},
		})
		return
	}
	acc, err := s.accounts.AccountFromRequest(r)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"accounts_enabled": true,
			"admin_token":      s.cfg.AdminEnabled(),
			"self_hosted":      s.selfHosted(),
			"signed_in":        false,
			"providers":        s.cfg.SocialProviders(),
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
	writeJSON(w, http.StatusOK, map[string]any{
		"accounts_enabled": true,
		"admin_token":      s.cfg.AdminEnabled(),
		"self_hosted":      s.selfHosted(),
		"signed_in":        true,
		"user_id":          acc.ID,
		"name":             acc.Name,
		"email":            acc.Email,
		"role":             acc.Role,
		"email_verified":   acc.EmailVerifiedAt != nil,
		"created_at":       acc.CreatedAt,
		"csrf_header":      accountsCSRFHeader,
		"providers":        s.cfg.SocialProviders(),
		"stats":            stats,
		"devices":          devices,
		"csrf":             s.csrfToken(r),
	})
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
