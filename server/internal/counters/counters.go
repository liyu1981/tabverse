// Package counters keeps the ADR 0026 cross-user counter cache fresh.
//
// It is a background relay, not a queue: a content write marks its account dirty
// in the central database, this drains those markers on a tick, and a
// long-cadence full sweep recomputes every account and reaps orphan content
// files. The console reads only the cache, so its request path never opens a
// user database for a tally.
package counters

import (
	"context"
	"log/slog"
	"time"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// Run blocks until ctx is cancelled, draining dirty counters every interval and
// doing a full sweep every fullSweepEvery ticks.
func Run(ctx context.Context, st *store.Store, interval time.Duration, fullSweepEvery int, logger *slog.Logger) {
	if interval <= 0 {
		interval = time.Minute
	}
	if fullSweepEvery <= 0 {
		fullSweepEvery = 15
	}
	logger.Info("counter relay started", "interval", interval, "full_sweep_every", fullSweepEvery)

	// A fresh process has an empty cache; build it before the first tick so the
	// console is not blank after a restart.
	if n, err := st.RecomputeAllCounters(ctx); err != nil {
		logger.Error("counters: initial sweep failed", "err", err)
	} else {
		logger.Info("counters: initial sweep done", "accounts", n)
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	ticks := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := st.DrainDirtyCounters(ctx, 500); err != nil {
				logger.Error("counters: drain failed", "err", err)
			} else if n > 0 {
				logger.Debug("counters: refreshed", "accounts", n)
			}
			ticks++
			if ticks%fullSweepEvery != 0 {
				continue
			}
			if n, err := st.RecomputeAllCounters(ctx); err != nil {
				logger.Error("counters: full sweep failed", "err", err)
			} else {
				logger.Info("counters: full sweep done", "accounts", n)
			}
		}
	}
}
