// Package version carries build information injected through -ldflags.
package version

// Version is the binary version. Overridden at build time:
//
//	go build -ldflags "-X github.com/liyu1981/tabverse/server/internal/version.Version=v1.2.3"
var Version = "dev"
