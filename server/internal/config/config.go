package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime configuration for tabversed.
//
// Everything is environment driven so the server can be deployed as a single
// static binary (systemd, docker, cross-compiled artifacts) without files.
type Config struct {
	// Addr is the listen address, e.g. "0.0.0.0:8223".
	Addr string
	// DBPath is the path to the SQLite database file.
	DBPath string
	// RetentionDays controls how long chrome session snapshots are kept.
	// 0 disables server side retention.
	RetentionDays int
	// MaxRecordBytes limits the size of one record payload.
	MaxRecordBytes int64
	// SyncBatchLimit is the max number of records per sync response/push.
	SyncBatchLimit int
	// SearchLimit is the max number of search hits returned.
	SearchLimit int
	// Version is injected at build time via ldflags.
	Version string
	// WSOrigins is the optional comma separated allow list of websocket
	// Origin patterns (e.g. "chrome-extension://abcdefgh,https://app.example").
	// Empty means any origin may connect; authentication with a bearer token
	// is still mandatory before the upgrade succeeds.
	WSOrigins []string
}

func Getenv(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func GetenvInt(name string, fallback int) (int, error) {
	v := os.Getenv(name)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", name, err)
	}
	return n, nil
}

func GetenvBool(name string, fallback bool) (bool, error) {
	v := os.Getenv(name)
	if v == "" {
		return fallback, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: %w", name, err)
	}
	return b, nil
}

// DefaultAddr binds every interface on purpose: the extension is usually
// loaded on another machine than the server during development, and Go's
// ":port" shorthand already means all interfaces. The exposure warning in
// main.go covers the risk that comes with it (see ADR 0002: the bootstrap
// endpoint belongs to whoever pairs first).
const DefaultAddr = "0.0.0.0:8223"

// Load reads configuration from the environment.
func Load(version string) (Config, error) {
	cfg := Config{
		Addr:           Getenv("TABVERSED_ADDR", DefaultAddr),
		DBPath:         Getenv("TABVERSED_DB", "data/tabversed.db"),
		Version:        version,
		MaxRecordBytes: 1 << 20, // 1 MiB
		SyncBatchLimit: 500,
		SearchLimit:    50,
	}

	var err error
	if cfg.RetentionDays, err = GetenvInt("TABVERSED_RETENTION_DAYS", 14); err != nil {
		return Config{}, err
	}
	if v, err := GetenvInt("TABVERSED_MAX_RECORD_BYTES", int(cfg.MaxRecordBytes)); err != nil {
		return Config{}, err
	} else {
		cfg.MaxRecordBytes = int64(v)
	}
	if cfg.SyncBatchLimit, err = GetenvInt("TABVERSED_SYNC_BATCH_LIMIT", cfg.SyncBatchLimit); err != nil {
		return Config{}, err
	}
	if cfg.SearchLimit, err = GetenvInt("TABVERSED_SEARCH_LIMIT", cfg.SearchLimit); err != nil {
		return Config{}, err
	}
	if origins := Getenv("TABVERSED_WS_ORIGINS", ""); origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if o = strings.TrimSpace(o); o != "" {
				cfg.WSOrigins = append(cfg.WSOrigins, o)
			}
		}
	}
	return cfg, nil
}

// RetentionWindow is the age after which entity records are pruned.
func (c Config) RetentionWindow() time.Duration {
	return time.Duration(c.RetentionDays) * 24 * time.Hour
}

// Exposed reports whether the server listens on something other than a
// loopback address, i.e. whether it is reachable from other machines.
func (c Config) Exposed() bool {
	host, _, err := net.SplitHostPort(c.Addr)
	if err != nil {
		// Unparseable address: the listen call will fail with a better message.
		return false
	}
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		return true
	case "localhost":
		return false
	default:
		// A name we cannot resolve is treated as exposed: the warning is
		// cheap, a missed exposure is not.
		ip := net.ParseIP(host)
		return ip == nil || !ip.IsLoopback()
	}
}
