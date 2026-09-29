// Package retention prunes old server side records (currently the periodic
// chrome session snapshots) and hands the job that used to run inside the
// extension's background service worker (chrome.idle based db audit) to the
// server, where it runs unconditionally regardless of browser state.
package retention

import (
	"context"
	"log/slog"
	"time"

	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// Run blocks until ctx is cancelled, sweeping every interval.
// A value of days <= 0 disables retention entirely.
func Run(ctx context.Context, st *store.Store, h *hub.Hub, days int, logger *slog.Logger) {
	if days <= 0 {
		logger.Info("server side retention disabled")
		return
	}
	interval := 6 * time.Hour
	if days == 1 {
		interval = time.Hour
	}
	logger.Info("retention started", "entity", "session", "days", days, "interval", interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	sweepOnce(ctx, st, h, days, logger) // run once at startup too
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepOnce(ctx, st, h, days, logger)
		}
	}
}

func sweepOnce(ctx context.Context, st *store.Store, h *hub.Hub, days int, logger *slog.Logger) {
	users, err := st.AllUserIDs(ctx)
	if err != nil {
		logger.Error("retention: list users failed", "err", err)
		return
	}
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	for _, userID := range users {
		n, err := st.PruneOlderThan(ctx, userID, "session", cutoff)
		if err != nil {
			logger.Error("retention: prune failed", "user", userID, "err", err)
			continue
		}
		if n > 0 {
			logger.Info("retention: tombstoned old sessions", "user", userID, "count", n)
			if rev, err := st.ServerRev(ctx, userID); err == nil {
				h.Publish(userID, hub.Message{
					Type: "records_changed", Rev: rev, Entities: []string{"session"},
					ServerAt: time.Now().UnixMilli(),
				})
			}
		}
	}
}
