package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/liyu1981/tabverse/server/internal/config"
	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// newInviteOnlyServer is a deployment where account creation needs an
// invitation. The admin address is still exempt, which is what lets the
// operator register before anybody exists to invite it.
func newInviteOnlyServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	cfg := config.Config{
		Addr: ":0", DBPath: filepath.Join(t.TempDir(), "invite-api.db"),
		MaxRecordBytes: 1 << 20, SyncBatchLimit: 100, SearchLimit: 50,
		Version: "test", AdminEmail: testAdminEmail,
		PublicURL: "http://127.0.0.1:8223", SecureCookies: false,
		LinkByEmail: true, RequireEmailVerification: true,
		RegistrationRequiresInvite: true,
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	s, err := New(cfg, st, hub.New(), nil)
	if err != nil {
		t.Fatalf("server: %v", err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, s
}

func TestRegistrationInvitesAdminAPI(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv)

	// Create one, with a code. The response carries the rendered email so a
	// deployment with no SMTP has something to copy.
	r := adminDo(t, op, http.MethodPost, "/console/api/v1/admin/registration-invites",
		map[string]any{"email": "newbie@example.com", "with_code": true, "ttl_seconds": 3600})
	r.mustStatus(t, http.StatusOK)
	if _, ok := r.body["code"].(string); !ok {
		t.Fatalf("create should return a code: %s", r.raw)
	}
	if _, ok := r.body["email"].(map[string]any); !ok {
		t.Fatalf("create should return the rendered email: %s", r.raw)
	}

	// It is listed.
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/registration-invites", nil)
	r.mustStatus(t, http.StatusOK)

	// Revoke it, then revoking again is a 404.
	r = adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/registration-invites/newbie@example.com", nil)
	r.mustStatus(t, http.StatusNoContent)
	r = adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/registration-invites/newbie@example.com", nil)
	r.mustStatus(t, http.StatusNotFound)
}

func TestSigninRefusedWithoutInvite(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv) // the admin address is exempt

	// An address nobody invited cannot register.
	r := doJSON(t, http.MethodPost,
		ts.URL+"/console/api/v1/console/signin-link?address=nobody@example.com&user=nobody@example.com", "", nil)
	r.mustStatus(t, http.StatusForbidden)

	// After the operator invites it, the same request goes through.
	invite := adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-invites",
		map[string]any{"email": "nobody@example.com"})
	invite.mustStatus(t, http.StatusOK)
	r = doJSON(t, http.MethodPost,
		ts.URL+"/console/api/v1/console/signin-link?address=nobody@example.com&user=nobody@example.com", "", nil)
	r.mustStatus(t, http.StatusOK)
}

// The invitation goes out through the same SMTP the sign-in link uses, which is
// the point: one mail configuration, two messages.
func TestRegistrationInviteIsEmailed(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv)

	var sentTo, sentText string
	srv.accounts.SetSenderOverride(func(address, text string) error {
		sentTo, sentText = address, text
		return nil
	})

	r := adminDo(t, op, http.MethodPost, "/console/api/v1/admin/registration-invites",
		map[string]any{"email": "newbie@example.com", "with_code": true, "send_email": true})
	r.mustStatus(t, http.StatusOK)

	if sentTo != "newbie@example.com" {
		t.Fatalf("sent to %q, want the invited address", sentTo)
	}
	if !strings.Contains(sentText, "/console") {
		t.Fatalf("the message should name the console: %q", sentText)
	}
}
