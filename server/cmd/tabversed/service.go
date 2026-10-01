package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// The systemd *user* service.
//
// `--user`, not the system service, is the whole design: a self-hosted tabverse
// belongs to the person who installed it, and "systemctl --user" needs no root,
// no sudo and no /etc edit. It is what works on the laptop at home and on the
// little box under the desk alike.
//
// The unit runs `tabversed serve` with WorkingDirectory set to wherever the
// binary was installed from, because that is where the .env lives - and the
// binary reads it itself (internal/config/envfile.go), so there is one parser
// for that file format instead of two with subtly different quoting rules.

const (
	unitName    = "tabversed.service"
	unitSubdir  = "systemd/user"
	unitDirMode = 0o755
	// serviceDirName is where a service install keeps its settings: ~/.tabversed,
	// whatever directory the command was run from. A server that runs for months
	// out of wherever somebody happened to be standing when they installed it is
	// a server that stops working the next time they move it.
	serviceDirName = ".tabversed"
	serviceDirMode = 0o700
	// binDirName is where the binary is assumed to live, and therefore what
	// ExecStart points at. A stable path rather than the one this process
	// happens to be, so replacing the file is the upgrade - no re-install.
	binDirName = ".local/bin"
	binName    = "tabversed"
)

// serviceManager is the whole systemctl surface, behind an injectable runner so
// the tests can stand in for both systemctl and journalctl. Nothing here touches
// systemd until a method is called.
type serviceManager struct {
	unitDir string // where the unit file is written
	binPath string // ExecStart: ~/.local/bin/tabversed unless --bin says otherwise
	workDir string // WorkingDirectory: ~/.tabversed, where .env is found
	run     func(name string, args ...string) error
	out     *os.File
	errOut  *os.File
}

func newServiceManager(out, errOut *os.File) (*serviceManager, error) {
	binPath, err := installedBinaryPath()
	if err != nil {
		return nil, err
	}
	workDir, err := serviceDir()
	if err != nil {
		return nil, err
	}
	unitDir, err := userUnitDir()
	if err != nil {
		return nil, err
	}
	m := &serviceManager{
		unitDir: unitDir, binPath: binPath, workDir: workDir, out: out, errOut: errOut,
	}
	m.run = func(name string, args ...string) error {
		cmd := exec.Command(name, args...)
		cmd.Stdout = out
		cmd.Stderr = errOut
		return cmd.Run()
	}
	return m, nil
}

// serviceDir is ~/.tabversed, the home a service install keeps its settings and
// (by the DB path's relative default) its data in.
func serviceDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("no home directory: %w", err)
	}
	return filepath.Join(home, serviceDirName), nil
}

// installedBinaryPath is ~/.local/bin/tabversed: where the service expects the
// binary to be. It is not os.Executable(), because ExecStart has to keep working
// after this process is gone, and after somebody rebuilds the binary in place.
func installedBinaryPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("no home directory: %w", err)
	}
	return filepath.Join(home, binDirName, binName), nil
}

// userUnitDir is ~/.config/systemd/user, honouring XDG_CONFIG_HOME.
func userUnitDir() (string, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("no home directory: %w", err)
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, unitSubdir), nil
}

// systemctlUnavailable is the one thing that stops a `--user` unit, and it is
// worth naming precisely: a user manager exists only inside a session (or with
// lingering enabled), and on a machine without systemd there is nothing to
// install into. Both cases get told what to do instead.
func systemctlUnavailable() error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return errors.New("no systemctl on this machine, so there is no user service to " +
			"install. Run `tabversed serve` yourself, or put it under another supervisor")
	}
	if os.Getenv("XDG_RUNTIME_DIR") == "" {
		return errors.New("no XDG_RUNTIME_DIR, so there is no systemd user session here " +
			"(this is what an ssh without a login shell, or a container without " +
			"systemd, looks like). Run `tabversed serve` under your own supervisor")
	}
	return nil
}

func serviceCommand(args []string) error {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, serviceUsage)
		return errUsage
	}
	if err := systemctlUnavailable(); err != nil {
		return err
	}
	m, err := newServiceManager(os.Stdout, os.Stderr)
	if err != nil {
		return err
	}
	verb, rest := args[0], args[1:]
	switch verb {
	case "install":
		return m.install(rest)
	case "status", "start", "restart", "stop":
		if len(rest) > 0 {
			return fmt.Errorf("service %s takes no arguments, got %q", verb, rest[0])
		}
		return m.systemctl(verb, unitName)
	case "logs":
		return m.logs(rest)
	case "help", "-h", "--help":
		fmt.Fprint(os.Stdout, serviceUsage)
		return nil
	default:
		fmt.Fprintf(os.Stderr, "tabversed: unknown service command %q\n\n", verb)
		fmt.Fprint(os.Stderr, serviceUsage)
		return errUsage
	}
}

