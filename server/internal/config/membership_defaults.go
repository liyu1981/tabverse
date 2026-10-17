//go:build !officialserver

package config

// defaultMembershipEnabled is off on a self-hosted build: a person running
// tabversed for themselves should not have to think about a subscription, and
// the switch is one variable away (TABVERSED_MEMBERSHIP_ENABLED) for an
// operator who wants it.
const defaultMembershipEnabled = false
