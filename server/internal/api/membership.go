package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/liyu1981/tabverse/server/internal/membership"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// The membership surface (adr/0032). Three audiences, three shapes:
//
//   - a paired device: requireSyncMembership gates sync, the stream and pairing;
//   - a signed-in account: a read-only console session once expired, plus the
//     self-service card, renewal and export;
//   - an operator: the directory, the credit and lease controls, and the master
//     switch.

const dayMS = int64(24 * time.Hour / time.Millisecond)

// requireSyncMembership writes the 402 and returns false when an account may not
// use the system right now. It reads the lease live, so it takes effect at the
// expiry instant rather than on the worker's next pass. It is a no-op when the
// master switch is off.
func (s *Server) requireSyncMembership(w http.ResponseWriter, r *http.Request, userID string) bool {
	d, err := s.membership.DecisionFor(r.Context(), userID)
	if err != nil {
		writeStoreErr(w, err)
		return false
	}
	if d.Allowed() {
		return true
	}
	s.writeMembershipExpired(w, d)
	return false
}

func (s *Server) writeMembershipExpired(w http.ResponseWriter, d membership.Decision) {
	writeJSON(w, http.StatusPaymentRequired, map[string]any{
		"error":           "membership_expired",
		"message":         "your membership has expired; sign in to renew or download your data",
		"status":          string(d.Status),
		"expires_at":      d.ExpiresAt,
		"retention_until": d.RetentionUntil,
	})
}

// readOnlyRefusal turns an expired account's console session read-only: reads
// and the two recovery paths pass, everything else is refused with the same 402
// a device would get. Operators and the configured root are exempt.
func (s *Server) readOnlyRefusal(w http.ResponseWriter, r *http.Request) bool {
	if s.membership == nil || !s.membership.Enabled() {
		return false
	}
	acc, err := s.accounts.AccountFromRequest(r)
	if err != nil {
		return false
	}
	if acc.IsAdmin() || s.membership.IsRootEmail(acc.Email) {
		return false
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return false
	}
	switch r.URL.Path {
	case "/console/api/v1/console/revoke-sessions", "/console/api/v1/console/membership/renew":
		return false
	}
	d, err := s.membership.DecisionFor(r.Context(), acc.ID)
	if err != nil {
		return false
	}
	if !d.Status.ReadOnly() {
		return false
	}
	s.writeMembershipExpired(w, d)
	return true
}

// ---- self-service ---------------------------------------------------------

// membershipView is the JSON block the console draws its card from.
func (s *Server) membershipView(ctx context.Context, acc store.Account) (map[string]any, error) {
	d, err := s.membership.DecisionFor(ctx, acc.ID)
	if err != nil {
		return nil, err
	}
	m, err := s.store.Membership(ctx, acc.ID)
	if err != nil && err != store.ErrNotFound {
		return nil, err
	}
	now := time.Now().UnixMilli()
	daysLeft := int64(0)
	if d.ExpiresAt > now {
		daysLeft = (d.ExpiresAt - now + dayMS - 1) / dayMS
	}
	daysUntilClose := int64(0)
	if d.RetentionUntil > now {
		daysUntilClose = (d.RetentionUntil - now + dayMS - 1) / dayMS
	}
	return map[string]any{
		"enabled":          s.membership.Enabled(),
		"status":           string(d.Status),
		"read_only":        d.Status.ReadOnly(),
		"unlimited":        m.Unlimited,
		"expires_at":       d.ExpiresAt,
		"credits":          d.Credits,
		"period_days":      d.PeriodDays,
		"period_credits":   s.cfg.MembershipPeriodCredits,
		"retention_days":   s.cfg.MembershipRetentionDays,
		"retention_until":  d.RetentionUntil,
		"days_left":        daysLeft,
		"days_until_close": daysUntilClose,
		"can_export":       true,
	}, nil
}

func (s *Server) handleConsoleMembership(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, "")
	if !ok {
		return
	}
	acc, err := s.store.AccountByID(r.Context(), userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	view, err := s.membershipView(r.Context(), acc)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	ledger, err := s.store.Ledger(r.Context(), userID, 50)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"membership": view, "ledger": ledger})
}

// handleConsoleRenew spends credits to open a period now. It is one of the two
// mutations an expired account is still allowed, because it is the way back.
func (s *Server) handleConsoleRenew(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, "")
	if !ok {
		return
	}
	m, err := s.store.OpenPeriod(r.Context(), userID,
		s.cfg.MembershipPeriodCredits, s.cfg.MembershipPeriod().Milliseconds(), userID, "self-service renewal")
	if err != nil {
		if errors.Is(err, store.ErrInsufficientCredits) {
			writeErr(w, http.StatusPaymentRequired, "insufficient_credits",
				"not enough credits to open a period; ask an operator to add credits")
			return
		}
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: userID, Target: userID, Action: store.AuditMembershipPeriod,
		IP: clientIP(r), Detail: "self-service renewal",
	})
	acc, err := s.store.AccountByID(r.Context(), userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	view, err := s.membershipView(r.Context(), acc)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"membership": view, "expires_at": m.ExpiresAt})
}

