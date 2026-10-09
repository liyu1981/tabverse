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
	// RequireHTTPS refuses to start when the console is served over plain http
	// on anything but loopback. Off by default, because a LAN deployment on
	// http://192.168.x.x is a supported shape and this would break it on
	// upgrade; the server warns about that case either way (see New).
	RequireHTTPS bool
	// FrameAncestors is the CSP `frame-ancestors` source list for the console,
	// i.e. who is allowed to put it in an iframe. The default is
	// `chrome-extension:`, because the Tabverse extension shows the console in
	// a side panel (adr/0025) and an installed extension is already trusted to
	// read the same cookies through its host permissions - while a web page
	// still cannot frame it, which is what `frame-ancestors` defends against.
	// `'none'` restores the refusal, and `chrome-extension://<id>` narrows it
	// to one extension.
	FrameAncestors string
	// SessionTTL is how long one console sign-in lasts. 0 disables the
	// server-side bound, which is the pre-hardening behaviour (a session that
	// slides for as long as it is used) and should only be wanted on a LAN.
	SessionTTL time.Duration
	// SessionCookieTTL is how long the browser is told to keep the session
	// cookie. Unset means the same as SessionTTL, so the credential disappears
	// from the machine at the moment the server stops honouring it rather than
	// sitting on disk for weeks afterwards.
	SessionCookieTTL time.Duration
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
	// --- accounts (adr/0013) ---
	// The console has no master credential: it is always served, and every
	// route needs a signed-in account (adr/0013). These are what remain.

	// AdminEmail is the address whose first registration becomes the operator.
	// It is the whole bootstrap: there is no secret to lose, no token to
	// rotate, and once an operator exists it grants nothing.
	AdminEmail string
}

// SocialProviders lists the social logins the console may offer, which is the
// ones this server actually wired. An unconfigured provider is simply absent: a
// button that cannot work is worse than no button.
//
// OIDC is deliberately absent even when TABVERSED_OIDC_* is set. Those variables
// are accepted and inert (see the OIDCIssuer comment above), no provider is
// registered under that name, and listing it here produced a sign-in button that
// answered 404 - which is the other half of "worse than no button". It comes
// back when adr/0012 gives it a write path.
func (c Config) SocialProviders() []string {
	out := []string{}
	if c.GitHubClientID != "" {
		out = append(out, "github")
	}
	if c.GoogleClientID != "" {
		out = append(out, "google")
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

// GetenvDuration reads a duration in Go's own notation ("90m", "24h", "0"), so
// the session lifetimes are readable rather than being seconds in an integer.
func GetenvDuration(name string, fallback time.Duration) (time.Duration, error) {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", name, err)
	}
	if d < 0 {
		return 0, fmt.Errorf("%s: must not be negative", name)
	}
	return d, nil
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
	cfg.AdminEmail = strings.ToLower(strings.TrimSpace(Getenv("TABVERSED_ADMIN_EMAIL", "")))
	cfg.AuthSecret = Getenv("TABVERSED_AUTH_SECRET", "")
	cfg.PublicURL = Getenv("TABVERSED_PUBLIC_URL", "")
	if cfg.SecureCookies, err = GetenvBool("TABVERSED_SECURE_COOKIES", true); err != nil {
		return Config{}, err
	}
	if cfg.RequireHTTPS, err = GetenvBool("TABVERSED_REQUIRE_HTTPS", false); err != nil {
		return Config{}, err
	}
	// A response header is being built from this value, so the length of a
	// line is not the operator's to decide: a CR or LF here would be header
	// injection, and the value itself has no reason to contain one.
	// A response header is being built from this value, so the length of a line
	// is not the operator's to decide: a CR or LF here would be header
	// injection, and the value itself has no reason to contain one. Empty is
	// unset, like every other variable in this config, so a variable cleared by
	// accident gets the shipped default rather than an empty directive;
	// `'none'` is how an operator refuses.
	cfg.FrameAncestors = strings.TrimSpace(Getenv("TABVERSED_FRAME_ANCESTORS", "chrome-extension:"))
	if strings.ContainsAny(cfg.FrameAncestors, "\r\n\x00") {
		return Config{}, fmt.Errorf("TABVERSED_FRAME_ANCESTORS must be one CSP source list, without line breaks")
	}
	if cfg.SessionTTL, err = GetenvDuration("TABVERSED_SESSION_TTL", 24*time.Hour); err != nil {
		return Config{}, err
	}
	// The cookie outlives the token by exactly as much as it is asked to: unset
	// means "the same", so the default cannot drift apart from SessionTTL.
	if cfg.SessionCookieTTL, err = GetenvDuration("TABVERSED_SESSION_COOKIE_TTL", cfg.SessionTTL); err != nil {
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
