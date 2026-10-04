package accounts

import (
	"context"
	"net/http"
	"strings"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// Recording who signed in, and from where.
//
// AuditLogin and AuditLoginFailed existed as constants from the first audit
// table and were never written: sign-out was recorded, sign-in was not, and
// "who signed in, when, from where" is the one question an operator actually
// asks after an incident. The reason they were never written is that the
// library mints the session inside its own handler, so from outside there is no
// "a login happened" callback - only the cookie that comes out of it.
//
// So the observation point is the response. A successful sign-in is exactly "a
// tv_session cookie was set"; a failed one is "the auth handlers refused,
// without setting one". Both are read off the same wrapper, and the wrapper only
// looks - it cannot change what the library does.

// responseObserver watches what a handler wrote without changing it.
type responseObserver struct {
	http.ResponseWriter
	status int
}

// Unwrap lets anything above that needs the real writer find it
// (http.ResponseController, a websocket hijack).
func (o *responseObserver) Unwrap() http.ResponseWriter { return o.ResponseWriter }

func (o *responseObserver) WriteHeader(code int) {
	if o.status == 0 {
		o.status = code
	}
	o.ResponseWriter.WriteHeader(code)
}

func (o *responseObserver) Write(b []byte) (int, error) {
	if o.status == 0 {
		o.status = http.StatusOK
	}
	return o.ResponseWriter.Write(b)
}

// Flush is spelled out as well as Unwrap: the auth handlers are plain HTTP
// today, and a wrapper that hid this would be a trap for whatever comes next.
func (o *responseObserver) Flush() {
	if f, ok := o.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// withLoginAudit writes the sign-in audit entry for every request the auth
// handlers answer.
func (s *Service) withLoginAudit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		obs := &responseObserver{ResponseWriter: w}
		next.ServeHTTP(obs, r)
		s.auditSignin(r, obs)
	})
}

// auditSignin reads the outcome off the response: a session cookie is a login,
// a refusal without one is a failed attempt at a login.
func (s *Service) auditSignin(r *http.Request, obs *responseObserver) {
	if value := cookieValue(obs.Header()["Set-Cookie"], sessionCookie); value != "" {
		s.recordLogin(r, value)
		return
	}
	switch obs.status {
	case http.StatusUnauthorized, http.StatusForbidden:
		s.recordLoginFailure(r, obs.status)
	}
}

// recordLogin resolves the account behind a freshly minted session and writes
// the entry.
//
// An account that is not there yet is a first sign-in through a social
// provider: the library's claim is keyed by the provider's subject, and our
// account row is only created on the *next* request. The entry is written all
// the same, with the claim id in the detail, because "a new identity appeared
// from this address at this time" is the row an operator wants - the account id
// is something they can join afterwards.
func (s *Service) recordLogin(r *http.Request, tokenString string) {
	ctx := context.Background()
	claims, err := s.mw.JWTService.Parse(tokenString)
	if err != nil || claims.User == nil {
		return
	}
	claimID := claims.User.ID
	userID, known, err := ResolveAccountID(ctx, s.store, claimID)
	if err != nil {
		// A retired subject: the account is gone, so there is nothing to
		// attribute this to and nothing to record it against.
		return
	}
	entry := store.AuditEntry{
		Action: store.AuditLogin,
		IP:     clientIPOf(r),
		Detail: "provider " + s.providerOf(claimID),
	}
	if known {
		entry.Actor = userID
		entry.Target = userID
	}
	if err := s.store.AppendAudit(ctx, entry); err != nil {
		s.log.Warn("cannot record the sign-in", "err", err)
	}
}

// recordLoginFailure is a sign-in that did not happen. There is no account to
// name - refusing is what keeps the endpoint from being an account directory -
// so the row carries the address the link was asked for, which is what makes a
// run of these worth noticing.
func (s *Service) recordLoginFailure(r *http.Request, status int) {
	address := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	detail := "no session issued"
	if address != "" {
		detail = "address " + address
	}
	if err := s.store.AppendAudit(context.Background(), store.AuditEntry{
		Action: store.AuditLoginFailed,
		IP:     clientIPOf(r),
		Detail: detail + ", refused " + http.StatusText(status),
	}); err != nil {
		s.log.Warn("cannot record the failed sign-in", "err", err)
	}
}

// cookieValue pulls one cookie's value out of a raw Set-Cookie header list.
func cookieValue(headers []string, name string) string {
	for _, raw := range headers {
		if !strings.HasPrefix(raw, name+"=") {
			continue
		}
		rest := raw[len(name)+1:]
		if i := strings.IndexByte(rest, ';'); i >= 0 {
			rest = rest[:i]
		}
		if rest != "" {
			return rest
		}
	}
	return ""
}

// clientIPOf is the audit log's address rule: the first entry of
// X-Forwarded-For when a proxy set one, else the peer. The api package has the
// same function for its own routes; it is unexported there, and exporting it
// for one caller across a package boundary is worse than writing it twice.
func clientIPOf(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if i := strings.IndexByte(fwd, ','); i > 0 {
			return fwd[:i]
		}
		return fwd
	}
	return r.RemoteAddr
}
