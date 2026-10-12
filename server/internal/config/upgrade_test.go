package config

import (
	"strings"
	"testing"
)

func TestUpgradeEnvFileMovesValuesOntoTheTemplate(t *testing.T) {
	old := `
# my old settings
TABVERSED_ADDR=127.0.0.1:9000
TABVERSED_AUTH_SECRET=s3cret
TABVERSED_GONE=keep-me
`
	template := []byte("# settings\n#TABVERSED_ADDR=0.0.0.0:8223\n#TABVERSED_AUTH_SECRET=\n#TABVERSED_NEW=default\n")
	got, err := UpgradeEnvFile(old, template)
	if err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	if !strings.Contains(got, "TABVERSED_ADDR=127.0.0.1:9000\n") {
		t.Fatalf("addr not moved:\n%s", got)
	}
	if !strings.Contains(got, "TABVERSED_AUTH_SECRET=s3cret\n") {
		t.Fatalf("secret not moved:\n%s", got)
	}
	// A variable the template added stays commented out until somebody sets it.
	if !strings.Contains(got, "#TABVERSED_NEW=default\n") {
		t.Fatalf("a new variable should stay commented:\n%s", got)
	}
	// A variable the template no longer documents is kept, not dropped.
	if !strings.Contains(got, "TABVERSED_GONE=keep-me") {
		t.Fatalf("a removed variable should be kept:\n%s", got)
	}
}

func TestUpgradeEnvFileRejectsABrokenFile(t *testing.T) {
	if _, err := UpgradeEnvFile("not a setting\n", []byte("#TABVERSED_ADDR=\n")); err == nil {
		t.Fatalf("expected an error for a file the parser cannot read")
	}
}

func TestUpgradeEnvFileQuotesSurroundingSpace(t *testing.T) {
	// The parser trims an unquoted value, so a value that had surrounding space
	// has to be quoted to survive the round trip.
	got, err := UpgradeEnvFile("TABVERSED_SMTP_FROM=\"  spaced  \"\n", []byte("#TABVERSED_SMTP_FROM=\n"))
	if err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	if !strings.Contains(got, "TABVERSED_SMTP_FROM=\"  spaced  \"") {
		t.Fatalf("a spaced value should be quoted:\n%s", got)
	}
}
