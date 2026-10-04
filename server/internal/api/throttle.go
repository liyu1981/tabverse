package api

import (
	"sync"
	"time"
)

// A fixed-window throttle for the endpoints a stranger can reach.
//
// The one that matters is the sign-in link: it creates an account and sends
// mail, with nothing stopping a script from asking for a hundred of them. A
// fixed window is enough - the limit is "how many may a person ask for an hour",
// not "how many per second" - and it needs no storage: the counters live in the
// process, and a restart resetting them is not a risk worth a table.
type throttle struct {
	mu      sync.Mutex
	windows map[string]throttleWindow
	limit   int
	window  time.Duration
	// now is the clock, replaced in tests so the window can be closed without
	// sleeping through it.
	now func() time.Time
}

type throttleWindow struct {
	start time.Time
	count int
}

func newThrottle(limit int, window time.Duration) *throttle {
	return &throttle{
		windows: map[string]throttleWindow{},
		limit:   limit,
		window:  window,
		now:     time.Now,
	}
}

// allow reports whether key is under the limit, counting it if so.
func (t *throttle) allow(key string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	w := t.windows[key]
	if w.start.IsZero() || now.Sub(w.start) >= t.window {
		t.windows[key] = throttleWindow{start: now, count: 1}
		// A key that never comes back would live here for ever. This is a
		// console, the map is small, and the sweep only has to keep up.
		if len(t.windows) > 1024 {
			t.sweepLocked(now)
		}
		return true
	}
	w.count++
	t.windows[key] = w
	return w.count <= t.limit
}

// sweepLocked drops windows that have expired. Caller holds the lock.
func (t *throttle) sweepLocked(now time.Time) {
	for k, w := range t.windows {
		if now.Sub(w.start) >= t.window {
			delete(t.windows, k)
		}
	}
}
