package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ErrBusy is returned when the user-database pool is at its cap and no slot
// frees within the wait budget. It is backpressure, not a failure: handlers map
// it to 503 + Retry-After and the client retries on its next cycle. A real
// EMFILE maps to the same outcome (ADR 0027, research doc §3.2).
var ErrBusy = errors.New("store busy")

// IsBusy reports whether an error is pool backpressure or OS descriptor
// exhaustion. Both are the same outcome to a caller: the server is at capacity
// and the API answers 503 + Retry-After rather than a generic failure.
func IsBusy(err error) bool {
	return errors.Is(err, ErrBusy) ||
		errors.Is(err, syscall.EMFILE) ||
		errors.Is(err, syscall.ENFILE)
}

var errPoolClosed = errors.New("user db pool closed")

// UserDBs is a bounded pool of open per-user content databases.
//
// The cap is the file-descriptor budget. A WAL SQLite file holds three
// descriptors while open (the file, its -wal and its -shm), so maxOpen is
// chosen well below RLIMIT_NOFILE minus the socket reserve. The pool is an LRU:
// opening a new account evicts the least-recently-used idle handle and closes
// it, releasing those descriptors. A handle in use by a request is never
// evicted; when every slot is in use, Acquire waits up to wait and then returns
// ErrBusy rather than growing an unbounded queue (ADR 0027).
type UserDBs struct {
	dir     string
	maxOpen int
	wait    time.Duration

	mu      sync.Mutex
	entries map[string]*userDBEntry
	clock   uint64
	notify  chan struct{}
	closed  bool
}

type userDBEntry struct {
	user     *UserDB
	refs     int
	lastUsed uint64
}

// NewUserDBs prepares the content directory and returns a pool. maxOpen <= 0
// and wait <= 0 fall back to conservative defaults.
func NewUserDBs(dir string, maxOpen int, wait time.Duration) (*UserDBs, error) {
	if maxOpen <= 0 {
		maxOpen = 64
	}
	if wait <= 0 {
		wait = 250 * time.Millisecond
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create user db dir: %w", err)
	}
	return &UserDBs{
		dir:     dir,
		maxOpen: maxOpen,
		wait:    wait,
		entries: map[string]*userDBEntry{},
		notify:  make(chan struct{}),
	}, nil
}

// path is the content file of one account. user ids are server-minted, but the
// shape is still checked so a future id cannot escape the directory.
func (us *UserDBs) path(id string) (string, error) {
	if id == "" || strings.ContainsAny(id, `/\`) || id == "." || id == ".." {
		return "", fmt.Errorf("invalid user id %q", id)
	}
	return filepath.Join(us.dir, id+".db"), nil
}

// Acquire returns the content database of one account and a release func that
// must be called when the request is done (defer). It returns ErrBusy when the
// cap is reached and no slot frees within the wait budget, or ctx.Err() when
// the caller gives up.
func (us *UserDBs) Acquire(ctx context.Context, id string) (*UserDB, func(), error) {
	path, err := us.path(id)
	if err != nil {
		return nil, nil, err
	}
	deadline := time.Now().Add(us.wait)

	for {
		us.mu.Lock()
		if us.closed {
			us.mu.Unlock()
			return nil, nil, errPoolClosed
		}
		if e, ok := us.entries[id]; ok {
			e.refs++
			us.clock++
			e.lastUsed = us.clock
			us.mu.Unlock()
			return e.user, us.release(id), nil
		}
		if len(us.entries) >= us.maxOpen {
			if victim := us.evictIdleLocked(); victim != nil {
				// Closing may report a checkpoint error; the descriptors are
				// released regardless and a stale file is re-migrated on open,
				// so a close error is not actionable here.
				_ = victim.Close()
			}
		}
		if len(us.entries) < us.maxOpen {
			// Opening runs migrations, so this holds the pool lock for the
			// duration of one file open. The files are small and this is the
			// same cost the central store pays once; if it ever shows up under
			// load, opening can move outside the lock behind a per-entry ready
			// channel.
			u, err := openUserDB(id, path)
			if err != nil {
				us.mu.Unlock()
				return nil, nil, err
			}
			us.clock++
			us.entries[id] = &userDBEntry{user: u, refs: 1, lastUsed: us.clock}
			us.mu.Unlock()
			return u, us.release(id), nil
		}
		// Cap reached and every entry is in use: wait for a release, but only
		// up to the budget.
		if !time.Now().Before(deadline) {
			us.mu.Unlock()
			return nil, nil, ErrBusy
		}
		ch := us.notify
		us.mu.Unlock()

		timer := time.NewTimer(time.Until(deadline))
		select {
		case <-ch:
			timer.Stop()
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return nil, nil, ctx.Err()
		}
	}
}

// release returns a once-only func that drops one reference and wakes waiters.
func (us *UserDBs) release(id string) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			us.mu.Lock()
			if e, ok := us.entries[id]; ok && e.refs > 0 {
				e.refs--
			}
			us.mu.Unlock()
			us.wake()
		})
	}
}

// evictIdleLocked closes nothing itself; it removes and returns the
// least-recently-used entry with no references so the caller can close it
// outside the map. Caller holds us.mu.
func (us *UserDBs) evictIdleLocked() *UserDB {
	victim := ""
	var oldest uint64
	for id, e := range us.entries {
		if e.refs > 0 {
			continue
		}
		if victim == "" || e.lastUsed < oldest {
			victim, oldest = id, e.lastUsed
		}
	}
	if victim == "" {
		return nil
	}
	u := us.entries[victim].user
	delete(us.entries, victim)
	return u
}

// wake broadcasts to Acquire waiters. Safe to call with or without us.mu held.
func (us *UserDBs) wake() {
	us.mu.Lock()
	close(us.notify)
	us.notify = make(chan struct{})
	us.mu.Unlock()
}

// Delete closes any open handle for the account and removes its content files.
// It is used by account deletion; a failure leaves an orphan that the ADR 0026
// sweep reaps, so callers may report it without having to retry.
func (us *UserDBs) Delete(id string) error {
	path, err := us.path(id)
	if err != nil {
		return err
	}
	us.mu.Lock()
	entry := us.entries[id]
	delete(us.entries, id)
	us.mu.Unlock()
	if entry != nil {
		_ = entry.user.Close()
	}

	var firstErr error
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Remove(path + suffix); err != nil && !os.IsNotExist(err) && firstErr == nil {
			firstErr = err
		}
	}
	us.wake()
	return firstErr
}

// Close closes the pool and every open content database. It is safe to call
// more than once; later calls are no-ops.
func (us *UserDBs) Close() error {
	us.mu.Lock()
	if us.closed {
		us.mu.Unlock()
		return nil
	}
	us.closed = true
	entries := us.entries
	us.entries = map[string]*userDBEntry{}
	close(us.notify)
	us.notify = make(chan struct{})
	us.mu.Unlock()

	var firstErr error
	for _, e := range entries {
		if err := e.user.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
