//go:build !officialserver

package config

import "testing"

// A self-hosted build must not gate sync on a membership by default: a person
// running tabversed for themselves should not have to fund a subscription to
// use their own server. The switch is one env var away.
func TestDefaultMembershipDisabled(t *testing.T) {
	if defaultMembershipEnabled {
		t.Fatalf("a self-hosted build should not enable membership by default")
	}
}
