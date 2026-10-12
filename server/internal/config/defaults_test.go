//go:build !officialserver

package config

import "testing"

// A self-hosted build offers the passwordless email path by default: a
// deployment with no social provider and no mail server still logs the sign-in
// link, and a deployment with neither would otherwise have no way in.
func TestDefaultEmailRegistrationIsOn(t *testing.T) {
	if !defaultEmailRegistration {
		t.Fatalf("a self-hosted build should offer email registration by default")
	}
}
