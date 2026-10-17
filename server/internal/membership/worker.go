package membership

import (
	"context"
	"fmt"
	"time"

	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// renewLead is how far ahead of expiry the worker renews a funded account, so a
// lease never lapses just because a funded account was not checked at the exact
// instant. One day is comfortably inside the shortest sensible period.
const renewLead = 24 * time.Hour

// purgeWarnLead is how far before closing the "your account will be closed"
// notice goes out.
const purgeWarnLead = 7 * 24 * time.Hour

// Run sweeps until ctx is cancelled. It runs once at startup as well, so a
// server that was down across an expiry deadline catches up immediately.
func (s *Service) Run(ctx context.Context, h *hub.Hub) {
	const interval = time.Hour
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	s.sweep(ctx, h)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweep(ctx, h)
		}
	}
}

func (s *Service) sweep(ctx context.Context, h *hub.Hub) {
	if !s.Enabled() {
		return
	}
	s.enrollAll(ctx)
	now := time.Now()
	s.renew(ctx, now)
	s.expire(ctx, now, h)
	s.warnAndClose(ctx, now)
}

func (s *Service) renew(ctx context.Context, now time.Time) {
	by := now.Add(renewLead).UnixMilli()
	due, err := s.store.DueForRenewal(ctx, by, s.cfg.MembershipPeriodCredits)
	if err != nil {
		s.log.Error("membership: renewal scan failed", "err", err)
		return
	}
	for _, m := range due {
		if s.exempt(ctx, m.UserID) {
			continue
		}
		renewed, err := s.store.RenewIfFunded(ctx, m.UserID,
			s.cfg.MembershipPeriodCredits, s.cfg.MembershipPeriod().Milliseconds())
		if err != nil {
			s.log.Error("membership: renewal failed", "user", m.UserID, "err", err)
			continue
		}
		if !renewed {
			continue
		}
		s.log.Info("membership: renewed", "user", m.UserID)
		_ = s.store.AppendAudit(ctx, store.AuditEntry{
			Target: m.UserID, Action: store.AuditMembershipRenewed,
			Detail: fmt.Sprintf("auto-renew, %d credits", s.cfg.MembershipPeriodCredits),
		})
	}
}

func (s *Service) expire(ctx context.Context, now time.Time, h *hub.Hub) {
	due, err := s.store.DueForExpiry(ctx, now.UnixMilli())
	if err != nil {
		s.log.Error("membership: expiry scan failed", "err", err)
		return
	}
	for _, m := range due {
		if s.exempt(ctx, m.UserID) {
			continue
		}
		if err := s.store.MarkExpired(ctx, m.UserID); err != nil {
			s.log.Error("membership: mark expired failed", "user", m.UserID, "err", err)
			continue
		}
		_ = s.store.AppendAudit(ctx, store.AuditEntry{
			Target: m.UserID, Action: store.AuditMembershipExpired,
			Detail: fmt.Sprintf("lease ended at %d", m.ExpiresAt),
		})
		s.notify(ctx, m.UserID, "Your Tabverse membership has expired",
			"Your membership has expired, so syncing has stopped. Your data is kept for "+
				fmt.Sprintf("%d days", s.cfg.MembershipRetentionDays)+
				". Sign in to the console to download a copy or renew.")
		if err := s.store.MarkExpiryNotified(ctx, m.UserID); err != nil {
			s.log.Error("membership: mark expiry notified failed", "user", m.UserID, "err", err)
		}
		// A stream is a notification channel that a request-time check cannot
		// reach, so the expiry pass closes it. The next sync request is refused
		// by the lease read regardless.
		h.CloseUser(m.UserID)
	}
}

func (s *Service) warnAndClose(ctx context.Context, now time.Time) {
	retentionMS := s.cfg.MembershipRetention().Milliseconds()

	// A closing notice goes out before the window ends, once per lapse.
	warnBy := now.Add(purgeWarnLead).UnixMilli()
	warn, err := s.store.DueForPurge(ctx, warnBy, retentionMS)
	if err != nil {
		s.log.Error("membership: purge warning scan failed", "err", err)
		return
	}
	for _, m := range warn {
		if s.exempt(ctx, m.UserID) || m.PurgeWarnedAt != 0 {
			continue
		}
		closeAt := time.UnixMilli(m.ExpiresAt + retentionMS).UTC().Format(time.RFC3339)
		s.notify(ctx, m.UserID, "Your Tabverse account will be closed",
			"Your membership expired and the retention window ends on "+closeAt+
				". Download your data from the console before then; the account and its data "+
				"will be removed after that.")
		if err := s.store.MarkPurgeWarned(ctx, m.UserID); err != nil {
			s.log.Error("membership: mark purge warned failed", "user", m.UserID, "err", err)
		}
	}

	if !s.cfg.MembershipAutoPurge {
		return
	}
	closeable, err := s.store.DueForPurge(ctx, now.UnixMilli(), retentionMS)
	if err != nil {
		s.log.Error("membership: purge scan failed", "err", err)
		return
	}
	for _, m := range closeable {
		if s.exempt(ctx, m.UserID) {
			continue
		}
		if err := s.store.DeleteUser(ctx, m.UserID); err != nil {
			s.log.Error("membership: close failed", "user", m.UserID, "err", err)
			continue
		}
		s.log.Info("membership: closed an expired account", "user", m.UserID)
		_ = s.store.AppendAudit(ctx, store.AuditEntry{
			Target: m.UserID, Action: store.AuditMembershipClosed,
			Detail: fmt.Sprintf("lease ended at %d, closed after %d days",
				m.ExpiresAt, s.cfg.MembershipRetentionDays),
		})
	}
}

// exempt reports whether an account must never be expired or closed: an
// operator, the configured root, or a row explicitly marked unlimited. The
// purge query already excludes the unlimited flag; this is the role and root
// half of the rule.
func (s *Service) exempt(ctx context.Context, userID string) bool {
	acc, err := s.store.AccountByID(ctx, userID)
	if err != nil {
		return true // cannot prove it is safe to act; leave it alone
	}
	return acc.Role == store.RoleAdmin || s.isRoot(acc)
}

func (s *Service) notify(ctx context.Context, userID, subject, body string) {
	if s.notifier == nil {
		return
	}
	acc, err := s.store.AccountByID(ctx, userID)
	if err != nil || acc.Email == "" {
		return
	}
	if err := s.notifier.SendMessage(acc.Email, subject, body); err != nil {
		s.log.Warn("membership: notice failed", "user", userID, "err", err)
	}
}
