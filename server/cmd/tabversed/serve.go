package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/liyu1981/tabverse/server/internal/api"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/retention"
	"github.com/liyu1981/tabverse/server/internal/store"
	"github.com/liyu1981/tabverse/server/internal/version"
)

// serve is "tabversed serve": the whole server, in the foreground.
//
// It is what the binary has always done, and what the systemd unit runs. The
// only reason it is a subcommand rather than the default is that the binary now
// has other jobs (config, service) - and something meant to run for months on
// somebody's machine should have to be asked for by name.
func serve(args []string) error {
	if len(args) > 0 {
		return fmt.Errorf("serve takes no arguments, got %q", args[0])
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	// Settings may live in a file next to the binary (.env, or whatever
	// TABVERSED_ENV_FILE names) rather than in the unit file. It has to happen
	// before Load, and the real environment still wins over it.
	if path, err := config.LoadEnvFile(); err != nil {
		return fmt.Errorf("env file: %w", err)
	} else if path != "" {
		logger.Info("loaded settings from a file", "file", path,
			"note", "the environment overrides it")
	}

	cfg, err := config.Load(version.Version)
	if err != nil {
		return err
	}

	if dir := parentDir(cfg.DBPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer st.Close()

	h := hub.New()
	// The account layer is part of the server now (adr/0013): there is no mode
	// switch and no master credential, only signed-in accounts.
	srv, err := api.New(cfg, st, h, logger)
	if err != nil {
		return err
	}
	if cfg.DevMode {
		logger.Warn("TABVERSED_DEV_MODE is on: the library's fake OAuth provider is " +
			"mounted, which is for local development only")
	}
	if !cfg.SMTPConfigured() {
		logger.Warn("no TABVERSED_SMTP_HOST: sign-in links will be printed to this log " +
			"instead of emailed")
	}
	// The operator bootstrap: an account that already uses TABVERSED_ADMIN_EMAIL
	// is promoted on start, so setting the variable on an existing deployment
	// and restarting is all it takes (adr/0013).
	if err := srv.BootstrapOperator(context.Background()); err != nil {
		return fmt.Errorf("operator bootstrap: %w", err)
	}
	// Redeemed sign-in links are kept only so a link cannot be redeemed twice
	// (adr/0021). They are swept once at start, which is enough: the table grows
	// by one row per sign-in and every row is dead within its own 30 minutes.
	if n, err := st.SweepVerifTokens(context.Background()); err != nil {
		logger.Warn("could not sweep redeemed sign-in links", "err", err)
	} else if n > 0 {
		logger.Info("swept redeemed sign-in links", "rows", n)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Server side retention (chrome session snapshots).
	go retention.Run(ctx, st, h, cfg.RetentionDays, logger)

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// Long lived WebSockets are handled by the hijacked connection, not
		// by this server, but keep WriteTimeout off to avoid interfering.
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("tabversed listening",
			"addr", cfg.Addr, "db", cfg.DBPath, "version", cfg.Version)
		logOperatorState(st, logger)
		if cfg.Exposed() {
			logger.Warn("listening on a non-loopback address: the pairing/bootstrap " +
				"endpoint is reachable from the network (set TABVERSED_ADDR=127.0.0.1:8223 " +
				"to keep it local)")
		}
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

// logOperatorState says, in one line each, who runs this deployment. The
// interesting case is a server with no operator at all: the console still works
// for whoever registers, but the account list and impersonation are unreachable
// until somebody becomes the operator, and saying so at startup beats a person
// wondering why a button is missing.
func logOperatorState(st *store.Store, logger *slog.Logger) {
	n, err := st.CountAdmins(context.Background())
	if err != nil {
		logger.Warn("cannot read the operator list", "err", err)
		return
	}
	if n > 0 {
		logger.Info("this server has an operator; accounts and their devices are managed in the console", "operators", n)
		return
	}
	logger.Warn("no operator account yet: the console works for whoever registers, but the " +
		"account list and impersonation need an operator")
	logger.Warn("set TABVERSED_ADMIN_EMAIL to the address that should become the operator, " +
		"then register with it (or restart the server if you are already registered)")
}

func parentDir(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return ""
}
