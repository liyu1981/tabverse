package api

import (
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
	// Code is present only when this call created (or re-issued) one, and only
	// in that response: the store keeps the hash.
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

// handleAdminCreateRegistrationInvite invites one address to register.
func (s *Server) handleAdminCreateRegistrationInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		TTLSeconds int    `json:"ttl_seconds"`
		WithCode   bool   `json:"with_code"`
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
	code, codeHash := "", ""
	if req.WithCode {
		display, normalized := auth.NewInviteCode()
		code, codeHash = display, auth.HashToken(normalized)
	}
	ctx := r.Context()
	inv, err := s.store.CreateRegistrationInvite(ctx, email, codeHash, s.actorOf(r),
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
	writeJSON(w, http.StatusOK, map[string]any{"invites": invs})
}

// handleAdminSendRegistrationInvite (re)delivers an invitation. A coded invite
// cannot be re-sent with its old code - only the hash is stored - so a re-send
// mints a fresh one and the previous code stops working. The expiry is left
// alone.
func (s *Server) handleAdminSendRegistrationInvite(w http.ResponseWriter, r *http.Request) {
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
	code := ""
	if inv.HasCode {
		display, normalized := auth.NewInviteCode()
		code = display
		if err := s.store.SetRegistrationInviteCode(ctx, email, auth.HashToken(normalized)); err != nil {
			writeStoreErr(w, err)
			return
		}
	}
	subject, body, err := s.accounts.SendRegistrationInvite(email, code, inv.ExpiresAt)
	if err != nil {
		s.logger.Warn("could not send the registration invitation", "to", email, "err", err)
	}
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: s.actorOf(r), Target: email, Action: store.AuditRegistrationInviteSent,
		IP: clientIP(r),
	})
	writeJSON(w, http.StatusOK, registrationInviteResponse{
		Invite: inv, Code: code,
		Email: registrationInviteEmail{Subject: subject, Body: body},
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
