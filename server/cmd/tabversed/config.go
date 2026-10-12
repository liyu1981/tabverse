package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	_ "embed"

	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/version"
)

// envExample is the settings template, embedded so "tabversed config" works on a
// machine that has nothing but the binary: no source tree to check out, and the
// template that ships is the one the repository documents.
//
// It is a copy of server/.env.example - go:embed's pattern may not walk out of
// the package directory - and TestTemplateMatchesTheRepositoryCopy fails the
// build if the two ever drift.
//
//go:embed .env.example
var envExample []byte

// homeDirHint is the directory a service install will read, named in the help so
// "config here, install there" cannot quietly produce a unit with no settings.
func homeDirHint() string {
	dir, err := serviceDir()
	if err != nil {
		return "~"
	}
	return dir
}

// printVersion answers "which binary is this", which is the first question
// anybody asks a server they are trying to pin down.
func printVersion() error {
	v := version.Version
	if v == "" {
		v = "dev"
	}
	fmt.Fprintf(os.Stdout, "tabversed %s (%s/%s, %s)\n",
		v, runtime.GOOS, runtime.GOARCH, runtime.Version())
	return nil
}

// configCommand writes the template as a .env for this machine.
//
// Refusing to replace an existing file is the point: .env holds the auth secret
// and the OAuth client secret, and "tabversed config" is the kind of command
// people re-run to be reminded what the options are.
func configCommand(args []string) error {
	fs := flag.NewFlagSet("config", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	force := fs.Bool("force", false, "replace an existing .env")
	upgrade := fs.Bool("upgrade", false,
		"merge an existing .env into the current template (backing it up first)")
	dir := fs.String("dir", ".", "directory to write it into")
	if err := fs.Parse(args); err != nil {
		return errUsage
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("config takes flags only, got %q", fs.Arg(0))
	}

	target := filepath.Join(*dir, ".env")
	if *upgrade {
		return upgradeConfig(target)
	}
	switch _, err := os.Stat(target); {
	case err == nil && !*force:
		return fmt.Errorf("%s already exists; edit it, or pass --force to replace it", target)
	case err != nil && !os.IsNotExist(err):
		return err
	}
	// A file that does not end in a newline is a trap: appending to it (which is
	// the first thing anybody does) glues the addition onto the last line, and a
	// commented-out default then swallows the setting silently. The template is
	// fixed, but the guarantee belongs here rather than in the file's last byte.
	body := envExample
	if len(body) == 0 || body[len(body)-1] != '\n' {
		body = append(append([]byte{}, body...), '\n')
	}
	// 0600 from the start: this file is going to hold the session signing key
	// and the OAuth client secret, and a settings file that is briefly world
	// readable is the most common way a self-hosted secret leaks.
	if err := os.WriteFile(target, body, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", target, err)
	}
	fmt.Fprintf(os.Stdout, "wrote %s\n\n", target)
	fmt.Fprintln(os.Stdout, "edit it - every variable is documented in the file - then either:")
	fmt.Fprintln(os.Stdout, "  tabversed serve            run it in the foreground")
	fmt.Fprintln(os.Stdout, "  tabversed service install  run it as a systemd user service")
	fmt.Fprintf(os.Stdout, "\n(a service reads its .env from %s/.tabversed, so install\n", homeDirHint())
	fmt.Fprintln(os.Stdout, " it with --dir or write the file there)")
	return nil
}

// upgradeConfig rewrites an existing .env from the current template, keeping the
// settings it already had.
//
// The old file is backed up first, because the one thing an upgrade must not do
// is lose the session signing key or an OAuth secret. Then the template is the
// skeleton and the old values are moved onto it (`config.UpgradeEnvFile`).
func upgradeConfig(target string) error {
	old, err := os.ReadFile(target)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%s does not exist; run `tabversed config` to write it first", target)
		}
		return err
	}
	upgraded, err := config.UpgradeEnvFile(string(old), envExample)
	if err != nil {
		// A file the parser cannot read is one whose settings cannot be moved;
		// stopping with the line number beats guessing at the rest.
		return fmt.Errorf("%s: %w", target, err)
	}
	backup := backupPath(target)
	if err := os.WriteFile(backup, old, 0o600); err != nil {
		return fmt.Errorf("back up to %s: %w", backup, err)
	}
	body := []byte(upgraded)
	if len(body) == 0 || body[len(body)-1] != '\n' {
		body = append(body, '\n')
	}
	if err := os.WriteFile(target, body, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", target, err)
	}
	fmt.Fprintf(os.Stdout, "backed up %s to %s\n", target, backup)
	fmt.Fprintf(os.Stdout, "upgraded %s from the current template\n", target)
	fmt.Fprintln(os.Stdout, "\nYour settings were kept; review the file for anything new to fill in.")
	return nil
}

// backupPath is .env.bak, or a timestamped name when one is already there, so
// two upgrades never overwrite the same backup.
func backupPath(target string) string {
	candidate := target + ".bak"
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate
	}
	return target + ".bak." + time.Now().Format("20060102-150405")
}