// handleConsoleExport streams the account's own live records as NDJSON. It is
// available at any status, so an expired account can always take a copy before
// the retention window closes.
func (s *Server) handleConsoleExport(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, "")
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="tabverse-export-`+userID+`.ndjson"`)
	w.WriteHeader(http.StatusOK)
	bw := bufio.NewWriter(w)
	enc := json.NewEncoder(bw)

	type manifest struct {
		Type       string `json:"type"`
		UserID     string `json:"user_id"`
		Version    int    `json:"version"`
		ExportedAt int64  `json:"exported_at"`
	}
	if err := enc.Encode(manifest{Type: "manifest", UserID: userID, Version: 1, ExportedAt: time.Now().UnixMilli()}); err != nil {
		return
	}
	type exportRecord struct {
		Entity    string          `json:"entity"`
		ID        string          `json:"id"`
		Rev       int64           `json:"rev"`
		UpdatedAt int64           `json:"updated_at"`
		Payload   json.RawMessage `json:"payload,omitempty"`
	}
	err := s.store.ExportRecords(r.Context(), userID, func(rec store.Record) error {
		out := exportRecord{Entity: rec.Entity, ID: rec.ID, Rev: rec.Rev, UpdatedAt: rec.UpdatedAt}
		if json.Valid([]byte(rec.Payload)) {
			out.Payload = json.RawMessage(rec.Payload)
		}
		return enc.Encode(out)
	})
	if err != nil {
		// The status is already sent; record the failure and stop.
		s.logger.Error("export failed", "user", userID, "err", err)
		return
	}
	_ = bw.Flush()
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: userID, Target: userID, Action: store.AuditDataExported, IP: clientIP(r),
	})
}

// ---- operator -------------------------------------------------------------

// membershipStatusOf computes a directory row's status for display.
func (s *Server) membershipStatusOf(sum store.MembershipSummary) membership.Status {
	m := store.Membership{
		UserID:    sum.UserID,
		ExpiresAt: sum.ExpiresAt,
		Credits:   sum.Credits,
		Unlimited: sum.Unlimited,
	}
	return membership.StatusOf(time.Now(), m, s.membership.Enabled(), sum.Role,
		s.membership.IsRootEmail(sum.Email), s.cfg.MembershipRetention())
}

func (s *Server) handleAdminListMemberships(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListMemberships(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	type row struct {
		store.MembershipSummary
		Status   membership.Status `json:"status"`
		ReadOnly bool              `json:"read_only"`
	}
	out := make([]row, 0, len(rows))
	for _, m := range rows {
		st := s.membershipStatusOf(m)
		out = append(out, row{MembershipSummary: m, Status: st, ReadOnly: st.ReadOnly()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"memberships": out, "enabled": s.membership.Enabled()})
}

func (s *Server) handleAdminGetMembership(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	acc, err := s.store.AccountByID(r.Context(), userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	view, err := s.membershipView(r.Context(), acc)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	ledger, err := s.store.Ledger(r.Context(), userID, 50)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"membership": view, "ledger": ledger})
}

func (s *Server) handleAdminMembershipLedger(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	ledger, err := s.store.Ledger(r.Context(), userID, 200)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ledger": ledger})
}

func (s *Server) handleAdminGrantCredits(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	var req struct {
		Delta  int64  `json:"delta"`
		Reason string `json:"reason"`
		Detail string `json:"detail"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.Delta == 0 {
		writeErr(w, http.StatusBadRequest, "bad_request", "delta must not be zero")
		return
	}
	reason := req.Reason
	switch reason {
	case store.ReasonGrant, store.ReasonAdjustment, store.ReasonRefund, store.ReasonPurchase:
	default:
		reason = store.ReasonAdjustment
	}
	actor := s.actorOf(r)
	m, err := s.store.GrantCredits(r.Context(), userID, req.Delta, reason, actor, req.Detail)
	if err != nil {
		if errors.Is(err, store.ErrInsufficientCredits) {
			writeErr(w, http.StatusBadRequest, "insufficient_credits", "the balance cannot go below zero")
			return
		}
		writeStoreErr(w, err)
		return
	}
	action := store.AuditMembershipGrant
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: actor, Target: userID, Action: action, IP: clientIP(r),
		Detail: strconv.FormatInt(req.Delta, 10) + " credits: " + req.Detail,
	})
	writeJSON(w, http.StatusOK, map[string]any{"membership": membershipRowView(m)})
}

