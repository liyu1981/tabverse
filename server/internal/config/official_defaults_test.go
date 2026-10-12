//go:build officialserver

package config

import "testing"

// The official flavour is social-only by default: the address form and the
// email link are not part of it. TABVERSED_EMAIL_REGISTRATION can still turn it
// back on for a one-off run.
func TestDefaultEmailRegistrationIsOff(t *testing.T) {
	if defaultEmailRegistration {
		t.Fatalf("the official build should default email registration off")
	}
}
