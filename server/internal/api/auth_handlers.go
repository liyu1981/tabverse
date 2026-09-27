package api

import (
	"context"
	"net/http"
	"time"

	"github.com/liyu1981/tabverse/server/internal/auth"
)

func contextWith(ctx context.Context, key ctxKey, value string) context.Context {
	return context.WithValue(ctx, key, value)
}

func userIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyUser).(string)
	return v
}

func deviceIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyDevice).(string)
	return v
}

// ---- auth handlers --------------------------------------------------------

// handleBootstrap creates the very first account of a deployment.
// It is only open while no user exists, which makes a fresh, internet
// reachable server safe by default: whoever pairs first owns it.
func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.Name == "" {
		req.Name = "default"
	}

	n, err := s.store.CountUsers(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if n > 0 {
		writeErr(w, http.StatusConflict, "already_bootstrapped",
			"this server already has an account; use a pairing code instead")
		return
	}

	user, err := s.store.CreateUser(r.Context(), newID("usr_"), req.Name)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	s.writeDevice(w, r, user.ID, "bootstrap")
}

// handlePair exchanges a single use pairing code for a device token.
func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	var req struct {
		InviteCode string `json:"invite_code"`
		DeviceName string `json:"device_name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	code := auth.NormalizeInviteCode(req.InviteCode)
	if code == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "invite_code is required")
		return
	}
	userID, err := s.store.ConsumeInvite(r.Context(), auth.HashToken(code))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_invite", "code unknown, used or expired")
		return
	}
	s.writeDevice(w, r, userID, req.DeviceName)
}

// handleCreateInvite mints a pairing code for another device of this account.
func (s *Server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
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

	display, normalized := auth.NewInviteCode()
	expires, err := s.store.CreateInvite(r.Context(), auth.HashToken(normalized),
		userIDFrom(r.Context()), int64(req.TTLSeconds)*1000)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"code":       display,
		"expires_at": expires,
	})
}

// writeDevice creates a device and its token, then returns them once.
func (s *Server) writeDevice(w http.ResponseWriter, r *http.Request, userID, deviceName string) {
	if deviceName == "" {
		deviceName = "unnamed device"
	}
	device, err := s.store.CreateDevice(r.Context(), newID("dev_"), userID, deviceName)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	plain, hash := auth.NewToken()
	if err := s.store.CreateToken(r.Context(), hash, userID, device.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	rev, _ := s.store.ServerRev(r.Context(), userID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"user_id":    userID,
		"device_id":  device.ID,
		"token":      plain,
		"server_rev": rev,
		"issued_at":  time.Now().UnixMilli(),
	})
}
