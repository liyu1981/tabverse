package config

import (
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load("test")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	// The default binds every interface on 8223: the extension is usually
	// loaded on a different machine than the server while developing.
	if cfg.Addr != "0.0.0.0:8223" {
		t.Errorf("Addr = %q, want 0.0.0.0:8223", cfg.Addr)
	}
	if cfg.DBPath != "data/tabversed.db" {
		t.Errorf("DBPath = %q, want data/tabversed.db", cfg.DBPath)
	}
	if cfg.RetentionDays != 14 {
		t.Errorf("RetentionDays = %d, want 14", cfg.RetentionDays)
	}
	if cfg.MaxRecordBytes != 1<<20 {
		t.Errorf("MaxRecordBytes = %d, want %d", cfg.MaxRecordBytes, 1<<20)
	}
}

func TestExposed(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"0.0.0.0:8223", true},
		{":8223", true}, // Go's shorthand is all interfaces
		{"[::]:8223", true},
		{"127.0.0.1:8223", false},
		{"localhost:8223", false},
		{"[::1]:8223", false},
		{"192.168.1.10:8223", true},
		{"nonsense", false}, // the listen call reports this properly
	}
	for _, tt := range tests {
		cfg := Config{Addr: tt.addr}
		if got := cfg.Exposed(); got != tt.want {
			t.Errorf("Exposed(%q) = %v, want %v", tt.addr, got, tt.want)
		}
	}
}

// The session lifetimes are configuration, and the default is the whole point:
// a cookie that outlives its session leaves a credential on a shared machine
// that the server has already stopped honouring (adr/0021).
func TestSessionLifetimesDefaultToTheSameNumber(t *testing.T) {
	t.Setenv("TABVERSED_SESSION_TTL", "")
	cfg, err := Load("test")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.SessionTTL != 24*time.Hour {
		t.Errorf("SessionTTL = %v, want 24h", cfg.SessionTTL)
	}
	if cfg.SessionCookieTTL != cfg.SessionTTL {
		t.Errorf("SessionCookieTTL = %v, want the same as SessionTTL (%v)",
			cfg.SessionCookieTTL, cfg.SessionTTL)
	}
}

func TestSessionLifetimesAreConfigurable(t *testing.T) {
	t.Setenv("TABVERSED_SESSION_TTL", "90m")
	t.Setenv("TABVERSED_SESSION_COOKIE_TTL", "2h")
	cfg, err := Load("test")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.SessionTTL != 90*time.Minute {
		t.Errorf("SessionTTL = %v, want 1h30m", cfg.SessionTTL)
	}
	if cfg.SessionCookieTTL != 2*time.Hour {
		t.Errorf("SessionCookieTTL = %v, want 2h", cfg.SessionCookieTTL)
	}
}

// 0 is a real setting ("this deployment does not want a bound"), so it must not
// be read as "unset" and must not be refused as nonsense.
func TestSessionTTLZeroIsAccepted(t *testing.T) {
	t.Setenv("TABVERSED_SESSION_TTL", "0")
	cfg, err := Load("test")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.SessionTTL != 0 {
		t.Errorf("SessionTTL = %v, want 0", cfg.SessionTTL)
	}
}

func TestSessionTTLGarbageIsRefused(t *testing.T) {
	t.Setenv("TABVERSED_SESSION_TTL", "next tuesday")
	if _, err := Load("test"); err == nil {
		t.Fatal("a duration that is not one should be a startup error")
	}
	t.Setenv("TABVERSED_SESSION_TTL", "-1h")
	if _, err := Load("test"); err == nil {
		t.Fatal("a negative session lifetime should be a startup error")
	}
}

// Refusing to serve the console over plain http is opt-in, so the default must
// leave an existing LAN deployment alone.
func TestRequireHTTPSDefaultsOff(t *testing.T) {
	t.Setenv("TABVERSED_REQUIRE_HTTPS", "")
	cfg, err := Load("test")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RequireHTTPS {
		t.Error("RequireHTTPS should default to false")
	}
}
