package membership

import (
	"testing"
	"time"

	"github.com/liyu1981/tabverse/server/internal/store"
)

func TestStatusOf(t *testing.T) {
	now := time.Now()
	const day = 24 * time.Hour
	expired := now.Add(-day)
	active := now.Add(day)

	tests := []struct {
		name      string
		m         store.Membership
		enabled   bool
		role      string
		root      bool
		retention time.Duration
		want      Status
	}{
		{"switch off is unlimited", store.Membership{ExpiresAt: expired.UnixMilli()}, false, store.RoleUser, false, 90 * day, StatusUnlimited},
		{"operator is unlimited", store.Membership{ExpiresAt: expired.UnixMilli()}, true, store.RoleAdmin, false, 90 * day, StatusUnlimited},
		{"root is unlimited", store.Membership{ExpiresAt: expired.UnixMilli()}, true, store.RoleUser, true, 90 * day, StatusUnlimited},
		{"exempt row is unlimited", store.Membership{ExpiresAt: expired.UnixMilli(), Unlimited: true}, true, store.RoleUser, false, 90 * day, StatusUnlimited},
		{"never opened is expired", store.Membership{}, true, store.RoleUser, false, 90 * day, StatusExpired},
		{"future lease is active", store.Membership{ExpiresAt: active.UnixMilli()}, true, store.RoleUser, false, 90 * day, StatusActive},
		{"lease end is expired", store.Membership{ExpiresAt: now.UnixMilli()}, true, store.RoleUser, false, 90 * day, StatusExpired},
		{"inside retention is expired", store.Membership{ExpiresAt: now.Add(-89 * day).UnixMilli()}, true, store.RoleUser, false, 90 * day, StatusExpired},
		{"retention boundary is closable", store.Membership{ExpiresAt: now.Add(-90 * day).UnixMilli()}, true, store.RoleUser, false, 90 * day, StatusClosable},
		{"past retention is closable", store.Membership{ExpiresAt: now.Add(-91 * day).UnixMilli()}, true, store.RoleUser, false, 90 * day, StatusClosable},
		{"zero retention is closable at once", store.Membership{ExpiresAt: expired.UnixMilli()}, true, store.RoleUser, false, 0, StatusClosable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := StatusOf(now, tc.m, tc.enabled, tc.role, tc.root, tc.retention)
			if got != tc.want {
				t.Fatalf("StatusOf = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestReadOnly(t *testing.T) {
	if StatusActive.ReadOnly() || StatusUnlimited.ReadOnly() {
		t.Fatal("active and unlimited must not be read-only")
	}
	if !StatusExpired.ReadOnly() || !StatusClosable.ReadOnly() {
		t.Fatal("expired and closable must be read-only")
	}
}
