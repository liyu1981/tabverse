// Package membership is the credit-funded lease of adr/0032: it decides whether
// an account may use the system right now, renews leases from credits, and
// closes accounts that have been expired past the retention window.
//
// Status is computed from the lease and the switch, never stored, so it cannot
// drift from the timestamps that define it.
package membership

import (
	"time"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// Status is the computed state of one account's membership.
type Status string

const (
	// StatusUnlimited means no lease applies: the master switch is off, the
	// account is an operator, it is the configured root, or it is explicitly
	// exempt.
	StatusUnlimited Status = "unlimited"
	// StatusActive means now < expires_at.
	StatusActive Status = "active"
	// StatusExpired means the lease has ended but the retention window has not,
	// so the account is a read-only tenant that can still download.
	StatusExpired Status = "expired"
	// StatusClosable means the retention window has passed and the account is
	// due (or waiting for an operator) to be closed.
	StatusClosable Status = "closable"
)

// StatusOf computes the status. It is a pure function so the boundaries can be
// pinned by a table test with no database:
//
//   - the switch off, an operator, or the configured root is unlimited;
//   - a row marked unlimited is unlimited;
//   - a never-opened lease (expires_at == 0) reads as expired when enabled;
//   - expires_at == now is expired; expires_at+retention == now is closable.
func StatusOf(now time.Time, m store.Membership, enabled bool, role string, root bool, retention time.Duration) Status {
	if !enabled || role == store.RoleAdmin || root || m.Unlimited {
		return StatusUnlimited
	}
	if m.ExpiresAt <= 0 {
		return StatusExpired
	}
	nowMS := now.UnixMilli()
	if nowMS < m.ExpiresAt {
		return StatusActive
	}
	if retention > 0 && nowMS < m.ExpiresAt+retention.Milliseconds() {
		return StatusExpired
	}
	return StatusClosable
}

// ReadOnly reports whether a status is the read-only console window: the account
// may look and download, but not write.
func (s Status) ReadOnly() bool {
	return s == StatusExpired || s == StatusClosable
}
