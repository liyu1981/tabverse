package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/liyu1981/tabverse/server/internal/auth"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// Registration invites are the operator's control over who may create an
// account when TABVERSED_REGISTRATION_REQUIRES_INVITE is on (see
// doc/tabversed-registration-plan.md). They are server-level, not per-account:
// the person being invited has no account yet.
//
// The response carries the rendered email as well as the invite, because a
// deployment with no SMTP has to have something to copy. The text lives in Go
// (accounts.RegistrationInviteEmail) and the console only echoes it, so the two
// cannot drift.

type registrationInviteEmail struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

type registrationInviteResponse struct {
	Invite store.RegistrationInvite `json:"invite"`
	// Code is the code this call minted, present only in a response that created
	// or re-issued one. The invite carries the stored code as well.
	Code  string                  `json:"code,omitempty"`
	Email registrationInviteEmail `json:"email"`
}

// defaultInviteTTLSeconds is a week: long enough to be useful, short enough
// that a forgotten invite is not a standing grant.
const defaultInviteTTLSeconds = 7 * 24 * 3600

func validInviteEmail(email string) bool {
	at := strings.IndexByte(email, '@')
	return at > 0 && at < len(email)-1 && !strings.ContainsAny(email, " \t\r\n")
}

// ensureInviteCode returns the invite's code, minting and storing a fresh one
// when the invite has none. An invite made before the code was kept in the
// clear has an empty Code, and a message rendered from it would name no code at
// all - useless, because registering with the invited address also means
// supplying the code. The new code replaces any old hash, so a previous code
// stops working (it was never kept in the clear and cannot be recovered).
func (s *Server) ensureInviteCode(ctx context.Context, inv *store.RegistrationInvite) (string, error) {
	if inv.Code != "" {
		return inv.Code, nil
	}
	display, normalized := auth.NewInviteCode()
	if err := s.store.SetRegistrationInviteCode(ctx, inv.Email, display, auth.HashToken(normalized)); err != nil {
		return "", err
	}
	inv.Code = display
	inv.HasCode = true
	return display, nil
}

// handleAdminCreateRegistrationInvite invites one address to register.
func (s *Server) handleAdminCreateRegistrationInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		TTLSeconds int    `json:"ttl_seconds"`
		SendEmail  bool   `json:"send_email"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if !validInviteEmail(email) {
		writeErr(w, http.StatusBadRequest, "bad_request", "a valid email is required")
		return
	}
	if req.TTLSeconds == 0 {
		req.TTLSeconds = defaultInviteTTLSeconds
	}
	if req.TTLSeconds < 60 || req.TTLSeconds > 90*24*3600 {
		writeErr(w, http.StatusBadRequest, "bad_request", "ttl_seconds must be within [60, 7776000]")
		return
	}
	// Every invitation carries a code: the message names it, and registering with
	// the invited address also means supplying it.
	display, normalized := auth.NewInviteCode()
	code, codeHash := display, auth.HashToken(normalized)
	ctx := r.Context()
	inv, err := s.store.CreateRegistrationInvite(ctx, email, code, codeHash, s.actorOf(r),
		int64(req.TTLSeconds)*1000)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	subject, body := s.accounts.RenderRegistrationInvite(code, inv.ExpiresAt)
	if req.SendEmail {
		if sentSubject, sentBody, sendErr := s.accounts.SendRegistrationInvite(email, code, inv.ExpiresAt); sendErr != nil {
			// The invite exists; a mail failure must not lose it. The console
			// still gets the text to copy.
			s.logger.Warn("could not send the registration invitation", "to", email, "err", sendErr)
		} else {
			subject, body = sentSubject, sentBody
		}
	}
	inv.EmailSubject, inv.EmailBody = subject, body
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: s.actorOf(r), Target: email, Action: store.AuditRegistrationInviteAdded,
		IP: clientIP(r), Detail: "ttl " + strconv.Itoa(req.TTLSeconds) + "s",
	})
	writeJSON(w, http.StatusOK, registrationInviteResponse{
		Invite: inv, Code: code,
		Email: registrationInviteEmail{Subject: subject, Body: body},
	})
}

// handleAdminListRegistrationInvites lists every invite, so the console can
// show pending, used and expired in one place.
func (s *Server) handleAdminListRegistrationInvites(w http.ResponseWriter, r *http.Request) {
	invs, err := s.store.ListRegistrationInvites(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if invs == nil {
		invs = []store.RegistrationInvite{}
	}
	// The message is rendered here rather than stored: it is a function of the
	// code and the expiry, so the console always has the draft to show - an
	// invite opened from the list included. An invite with no code kept (one
	// stored before the code was) has one minted now, so the draft names a code
	// that actually registers.
	for i := range invs {
		code, err := s.ensureInviteCode(r.Context(), &invs[i])
		if err != nil {
			// The draft is a convenience, and a code that cannot be minted must
			// not take the whole list down with it.
			s.logger.Warn("could not mint a code for an invitation",
				"email", invs[i].Email, "err", err)
			code = invs[i].Code
		}
		subject, body := s.accounts.RenderRegistrationInvite(code, invs[i].ExpiresAt)
		invs[i].EmailSubject, invs[i].EmailBody = subject, body
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": invs})
}

// handleAdminSendRegistrationInvite delivers an invitation through the server's
// mail transport. It does not re-render anything: the console sends the drafted
// message as the body, and a caller that sends none gets the server's own
// rendering of it. An invite that has no stored code gets one minted first; an
// existing code is not regenerated (only a fresh create does that).
func (s *Server) handleAdminSendRegistrationInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Subject string `json:"subject"`
		Text    string `json:"text"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	email := strings.ToLower(strings.TrimSpace(r.PathValue("email")))
	ctx := r.Context()
	inv, err := s.store.RegistrationInviteFor(ctx, email)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if inv.UsedAt != 0 {
		writeErr(w, http.StatusConflict, "already_used",
			"that address has already registered")
		return
	}
	// A code is guaranteed before anything is sent: an invite that has none gets
	// one minted now, so the message - the console's or the server's rendering -
	// can carry a code that registers.
	code, err := s.ensureInviteCode(ctx, &inv)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	subject, body := strings.TrimSpace(req.Subject), req.Text
	if subject == "" || strings.TrimSpace(body) == "" {
		subject, body = s.accounts.RenderRegistrationInvite(code, inv.ExpiresAt)
	}
	if err := s.accounts.SendMessage(email, subject, body); err != nil {
		s.logger.Warn("could not send the registration invitation", "to", email, "err", err)
	}
	inv.EmailSubject, inv.EmailBody = subject, body
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: s.actorOf(r), Target: email, Action: store.AuditRegistrationInviteSent,
		IP: clientIP(r),
	})
	writeJSON(w, http.StatusOK, registrationInviteResponse{
		Invite: inv,
		Email:  registrationInviteEmail{Subject: subject, Body: body},
	})
}

