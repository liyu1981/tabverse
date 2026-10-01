package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	_ "embed"

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
	dir := fs.String("dir", ".", "directory to write it into")
	if err := fs.Parse(args); err != nil {
		return errUsage
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("config takes flags only, got %q", fs.Arg(0))
	}

	target := filepath.Join(*dir, ".env")
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
	return nil
}
