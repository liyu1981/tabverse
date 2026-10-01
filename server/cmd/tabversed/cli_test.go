package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The command line is the first thing anybody touches on a machine, and the two
// ways it can be quietly wrong are: printing nothing (so nothing starts), and
// writing over something that mattered (a .env with two secrets in it, a unit
// file someone edited). These tests are about those.

func TestNoArgumentsPrintsHelpAndStartsNothing(t *testing.T) {
	out := captureStdout(t, func() {
		if err := run(nil); err != nil {
			t.Fatalf("run with no arguments: %v", err)
		}
	})
	for _, want := range []string{"tabversed serve", "tabversed version", "tabversed config", "tabversed service"} {
		if !strings.Contains(out, want) {
			t.Errorf("the help text does not mention %q:\n%s", want, out)
		}
	}
}

func TestAnUnknownCommandIsAUsageError(t *testing.T) {
	err := run([]string{"sreve"}) // the typo this interface invites
	if !errors.Is(err, errUsage) {
		t.Fatalf("an unknown command returned %v, want the usage exit code", err)
	}
}

func TestVersionPrintsSomething(t *testing.T) {
	out := captureStdout(t, func() {
		if err := run([]string{"version"}); err != nil {
			t.Fatalf("version: %v", err)
		}
	})
	if !strings.Contains(out, "tabversed ") {
		t.Errorf("version printed %q", out)
	}
}

func TestServeTakesNoArguments(t *testing.T) {
	if err := serve([]string{"--port", "1"}); err == nil {
		t.Fatal("serve with arguments should refuse rather than ignore them")
	}
}

// `config` exists so a machine that has only the binary can get the settings
// template - and it must not be able to destroy the one that is already there.
func TestConfigWritesTheTemplateAndRefusesToClobberIt(t *testing.T) {
	dir := t.TempDir()

	captureStdout(t, func() {
		if err := configCommand([]string{"--dir", dir}); err != nil {
			t.Fatalf("config: %v", err)
		}
	})
	written := filepath.Join(dir, ".env")
	info, err := os.Stat(written)
	if err != nil {
		t.Fatalf("no .env written: %v", err)
	}
	// the file is about to hold the auth secret and the OAuth client secret
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf(".env mode is %o, want 600", perm)
	}
	body, err := os.ReadFile(written)
	if err != nil {
		t.Fatalf("read .env: %v", err)
	}
	if string(body) != string(envExample) {
		t.Error("the .env written is not the template")
	}
	// A settings file without a trailing newline is a trap: appending to it
	// glues the addition onto the last line, and a commented-out default then
	// swallows the setting without a word. Found the hard way.
	if len(body) == 0 || body[len(body)-1] != '\n' {
		t.Error("the .env written does not end in a newline")
	}
	if !strings.Contains(string(body), "TABVERSED_PUBLIC_URL") {
		t.Error("the template written has no settings in it")
	}

	// an edit in the file, then config again
	if err := os.WriteFile(written, []byte("TABVERSED_PUBLIC_URL=https://mine\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := configCommand([]string{"--dir", dir}); err == nil {
		t.Error("config replaced an existing .env without --force")
	}
	// ...and the edit is still there
	if body, _ := os.ReadFile(written); string(body) != "TABVERSED_PUBLIC_URL=https://mine\n" {
		t.Error("the existing .env was modified by the refused run")
	}
	if err := configCommand([]string{"--dir", dir, "--force"}); err != nil {
		t.Errorf("config --force: %v", err)
	}
	if body, _ := os.ReadFile(written); string(body) != string(envExample) {
		t.Error("config --force did not replace the file")
	}
}

// The template ships in two places because go:embed cannot walk out of a
// package: the one the repository documents, and the one the binary carries.
// They must not drift, or "config" would hand somebody a file that contradicts
// the documentation.
// The template is also a text file other tools read, so it has to be a
// well-formed one.
func TestTemplateEndsWithANewline(t *testing.T) {
	if len(envExample) == 0 || envExample[len(envExample)-1] != '\n' {
		t.Error(".env.example does not end in a newline")
	}
}

func TestTemplateMatchesTheRepositoryCopy(t *testing.T) {
	repo, err := os.ReadFile(filepath.Join("..", "..", ".env.example"))
	if err != nil {
		t.Fatalf("read server/.env.example: %v", err)
	}
	if string(repo) != string(envExample) {
		t.Errorf("server/.env.example and cmd/tabversed/.env.example differ (%d vs %d bytes); "+
			"copy the repository one into the package and commit both", len(repo), len(envExample))
	}
}

// ---- service --------------------------------------------------------------

// A fake manager: the same code, with the unit directory pointed at a temp dir
// and both systemctl and journalctl replaced by a recorder.
func fakeManager(t *testing.T) (*serviceManager, *[]string) {
	t.Helper()
	var calls []string
	m := &serviceManager{
		unitDir: t.TempDir(),
		binPath: "/usr/local/bin/tabversed",
		workDir: t.TempDir(),
		run: func(name string, args ...string) error {
			calls = append(calls, name+" "+strings.Join(args, " "))
			return nil
		},
		out:    os.Stdout,
		errOut: os.Stderr,
	}
	return m, &calls
}

