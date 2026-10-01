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
	unitName    = "topicversed.service"
	unitSubdir  = "systemd/user"
	unitDirMode = 0o755
)

// serviceManager is the whole systemctl surface, behind an injectable runner so
// the tests can stand in for both systemctl and journalctl. Nothing here touches
// systemd until a method is called.
type serviceManager struct {
	unitDir string // where the unit file is written
	binPath string // ExecStart
	workDir string // WorkingDirectory: where .env is found
	run     func(name string, args ...string) error
	out     *os.File
	errOut  *os.File
}

func newServiceManager(out, errOut *os.File) (*serviceManager, error) {
	binPath, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("find this binary: %w", err)
	}
	// A binary reached through a symlink (a versioned name in /usr/local/bin,
	// or `go run`'s temp build) would be written into the unit as the symlink,
	// and ExecStart needs the real file.
	if resolved, err := filepath.EvalSymlinks(binPath); err == nil {
		binPath = resolved
	}
	workDir, err := os.Getwd()
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

  install     Write and enable a systemd user unit for this binary.
  status      systemctl --user status topicversed.service
  start       systemctl --user start topicversed.service
  restart     systemctl --user restart topicversed.service
  stop        systemctl --user stop topicversed.service
  logs        journalctl --user -u topicversed.service -f

"install" writes ~/.config/systemd/user/topicversed.service, runs
"systemctl --user daemon-reload" and enables the unit. It does not start it, so
starting stays a separate, visible step.

"logs" follows the journal; anything after it goes to journalctl as it is, e.g.
"tabversed service logs --since -1h" or "tabversed service logs -n 200 --no-pager".

To keep the server running while you are logged out, enable lingering once:

    loginctl enable-linger $USER

To remove the service:

    systemctl --user disable --now topicversed.service
    rm ~/.config/systemd/user/topicversed.service
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
func (m *serviceManager) unitText(workDir string) string {
	return fmt.Sprintf(`# Written by "tabversed service install". Edit it, or re-run install after
# moving the binary; "install --force" replaces this file.
[Unit]
Description=tabversed sync server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s serve
WorkingDirectory=%s
# Settings come from the .env in the working directory, read by the binary.
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`, m.binPath, workDir)
}

func (m *serviceManager) install(args []string) error {
	fs := flag.NewFlagSet("service install", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	force := fs.Bool("force", false, "replace an existing unit file")
	dir := fs.String("dir", m.workDir, "working directory for the server (where .env is)")
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
	text := m.unitText(workDir)
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
	fmt.Fprintf(m.out, "enabled %s (working directory: %s)\n", unitName, workDir)

	if _, err := os.Stat(filepath.Join(workDir, ".env")); err != nil {
		fmt.Fprintf(m.out, "\nthere is no .env in %s yet: the server would run on its\n", workDir)
		fmt.Fprintln(m.out, "defaults and print sign-in links to the journal. Write one with")
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
