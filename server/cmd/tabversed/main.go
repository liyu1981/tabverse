// Command tabversed is the Tabverse sync server.
//
// A single, dependency light Go binary: cross compile it with
//
//	GOOS=windows GOARCH=amd64 go build ./cmd/tabversed
//
// (the SQLite driver is pure Go, no cgo), or build a container image.
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

	"github.com/liyu1981/tabverse/server/internal/accounts"
	"github.com/liyu1981/tabverse/server/internal/api"
	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/retention"
	"github.com/liyu1981/tabverse/server/internal/store"
	"github.com/liyu1981/tabverse/server/internal/version"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

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
	srv := api.New(cfg, st, h, logger)

	// The console's account layer (adr/0012). Off unless TABVERSED_AUTH says
	// otherwise, in which case the console keeps using the admin token and the
	// extension keeps pairing exactly as before.
	if cfg.AccountsEnabled() {
		accountsSvc, err := accounts.New(cfg, st, logger)
		if err != nil {
			return fmt.Errorf("account layer: %w", err)
		}
		srv.WithAccounts(accountsSvc)
		if cfg.DevMode {
			logger.Warn("TABVERSED_DEV_MODE is on: the library's fake OAuth provider is " +
				"mounted, which is for local development only")
		}
		if !cfg.SMTPConfigured() {
			logger.Warn("no TABVERSED_SMTP_HOST: sign-in links will be printed to this log " +
				"instead of emailed")
		}
		logger.Info("accounts enabled: sign in at / (or /auth/ for the login providers)")
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
		if cfg.AdminEnabled() {
			logger.Info("admin API enabled: Authorization: Bearer <admin token> still works, " +
				"as the break-glass path")
		}
		if cfg.Exposed() {
			logger.Warn("listening on a non-loopback address: the pairing/bootstrap " +
				"endpoint is reachable from the network, and whoever pairs first owns " +
				"this server (set TABVERSED_ADDR=127.0.0.1:8223 to keep it local)")
			if !cfg.AdminEnabled() {
				logger.Warn("no TABVERSED_ADMIN_TOKEN set: the deployment is single tenant " +
					"(one account, whoever bootstraps it first) and the console is off; " +
					"set the admin token to manage accounts and browse their data")
			}
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

func parentDir(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return ""
}
