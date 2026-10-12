package api

import (
	"context"
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

	// Create one. The response carries the rendered email so a deployment with no
	// SMTP has something to copy, and that message names the code it minted.
	r := adminDo(t, op, http.MethodPost, "/console/api/v1/admin/registration-invites",
		map[string]any{"email": "newbie@example.com", "ttl_seconds": 3600})
	r.mustStatus(t, http.StatusOK)
	createdCode, _ := r.body["code"].(string)
	if createdCode == "" {
		t.Fatalf("create should return a code: %s", r.raw)
	}
	createdEmail, _ := r.body["email"].(map[string]any)
	createdBody, _ := createdEmail["body"].(string)
	if !strings.Contains(createdBody, createdCode) {
		t.Fatalf("the created message should name the code %q: %q", createdCode, createdBody)
	}

	// It is listed with the same message, so a dialog opened from the list has
	// the code to copy and to send.
	r = adminDo(t, op, http.MethodGet, "/console/api/v1/admin/registration-invites", nil)
	r.mustStatus(t, http.StatusOK)
	list, _ := r.body["invites"].([]any)
	if len(list) != 1 {
		t.Fatalf("invites = %s", r.raw)
	}
	listed, _ := list[0].(map[string]any)
	listedSubject, _ := listed["email_subject"].(string)
	listedBody, _ := listed["email_body"].(string)
	if !strings.Contains(listedBody, createdCode) {
		t.Fatalf("the listed message should name the code %q: %q", createdCode, listedBody)
	}

	// Sending the drafted message - exactly what the console posts - puts the
	// code in the body of the mail that goes out.
	var sentText string
	srv.accounts.SetSenderOverride(func(_, text string) error {
		sentText = text
		return nil
	})
	r = adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-invites/newbie@example.com/send",
		map[string]any{"subject": listedSubject, "text": listedBody})
	r.mustStatus(t, http.StatusOK)
	if !strings.Contains(sentText, createdCode) {
		t.Fatalf("the sent message should name the code %q: %q", createdCode, sentText)
	}

	// Revoke it, then revoking again is a 404.
	r = adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/registration-invites/newbie@example.com", nil)
	r.mustStatus(t, http.StatusNoContent)
	r = adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/registration-invites/newbie@example.com", nil)
	r.mustStatus(t, http.StatusNotFound)
}

// An invitation stored before the code was kept in the clear still produces a
// message with a code: reading the list mints one and stores it, so the draft
// the console copies registers.
func TestRegistrationInviteWithoutStoredCodeIsBackfilled(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv)

	// A legacy row: the invited address alone, with no code recorded.
	if _, err := srv.store.CreateRegistrationInvite(context.Background(),
		"legacy@example.com", "", "", "op", 3600_000); err != nil {
		t.Fatalf("create: %v", err)
	}

	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/registration-invites", nil)
	r.mustStatus(t, http.StatusOK)
	list, _ := r.body["invites"].([]any)
	if len(list) != 1 {
		t.Fatalf("invites = %s", r.raw)
	}
	inv, _ := list[0].(map[string]any)
	code, _ := inv["code"].(string)
	if code == "" {
		t.Fatalf("the list should backfill a code: %s", r.raw)
	}
	body, _ := inv["email_body"].(string)
	if !strings.Contains(body, code) {
		t.Fatalf("the draft should name the code %q: %s", code, body)
	}

	// The minted code is the one registration accepts.
	r = doJSON(t, http.MethodPost,
		ts.URL+"/console/api/v1/console/signin-link?address=legacy@example.com&user=legacy@example.com&code="+code,
		"", nil)
	r.mustStatus(t, http.StatusOK)
}

func TestSigninRefusedWithoutInvite(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv) // the admin address is exempt

	// An address nobody invited cannot register.
	r := doJSON(t, http.MethodPost,
		ts.URL+"/console/api/v1/console/signin-link?address=nobody@example.com&user=nobody@example.com", "", nil)
	r.mustStatus(t, http.StatusForbidden)

	// After the operator invites it, the same request goes through - with the code
	// the invitation carries, which every invitation now has.
	invite := adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-invites",
		map[string]any{"email": "nobody@example.com"})
	invite.mustStatus(t, http.StatusOK)
	code, _ := invite.body["code"].(string)
	if code == "" {
		t.Fatalf("the invitation should carry a code: %s", invite.raw)
	}
	r = doJSON(t, http.MethodPost,
		ts.URL+"/console/api/v1/console/signin-link?address=nobody@example.com&user=nobody@example.com&code="+code, "", nil)
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

// A login with no invitation shows up as a request the operator can approve or
// reject.
func TestRegistrationRequestsAdminAPI(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv)

	uid, _, err := srv.store.UpsertIdentity(context.Background(), "google", "g-1",
		"asker@example.com", "Asker", true,
		store.RegistrationPolicy{RequireInvite: true, CreatePending: true})
	if err != nil {
		t.Fatalf("request: %v", err)
	}

	// The operator sees it.
	r := adminDo(t, op, http.MethodGet, "/console/api/v1/admin/registration-requests", nil)
	r.mustStatus(t, http.StatusOK)

	// Approving invites it and activates the account.
	r = adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-requests/"+uid+"/invite", nil)
	r.mustStatus(t, http.StatusOK)
	acc, err := srv.store.AccountByID(context.Background(), uid)
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	if acc.Pending() {
		t.Fatalf("the account should be active after the invite")
	}

	// A second approval is a conflict, not a silent no-op.
	r = adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-requests/"+uid+"/invite", nil)
	r.mustStatus(t, http.StatusConflict)
}

// Rejecting a request removes the pending account.
func TestRegistrationRequestCanBeRejected(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv)

	uid, _, err := srv.store.UpsertIdentity(context.Background(), "google", "g-2",
		"reject@example.com", "Reject", true,
		store.RegistrationPolicy{RequireInvite: true, CreatePending: true})
	if err != nil {
		t.Fatalf("request: %v", err)
	}

	r := adminDo(t, op, http.MethodDelete,
		"/console/api/v1/admin/registration-requests/"+uid, nil)
	r.mustStatus(t, http.StatusNoContent)
	if _, err := srv.store.AccountByID(context.Background(), uid); err == nil {
		t.Fatalf("the account should be gone")
	}
}