const serviceUsage = `Usage: tabversed service <command>

  install     Write and enable a systemd user unit for tabversed.
  status      systemctl --user status tabversed.service
  start       systemctl --user start tabversed.service
  restart     systemctl --user restart tabversed.service
  stop        systemctl --user stop tabversed.service
  logs        journalctl --user -u tabversed.service -f

"install" writes ~/.config/systemd/user/tabversed.service, runs
"systemctl --user daemon-reload" and enables the unit. It does not start it, so
starting stays a separate, visible step.

The unit runs ~/.local/bin/tabversed (a stable path, so replacing that file is
the upgrade; --bin points it somewhere else) with the working directory at
~/.tabversed, which is where it looks for .env - and where the database lands
too (~/.tabversed/data/tabversed.db) unless TABVERSED_DB says otherwise. --dir
puts the settings and the data somewhere else. Neither is the directory you
happened to be standing in when you installed it.

"logs" follows the journal; anything after it goes to journalctl as it is, e.g.
"tabversed service logs --since -1h" or "tabversed service logs -n 200 --no-pager".

To keep the server running while you are logged out, enable lingering once:

    loginctl enable-linger $USER

To remove the service:

    systemctl --user disable --now tabversed.service
    rm ~/.config/systemd/user/tabversed.service
    systemctl --user daemon-reload
`

func (m *serviceManager) systemctl(args ...string) error {
	full := append([]string{"--user"}, args...)
	if err := m.run("systemctl", full...); err != nil {
		return fmt.Errorf("systemctl %s: %w", join(args), err)
	}
	return nil
}

// unitText is the unit install writes.
//
// No EnvironmentFile line on purpose: the binary reads ./.env from its working
// directory itself, so systemd and the program cannot disagree about what the
// file said.
func (m *serviceManager) unitText(workDir, binPath string) string {
	return fmt.Sprintf(`# Written by "tabversed service install". Edit it, or re-run install after
# moving the binary or the data; "install --force" replaces this file.
[Unit]
Description=tabversed sync server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s serve
WorkingDirectory=%s
# Settings come from the .env in the working directory, read by the binary;
# with the default --dir that is ~/.tabversed/.env, and the database lands in
# ~/.tabversed/data/ unless TABVERSED_DB says otherwise.
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`, binPath, workDir)
}

func (m *serviceManager) install(args []string) error {
	fs := flag.NewFlagSet("service install", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	force := fs.Bool("force", false, "replace an existing unit file")
	dir := fs.String("dir", m.workDir, "where the server keeps its settings and data (where .env is)")
	bin := fs.String("bin", m.binPath, "the tabversed binary the unit runs")
	if err := fs.Parse(args); err != nil {
		return errUsage
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("service install takes flags only, got %q", fs.Arg(0))
	}
	workDir, err := filepath.Abs(*dir)
	if err != nil {
		return err
	}
	binPath, err := filepath.Abs(*bin)
	if err != nil {
		return err
	}
	// A unit file whose ExecStart points at nothing fails at start with a bare
	// "No such file or directory" from systemd, which says nothing about which
	// path was wrong. This is the one place to catch it.
	if info, err := os.Stat(binPath); err != nil || info.IsDir() {
		return fmt.Errorf("no tabversed binary at %s (install it there, or pass --bin)", binPath)
	}
	text := m.unitText(workDir, binPath)
	target := filepath.Join(m.unitDir, unitName)

	// A unit file is something that runs, unattended: replacing a hand-edited
	// one without being asked would lose a tuned deployment's tuning. Rewriting
	// identical content is fine, and is how a moved binary gets picked up.
	if existing, err := os.ReadFile(target); err == nil {
		if string(existing) != text && !*force {
			return fmt.Errorf("%s exists and differs; edit it, or pass --force to replace it", target)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(m.unitDir, unitDirMode); err != nil {
		return err
	}
	// 0700: this directory is about to hold the session signing key and the
	// OAuth client secret.
	if err := os.MkdirAll(workDir, serviceDirMode); err != nil {
		return err
	}
	if err := os.WriteFile(target, []byte(text), 0o644); err != nil {
		return err
	}
	fmt.Fprintf(m.out, "wrote %s\n", target)

	if err := m.systemctl("daemon-reload"); err != nil {
		return err
	}
	if err := m.systemctl("enable", unitName); err != nil {
		return err
	}
	fmt.Fprintf(m.out, "enabled %s\n", unitName)
	fmt.Fprintf(m.out, "  binary:  %s\n", binPath)
	fmt.Fprintf(m.out, "  settings and data: %s\n", workDir)

	if _, err := os.Stat(filepath.Join(workDir, ".env")); err != nil {
		fmt.Fprintf(m.out, "\nthere is no %s/.env yet: the server would run on its defaults\n", workDir)
		fmt.Fprintln(m.out, "and print sign-in links to the journal. Write one with")
		fmt.Fprintf(m.out, "  tabversed config --dir %s\n", workDir)
	}
	fmt.Fprintln(m.out, "\nnext:")
	fmt.Fprintln(m.out, "  tabversed service start")
	fmt.Fprintln(m.out, "  tabversed service status")
	fmt.Fprintln(m.out, "  tabversed service logs")
	fmt.Fprintln(m.out, "\nTo keep it running while you are logged out, once:")
	fmt.Fprintln(m.out, "  loginctl enable-linger $USER")
	return nil
}

func (m *serviceManager) logs(args []string) error {
	// journalctl, not "systemctl status": logs is a tail of the journal, and
	// letting systemctl's own pager and colour handling decide that is worse.
	journal := append([]string{"--user", "-u", unitName, "-f"}, args...)
	if err := m.run("journalctl", journal...); err != nil {
		return fmt.Errorf("journalctl: %w", err)
	}
	return nil
}

func join(args []string) string {
	out := ""
	for i, a := range args {
		if i > 0 {
			out += " "
		}
		out += a
	}
	return out
}