func TestServiceInstallWritesAUnitThatRunsServe(t *testing.T) {
	m, calls := fakeManager(t)

	captureStdout(t, func() {
		if err := m.install(nil); err != nil {
			t.Fatalf("install: %v", err)
		}
	})

	unit, err := os.ReadFile(filepath.Join(m.unitDir, unitName))
	if err != nil {
		t.Fatalf("no unit written: %v", err)
	}
	text := string(unit)
	for _, want := range []string{
		"ExecStart=/usr/local/bin/tabversed serve",
		"WorkingDirectory=" + m.workDir,
		"Restart=always",
		"WantedBy=default.target",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the unit has no %q:\n%s", want, text)
		}
	}
	// it is a *user* unit, so it must not be an environment file either: the
	// binary reads .env itself and two parsers is one too many
	if strings.Contains(text, "EnvironmentFile") {
		t.Error("the unit has an EnvironmentFile line; the binary reads .env itself")
	}

	got := strings.Join(*calls, "\n")
	for _, want := range []string{
		"systemctl --user daemon-reload",
		"systemctl --user enable topicversed.service",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("install did not run %q; it ran:\n%s", want, got)
		}
	}
	if strings.Contains(got, "start topicversed") {
		t.Error("install started the service; starting is meant to be a separate, visible step")
	}
}

func TestServiceInstallRefusesToReplaceAnEditedUnit(t *testing.T) {
	m, _ := fakeManager(t)
	target := filepath.Join(m.unitDir, unitName)
	if err := os.WriteFile(target, []byte("[Service]\nExecStart=/somewhere/else\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := m.install(nil); err == nil {
		t.Fatal("install replaced a unit file that differs, without --force")
	}
	body, _ := os.ReadFile(target)
	if !strings.Contains(string(body), "/somewhere/else") {
		t.Error("the refused install still modified the file")
	}

	captureStdout(t, func() {
		if err := m.install([]string{"--force"}); err != nil {
			t.Errorf("install --force: %v", err)
		}
	})
	if body, _ := os.ReadFile(target); strings.Contains(string(body), "/somewhere/else") {
		t.Error("install --force did not replace the unit")
	}
}

func TestServiceInstallIsIdempotent(t *testing.T) {
	m, _ := fakeManager(t)
	for i := 0; i < 2; i++ {
		captureStdout(t, func() {
			if err := m.install(nil); err != nil {
				t.Fatalf("install %d: %v", i, err)
			}
		})
	}
}

func TestServiceVerbsGoStraightToSystemctlUser(t *testing.T) {
	m, calls := fakeManager(t)
	for _, verb := range []string{"status", "start", "restart", "stop"} {
		if err := m.systemctl(verb, unitName); err != nil {
			t.Fatalf("%s: %v", verb, err)
		}
	}
	got := strings.Join(*calls, "\n")
	for _, verb := range []string{"status", "start", "restart", "stop"} {
		if !strings.Contains(got, "systemctl --user "+verb+" "+unitName) {
			t.Errorf("%q is not in the systemctl calls:\n%s", verb, got)
		}
	}
}

func TestServiceLogsFollowsTheJournalAndPassesArgumentsThrough(t *testing.T) {
	m, calls := fakeManager(t)
	if err := m.logs(nil); err != nil {
		t.Fatalf("logs: %v", err)
	}
	if err := m.logs([]string{"--since", "-1h"}); err != nil {
		t.Fatalf("logs with arguments: %v", err)
	}
	got := strings.Join(*calls, "\n")
	if !strings.Contains(got, "journalctl --user -u "+unitName+" -f") {
		t.Errorf("logs is not following the unit's journal:\n%s", got)
	}
	if !strings.Contains(got, "--since -1h") {
		t.Errorf("logs did not pass its arguments to journalctl:\n%s", got)
	}
}

// A failing systemctl must not read as success: `tabversed service start` that
// quietly returns 0 when the unit did not start is the kind of thing somebody
// trusts.
func TestASystemctlFailureIsReported(t *testing.T) {
	m, _ := fakeManager(t)
	m.run = func(string, ...string) error { return errors.New("exit status 1") }
	if err := m.systemctl("start", unitName); err == nil {
		t.Fatal("a failing systemctl was reported as success")
	}
}

// ---- helpers --------------------------------------------------------------

// captureStdout runs f with os.Stdout pointed at a pipe, so a command that
// only prints can still be asserted on.
func captureStdout(t *testing.T, f func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	real := os.Stdout
	os.Stdout = w
	done := make(chan string, 1)
	go func() {
		var sb strings.Builder
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			sb.Write(buf[:n])
			if err != nil {
				break
			}
		}
		done <- sb.String()
	}()
	f()
	os.Stdout = real
	_ = w.Close()
	out := <-done
	_ = r.Close()
	return out
}
