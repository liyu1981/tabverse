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
	// DeviceInactiveDays is how long a paired device must go without a
	// successful authentication before an operator may archive it (adr/0011).
	// 0 disables that check, leaving "has no usable token" as the only rule.
	DeviceInactiveDays int

	// --- accounts (adr/0012) ---

	// AuthMode is "off" (the default: the console keeps using the admin token
	// and the extension keeps pairing) or "accounts" (people register and sign
	// in to the console).
	AuthMode string
	// AuthSecret signs the console's session cookies. Empty means "generate
	// one on first boot and keep it in the database", so a self hosted
	// deployment needs no configuration to work.
	AuthSecret string
	// PublicURL is the address people reach the console on, used in the links
	// the email sender produces. It is also what the extension is told to use.
	PublicURL string
	// SecureCookies sets the Secure attribute on the session cookie. On by
	// default; turn it off only for plain http on a trusted LAN, and the server
	// says so in the log.
	SecureCookies bool
	// LinkByEmail links a social login to an existing account with the same
	// verified address. Off for a deployment that cannot vouch for its
	// providers, where such a login is refused instead.
	LinkByEmail bool
	// RequireEmailVerification refuses a session for an account whose address
	// has not been proven. The passwordless flow proves it on every login, so
	// this only matters for an account created by an operator.
	RequireEmailVerification bool
	// SMTPHost/Port/User/Pass/From send the verification and reset links. With
	// no SMTP host the links are logged instead, which is what a self hoster
	// running on a LAN usually wants.
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	SMTPFrom string
	// Social logins. Each pair enables one provider; an unset pair means that
	// button is not offered at all, rather than offered and broken.
	GitHubClientID     string
	GitHubClientSecret string
	GoogleClientID     string
	GoogleClientSecret string
	// OIDCIssuer and friends are accepted but NOT wired yet: the library's
	// "custom" provider speaks plain OAuth2 against a bespoke userinfo shape,
	// not OIDC discovery with id_token validation, and a login button that
	// half-works is worse than none. Set TABVERSED_OIDC_* and nothing happens
	// until adr/0012 is revisited; GitHub and Google are the supported social
	// logins.
	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string
	// DevMode enables the library's fake OAuth provider and prints login links
	// to the log, so the whole flow is testable with no SMTP and no provider
	// account. It is refused unless the address is loopback.
	DevMode bool
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
	// AdminToken gates the admin API and the web console: creating users,
	// minting their pairing codes, revoking devices/tokens and the read only
	// data browser. Empty (the default) disables all of it.
	//
	// Without it a deployment is single tenant: the bootstrap endpoint is
	// open until the first user exists, and after that only that user's own
	// devices can do anything (see adr/0009). With it, an admin provisions
	// any number of users and each user's data is reachable only through the
	// admin token.
	AdminToken string
}

// AdminEnabled reports whether the admin API and web console are available.
func (c Config) AdminEnabled() bool { return c.AdminToken != "" }

// AccountsEnabled reports whether people sign in to the console (adr/0012).
// The admin token stays available either way, as the break-glass path.
func (c Config) AccountsEnabled() bool { return c.AuthMode == "accounts" }

// SocialProviders lists the configured social logins, for the console's login
// buttons. An unconfigured provider is simply absent: a button that cannot work
// is worse than no button.
func (c Config) SocialProviders() []string {
	var out []string
	if c.GitHubClientID != "" {
		out = append(out, "github")
	}
	if c.GoogleClientID != "" {
		out = append(out, "google")
	}
	if c.OIDCIssuer != "" {
		out = append(out, "sso")
	}
	return out
}

// SMTPConfigured reports whether verification links can actually be sent. With
// no SMTP host the sender logs the link instead, which is the sane behaviour
// for a LAN-only deployment.
func (c Config) SMTPConfigured() bool { return c.SMTPHost != "" }

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

// GetenvEnum reads a value constrained to a fixed set, so a typo is a startup
// error rather than a silently disabled feature.
func GetenvEnum(name, fallback string, allowed ...string) (string, error) {
	v := os.Getenv(name)
	if v == "" {
		return fallback, nil
	}
	for _, a := range allowed {
		if v == a {
			return v, nil
		}
	}
	return "", fmt.Errorf("%s: %q is not one of %v", name, v, allowed)
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
		AdminToken:     Getenv("TABVERSED_ADMIN_TOKEN", ""),
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
	if cfg.DeviceInactiveDays, err = GetenvInt("TABVERSED_DEVICE_INACTIVE_DAYS", 30); err != nil {
		return Config{}, err
	}
	if cfg.AuthMode, err = GetenvEnum("TABVERSED_AUTH", "off", "off", "accounts"); err != nil {
		return Config{}, err
	}
	cfg.AuthSecret = Getenv("TABVERSED_AUTH_SECRET", "")
	cfg.PublicURL = Getenv("TABVERSED_PUBLIC_URL", "")
	if cfg.SecureCookies, err = GetenvBool("TABVERSED_SECURE_COOKIES", true); err != nil {
		return Config{}, err
	}
	if cfg.LinkByEmail, err = GetenvBool("TABVERSED_LINK_BY_EMAIL", true); err != nil {
		return Config{}, err
	}
	if cfg.RequireEmailVerification, err = GetenvBool("TABVERSED_REQUIRE_EMAIL_VERIFICATION", true); err != nil {
		return Config{}, err
	}
	cfg.SMTPHost = Getenv("TABVERSED_SMTP_HOST", "")
	if cfg.SMTPPort, err = GetenvInt("TABVERSED_SMTP_PORT", 25); err != nil {
		return Config{}, err
	}
	cfg.SMTPUser = Getenv("TABVERSED_SMTP_USER", "")
	cfg.SMTPPass = Getenv("TABVERSED_SMTP_PASS", "")
	cfg.SMTPFrom = Getenv("TABVERSED_SMTP_FROM", "")
	if cfg.DevMode, err = GetenvBool("TABVERSED_DEV_MODE", false); err != nil {
		return Config{}, err
	}
	cfg.GitHubClientID = Getenv("TABVERSED_GITHUB_CLIENT_ID", "")
	cfg.GitHubClientSecret = Getenv("TABVERSED_GITHUB_CLIENT_SECRET", "")
	cfg.GoogleClientID = Getenv("TABVERSED_GOOGLE_CLIENT_ID", "")
	cfg.GoogleClientSecret = Getenv("TABVERSED_GOOGLE_CLIENT_SECRET", "")
	cfg.OIDCIssuer = Getenv("TABVERSED_OIDC_ISSUER", "")
	cfg.OIDCClientID = Getenv("TABVERSED_OIDC_CLIENT_ID", "")
	cfg.OIDCClientSecret = Getenv("TABVERSED_OIDC_CLIENT_SECRET", "")

	if (cfg.GitHubClientID == "") != (cfg.GitHubClientSecret == "") {
		return Config{}, fmt.Errorf("TABVERSED_GITHUB_CLIENT_ID and _SECRET go together")
	}
	if (cfg.GoogleClientID == "") != (cfg.GoogleClientSecret == "") {
		return Config{}, fmt.Errorf("TABVERSED_GOOGLE_CLIENT_ID and _SECRET go together")
	}
	if (cfg.OIDCIssuer == "") != (cfg.OIDCClientID == "") {
		return Config{}, fmt.Errorf("TABVERSED_OIDC_ISSUER, _CLIENT_ID and _SECRET go together")
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