// handleAdminRevokeRegistrationInvite un-invites an address.
func (s *Server) handleAdminRevokeRegistrationInvite(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.PathValue("email")))
	if err := s.store.RevokeRegistrationInvite(r.Context(), email); err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: s.actorOf(r), Target: email, Action: store.AuditRegistrationInviteRevoked,
		IP: clientIP(r),
	})
	w.WriteHeader(http.StatusNoContent)
}

// ---- registration requests ------------------------------------------------

// A registration request is an account created from a login with no invitation
// yet (`users.pending_at`): a social login proves the address, so instead of
// refusing it the server lets the person in far enough to be told to wait, and
// an operator sees the request here.

// handleAdminListRegistrationRequests lists the accounts waiting for an
// invitation.
func (s *Server) handleAdminListRegistrationRequests(w http.ResponseWriter, r *http.Request) {
	requests, err := s.store.ListPendingRegistrations(r.Context())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if requests == nil {
		requests = []store.UserSummary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": requests})
}

// handleAdminInviteRegistrationRequest approves one: it mints an invitation and
// activates the account, but does not send anything. Sending is the operator's
// explicit "Send with Resend" action (`handleAdminSendRegistrationInvite`), so a
// click here never mails somebody by accident; the response carries the rendered
// email for the console's copy section.
func (s *Server) handleAdminInviteRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	ctx := r.Context()
	acc, err := s.store.AccountByID(ctx, userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if !acc.Pending() {
		writeErr(w, http.StatusConflict, "not_pending",
			"that account is not waiting for an invitation")
		return
	}
	if strings.TrimSpace(acc.Email) == "" {
		writeErr(w, http.StatusBadRequest, "no_email",
			"that account has no address to invite")
		return
	}
	display, normalized := auth.NewInviteCode()
	inv, err := s.store.CreateRegistrationInvite(ctx, acc.Email, display, auth.HashToken(normalized),
		s.actorOf(r), defaultInviteTTLSeconds*1000)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if err := s.store.SetUserPending(ctx, userID, 0); err != nil {
		writeStoreErr(w, err)
		return
	}
	subject, body := s.accounts.RenderRegistrationInvite(display, inv.ExpiresAt)
	inv.EmailSubject, inv.EmailBody = subject, body
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditRegistrationRequestInvited,
		IP: clientIP(r), Detail: acc.Email,
	})
	writeJSON(w, http.StatusOK, registrationInviteResponse{
		Invite: inv, Code: display,
		Email: registrationInviteEmail{Subject: subject, Body: body},
	})
}

// handleAdminDeleteRegistrationRequest rejects one: the pending account and its
// identity go away, which is the same delete an operator already has, scoped to
// the accounts that are only requests.
func (s *Server) handleAdminDeleteRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("user_id")
	ctx := r.Context()
	acc, err := s.store.AccountByID(ctx, userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if !acc.Pending() {
		writeErr(w, http.StatusConflict, "not_pending",
			"that account is not waiting for an invitation")
		return
	}
	if err := s.store.DeleteUser(ctx, userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditRegistrationRequestRejected,
		IP: clientIP(r), Detail: acc.Email,
	})
	w.WriteHeader(http.StatusNoContent)
}
