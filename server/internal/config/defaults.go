//go:build !officialserver

package config

// defaultEmailRegistration is the passwordless email path's default on a
// self-hosted build: on, because a deployment with no social provider and no
// mail server still logs the sign-in link, and a deployment with neither would
// otherwise have no way in at all.
const defaultEmailRegistration = true
