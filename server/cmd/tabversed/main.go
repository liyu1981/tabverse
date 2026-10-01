// Command tabversed is the Tabverse sync server.
//
//	tabversed serve     run the server (the whole binary, in the foreground)
//	tabversed version   print the version
//	tabversed config    write a .env to configure this machine
//	tabversed service   install and control it as a systemd *user* service
//
// Run it with no arguments to see this list. The server is the SQLite driver
// (pure Go, no cgo), so a deployment is one file and one .env.
package main

import (
	"errors"
	"fmt"
	"os"
)

// errUsage is the exit code for a command line the user got wrong, as opposed
// to a failure of the command itself.
var errUsage = errors.New("usage")

func main() {
	if err := run(os.Args[1:]); err != nil {
		if errors.Is(err, errUsage) {
			os.Exit(2)
		}
		fmt.Fprintf(os.Stderr, "tabversed: %v\n", err)
		os.Exit(1)
	}
}

// run dispatches one command. Everything it does is a thin shell around either
// the server itself or the tools around it, so each one lives in its own file.
func run(args []string) error {
	if len(args) == 0 {
		usage(os.Stdout)
		return nil
	}
	switch args[0] {
	case "serve":
		return serve(args[1:])
	case "version", "-version", "--version":
		return printVersion()
	case "config":
		return configCommand(args[1:])
	case "service":
		return serviceCommand(args[1:])
	case "help", "-h", "-help", "--help":
		usage(os.Stdout)
		return nil
	default:
		fmt.Fprintf(os.Stderr, "tabversed: unknown command %q\n\n", args[0])
		usage(os.Stderr)
		return errUsage
	}
}

func usage(out *os.File) {
	fmt.Fprint(out, `tabversed - the Tabverse sync server

Usage:
  tabversed serve            Run the server in the foreground.
  tabversed version          Print the version.
  tabversed config           Write a .env to the current directory, to edit.
  tabversed service ...      Install and control a systemd user service.

Commands:
  serve              Everything the binary is: it listens, serves the sync API
                     and the operator console, and prunes old records. Ctrl-C
                     stops it. With no arguments, tabversed prints this text -
                     nothing starts by accident, which matters for something
                     meant to run for months on somebody's machine.

  version            The build version ("dev" unless it was set at build time
                     with -ldflags -X .../internal/version.Version=...).

  config             Copies the built-in settings template to ./.env, mode 0600,
                     ready to fill in. It refuses to replace an existing .env
                     unless you pass --force. This is the same file
                     server/.env.example documents every variable in.

  service install    Write, enable and register a systemd *user* unit, so the
  service status     server survives a logout and can be inspected, restarted
  service start      and stopped without a terminal. Uses "systemctl --user",
  service restart    which needs no root and no sudo.
  service stop
  service logs       The five verbs map to systemctl --user. "logs" follows the
                     journal; anything after it goes to journalctl as it is,
                     e.g. "tabversed service logs --since -1h".

Settings:
  Every variable is TABVERSED_*. They are read from the environment and from a
  .env file in the working directory - "serve" picks that up, and the
  environment still wins over the file. TABVERSED_ENV_FILE names another file;
  one that cannot be read is a startup error.

Run "tabversed config" first if this machine has no .env yet.
`)
}
