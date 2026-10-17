//go:build officialserver

package config

// defaultEmailRegistration is off on the official flavour: that deployment
// offers social logins only (Google and GitHub), so the address form and the
// email link are not part of it. TABVERSED_EMAIL_REGISTRATION can still turn it
// back on for a one-off run.
//
// This is one of the places the `officialserver` flag reaches Go (the other is
// membership_defaults_official.go). adr/0024 said the flag was read only by
// tools/embedsite.sh and the Docusaurus config; a build tag is how the binary
// itself can differ, without a second flag to keep in step.
const defaultEmailRegistration = false
