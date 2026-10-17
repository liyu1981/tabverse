//go:build officialserver

package config

import "testing"

// The official flavour charges for sync, so a build that forgot the switch would
// quietly give the product away. It defaults on; the env can still turn it off.
func TestOfficialDefaultMembershipEnabled(t *testing.T) {
	if !defaultMembershipEnabled {
		t.Fatalf("the official build should enable membership by default")
	}
}
