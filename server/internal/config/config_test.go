package config

import "testing"

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
