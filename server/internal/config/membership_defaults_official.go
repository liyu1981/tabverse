//go:build officialserver

package config

// defaultMembershipEnabled is on for the official flavour: that deployment is
// the one that charges for sync, and a build that forgot to turn the switch on
// would quietly give the product away. TABVERSED_MEMBERSHIP_ENABLED can still
// turn it off for a one-off run.
const defaultMembershipEnabled = true
