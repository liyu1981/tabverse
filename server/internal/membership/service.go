package membership

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// SettingEnabled is the server_settings key of the master switch. Its presence
// is the runtime truth; config.MembershipEnabled only seeds it on first boot.
const SettingEnabled = "membership_enabled"

// Notifier delivers lifecycle mail. accounts.Service satisfies it. It is an
// interface so the worker can run with a logger in tests.
type Notifier interface {
	SendMessage(dest, subject, body string) error
}

// Service owns the master switch and answers membership questions for the API.
type Service struct {
	cfg   config.Config
	store *store.Store
	log   *slog.Logger

	mu      sync.RWMutex
	enabled bool
	seeded  bool

	notifier Notifier
}

// New loads the master switch. An existing server_settings value wins; on a
// fresh deployment the configured default is written once, so the console and
// the operator agree from the first boot.
func New(cfg config.Config, st *store.Store, logger *slog.Logger) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Service{cfg: cfg, store: st, log: logger}
	ctx := context.Background()
	if v, ok, err := st.SettingBool(ctx, SettingEnabled); err != nil {
		return nil, fmt.Errorf("read membership setting: %w", err)
	} else if ok {
		s.enabled = v
	} else {
		s.enabled = cfg.MembershipEnabled
		if err := st.PutSetting(ctx, SettingEnabled, strconv.FormatBool(s.enabled), ""); err != nil {
			return nil, fmt.Errorf("seed membership setting: %w", err)
		}
	}
	return s, nil
}

// Enabled reports the master switch. A request path calls this, so it is cheap.
func (s *Service) Enabled() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.enabled
}

// SetEnabled flips the master switch and persists it. Turning it on enrolls any
// account that has never had a membership row, so enabling the system does not
// lock an existing deployment out.
func (s *Service) SetEnabled(ctx context.Context, enabled bool, actor string) error {
	s.mu.Lock()
	s.enabled = enabled
	s.mu.Unlock()
	if err := s.store.PutSetting(ctx, SettingEnabled, strconv.FormatBool(enabled), actor); err != nil {
		return err
	}
	if enabled {
		s.enrollAll(ctx)
	}
	return nil
}

// SetNotifier wires lifecycle mail. Called by api.New once the account layer
// (which owns the sender) exists.
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

// Decision is the answer to "may this account use the system right now".
type Decision struct {
	Status         Status
	ExpiresAt      int64
	RetentionUntil int64
	Credits        int64
	PeriodDays     int
}

// Allowed reports whether a decision permits sync.
func (d Decision) Allowed() bool {
	return d.Status == StatusActive || d.Status == StatusUnlimited
}

// DecisionFor resolves an account's membership. The account row is needed for
// its role and address, which is how an operator and the configured root are
// recognised.
func (s *Service) DecisionFor(ctx context.Context, userID string) (Decision, error) {
	acc, err := s.store.AccountByID(ctx, userID)
	if err != nil {
		return Decision{}, err
	}
	m, err := s.store.Membership(ctx, userID)
	if err != nil && err != store.ErrNotFound {
		return Decision{}, err
	}
	root := s.isRoot(acc)
	d := Decision{
		Status:     StatusOf(time.Now(), m, s.Enabled(), acc.Role, root, s.cfg.MembershipRetention()),
		ExpiresAt:  m.ExpiresAt,
		Credits:    m.Credits,
		PeriodDays: s.cfg.MembershipPeriodDays,
	}
	if m.ExpiresAt > 0 {
		d.RetentionUntil = m.ExpiresAt + s.cfg.MembershipRetention().Milliseconds()
	}
	return d, nil
}

// isRoot reports whether an account is the configured break-glass address. That
// account is always unlimited and never closed, whatever its role.
func (s *Service) isRoot(acc store.Account) bool {
	return s.IsRootEmail(acc.Email)
}

// IsRootEmail reports whether an address is the configured root. It is exported
// so the operator surface can refuse to demote or close that account.
func (s *Service) IsRootEmail(email string) bool {
	return s.cfg.AdminEmail != "" && strings.EqualFold(strings.TrimSpace(email), s.cfg.AdminEmail)
}

// GrantTrial opens the single onboarding grant for an account. Idempotent.
func (s *Service) GrantTrial(ctx context.Context, userID string) error {
	_, err := s.store.GrantTrial(ctx, userID, s.cfg.MembershipTrialCredits,
		s.cfg.MembershipPeriodCredits, s.cfg.MembershipPeriod().Milliseconds())
	return err
}

// enrollAll gives the trial to every account that has no membership row, once.
// It runs when the switch is first turned on and at worker startup, so a
// deployment becoming paid does not expire everybody at the same instant.
func (s *Service) enrollAll(ctx context.Context) {
	s.mu.Lock()
	if s.seeded {
		s.mu.Unlock()
		return
	}
	s.seeded = true
	s.mu.Unlock()

	ids, err := s.store.AllUserIDs(ctx)
	if err != nil {
		s.log.Error("membership: list accounts failed", "err", err)
		return
	}
	granted := 0
	for _, id := range ids {
		if _, err := s.store.Membership(ctx, id); err == nil {
			continue
		} else if err != store.ErrNotFound {
			s.log.Error("membership: read failed", "user", id, "err", err)
			continue
		}
		if err := s.GrantTrial(ctx, id); err != nil {
			s.log.Error("membership: enrollment failed", "user", id, "err", err)
			continue
		}
		granted++
	}
	if granted > 0 {
		s.log.Info("membership: granted the onboarding trial", "accounts", granted)
	}
}