func (s *Server) handleAdminExtendMembership(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	var req struct {
		Periods    int   `json:"periods"`
		Until      int64 `json:"until"`
		UseCredits bool  `json:"use_credits"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	ctx := r.Context()
	actor := s.actorOf(r)
	periodMS := s.cfg.MembershipPeriod().Milliseconds()
	cur, err := s.store.Membership(ctx, userID)
	if err != nil && err != store.ErrNotFound {
		writeStoreErr(w, err)
		return
	}
	var m store.Membership
	switch {
	case req.Until > 0:
		m, err = s.store.SetMembership(ctx, userID, req.Until, cur.Unlimited, actor, "operator extension")
		if err != nil {
			writeStoreErr(w, err)
			return
		}
	case req.Periods > 0 && req.UseCredits:
		for i := 0; i < req.Periods; i++ {
			m, err = s.store.OpenPeriod(ctx, userID, s.cfg.MembershipPeriodCredits, periodMS, actor, "operator extension")
			if err != nil {
				break
			}
		}
		if err != nil {
			if errors.Is(err, store.ErrInsufficientCredits) {
				writeErr(w, http.StatusPaymentRequired, "insufficient_credits", "not enough credits to extend")
				return
			}
			writeStoreErr(w, err)
			return
		}
	case req.Periods > 0:
		base := cur.ExpiresAt
		if base < time.Now().UnixMilli() {
			base = time.Now().UnixMilli()
		}
		m, err = s.store.SetMembership(ctx, userID, base+int64(req.Periods)*periodMS, cur.Unlimited, actor, "operator extension")
		if err != nil {
			writeStoreErr(w, err)
			return
		}
	default:
		writeErr(w, http.StatusBadRequest, "bad_request", "pass periods or until")
		return
	}
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: actor, Target: userID, Action: store.AuditMembershipExtend, IP: clientIP(r),
	})
	writeJSON(w, http.StatusOK, map[string]any{"membership": membershipRowView(m)})
}

func (s *Server) handleAdminSetUnlimited(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	var req struct {
		Unlimited bool `json:"unlimited"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	acc, err := s.store.AccountByID(r.Context(), userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if s.membership.IsRootEmail(acc.Email) {
		writeErr(w, http.StatusForbidden, "root_account",
			"the configured root account is always unlimited")
		return
	}
	m, err := s.store.SetMembership(r.Context(), userID, -1, req.Unlimited, s.actorOf(r), "unlimited flag")
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditMembershipUnlimited,
		IP: clientIP(r), Detail: strconv.FormatBool(req.Unlimited),
	})
	writeJSON(w, http.StatusOK, map[string]any{"membership": membershipRowView(m)})
}

func (s *Server) handleAdminResetMembership(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	var req struct {
		GrantPeriod bool `json:"grant_period"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	ctx := r.Context()
	cur, err := s.store.Membership(ctx, userID)
	if err != nil && err != store.ErrNotFound {
		writeStoreErr(w, err)
		return
	}
	expires := cur.ExpiresAt
	if req.GrantPeriod {
		expires = time.Now().UnixMilli() + s.cfg.MembershipPeriod().Milliseconds()
	}
	// SetMembership with an explicit expiry clears the lifecycle stamps, which
	// is what "reset" means; it never re-grants the one trial.
	m, err := s.store.SetMembership(ctx, userID, expires, cur.Unlimited, s.actorOf(r), "operator reset")
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(ctx, store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditMembershipExtend,
		IP: clientIP(r), Detail: "reset",
	})
	writeJSON(w, http.StatusOK, map[string]any{"membership": membershipRowView(m)})
}

func (s *Server) handleAdminCloseMembership(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.resolveScope(w, r, r.PathValue("user_id"))
	if !ok {
		return
	}
	acc, err := s.store.AccountByID(r.Context(), userID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if s.membership.IsRootEmail(acc.Email) {
		writeErr(w, http.StatusForbidden, "root_account", "the configured root account cannot be closed")
		return
	}
	if r.URL.Query().Get("dry_run") != "" {
		writeJSON(w, http.StatusOK, map[string]any{"dry_run": true, "user_id": userID})
		return
	}
	if err := s.store.DeleteUser(r.Context(), userID); err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: s.actorOf(r), Target: userID, Action: store.AuditMembershipClosed,
		IP: clientIP(r), Detail: "operator closed the account",
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminGetMembershipSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":        s.membership.Enabled(),
		"period_days":    s.cfg.MembershipPeriodDays,
		"period_credits": s.cfg.MembershipPeriodCredits,
		"trial_credits":  s.cfg.MembershipTrialCredits,
		"retention_days": s.cfg.MembershipRetentionDays,
		"auto_purge":     s.cfg.MembershipAutoPurge,
	})
}

func (s *Server) handleAdminSetMembershipSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.Enabled == nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "enabled is required")
		return
	}
	if err := s.membership.SetEnabled(r.Context(), *req.Enabled, s.actorOf(r)); err != nil {
		writeStoreErr(w, err)
		return
	}
	_ = s.store.AppendAudit(r.Context(), store.AuditEntry{
		Actor: s.actorOf(r), Action: store.AuditMembershipSettings, IP: clientIP(r),
		Detail: "enabled=" + strconv.FormatBool(*req.Enabled),
	})
	s.handleAdminGetMembershipSettings(w, r)
}

// membershipRowView is the raw store row for mutation responses (the computed
// view is built separately).
func membershipRowView(m store.Membership) map[string]any {
	return map[string]any{
		"user_id":         m.UserID,
		"expires_at":      m.ExpiresAt,
		"credits":         m.Credits,
		"unlimited":       m.Unlimited,
		"last_renewed_at": m.LastRenewedAt,
		"expired_at":      m.ExpiredAt,
	}
}
