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

	// The minted code is the one registration accepts. Registration is the step
	// the invite gates now, not the link request (adr/0029).
	pending := pendingSession(t, ts, srv, "legacy@example.com")
	if me := pending.do(t, http.MethodGet, "/console/api/v1/console/me").body; me["needs_registration"] != true {
		t.Fatalf("the session should be a pending registration: %v", me)
	}
	reg := pending.doJSON(t, http.MethodPost, "/console/api/v1/console/register",
		map[string]any{"email": "legacy@example.com", "agree": true, "code": code})
	reg.mustStatus(t, http.StatusNoContent)
}

func TestRegistrationRefusedWithoutInvite(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	op := operatorSession(t, ts, srv) // the admin address is exempt

	// A signed-in-but-unregistered session cannot create an account while the
	// server is invite-only and no invitation covers the address. The sign-in
	// link itself is not refused any more; registration is where the invite is
	// checked (adr/0029).
	pending := pendingSession(t, ts, srv, "nobody@example.com")
	if me := pending.do(t, http.MethodGet, "/console/api/v1/console/me").body; me["needs_registration"] != true {
		t.Fatalf("the session should be a pending registration: %v", me)
	}
	r := pending.doJSON(t, http.MethodPost, "/console/api/v1/console/register",
		map[string]any{"email": "nobody@example.com", "agree": true})
	r.mustStatus(t, http.StatusForbidden)

	// After the operator invites it, the same registration goes through - with
	// the code the invitation carries, which every invitation now has.
	invite := adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-invites",
		map[string]any{"email": "nobody@example.com"})
	invite.mustStatus(t, http.StatusOK)
	code, _ := invite.body["code"].(string)
	if code == "" {
		t.Fatalf("the invitation should carry a code: %s", invite.raw)
	}
	pending = pendingSession(t, ts, srv, "nobody@example.com")
	r = pending.doJSON(t, http.MethodPost, "/console/api/v1/console/register",
		map[string]any{"email": "nobody@example.com", "agree": true, "code": code})
	r.mustStatus(t, http.StatusNoContent)
}

// The admin address is exempt from the invitation gate, so the first operator
// can always register on a server that is invite-only from the start.
func TestAdminEmailBypassesTheInvitationCode(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)

	pending := pendingSession(t, ts, srv, testAdminEmail)
	r := pending.doJSON(t, http.MethodPost, "/console/api/v1/console/register",
		map[string]any{"email": testAdminEmail, "agree": true})
	r.mustStatus(t, http.StatusNoContent)

	op := signInAs(t, ts, srv, testAdminEmail)
	if role, _ := op.do(t, http.MethodGet, "/console/api/v1/console/me").body["role"].(string); role != store.RoleAdmin {
		t.Fatalf("the admin address registered without a code but role = %v", role)
	}
}

// An address with no code can *request* an invitation instead of being refused:
// the account is created pending, the operator can approve it, and the next
// sign-in shows the waiting notice rather than asking to register again.
func TestRequestingAnInvitationLeavesAPendingAccount(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)
	_ = operatorSession(t, ts, srv) // an operator exists; this is not the bootstrap

	pending := pendingSession(t, ts, srv, "hopeful@example.com")
	r := pending.doJSON(t, http.MethodPost, "/console/api/v1/console/register",
		map[string]any{"email": "hopeful@example.com", "agree": true, "request": true})
	r.mustStatus(t, http.StatusNoContent)

	// The session is kept for a request: it now resolves to the pending account,
	// so the console can show the waiting notice right away - and on the next
	// visit, because the session cookie is still valid.
	me := pending.do(t, http.MethodGet, "/console/api/v1/console/me").body
	if me["signed_in"] != true || me["pending_registration"] != true {
		t.Fatalf("the account should be waiting for an invitation: %v", me)
	}
	if me["needs_registration"] == true {
		t.Fatalf("a pending account must not be asked to register again: %v", me)
	}
}

// The register page is offered the address a sign-in link was sent to, which
// the passwordless claim does not carry (adr/0029).
func TestTheRegisterPageGetsTheSigninAddress(t *testing.T) {
	ts, srv := newInviteOnlyServer(t)

	var senderCalled bool
	srv.accounts.SetSenderOverride(func(string, string) error { senderCalled = true; return nil })
	client := &sessionClient{ts: ts, xsrfHeader: "X-XSRF-Token", srv: srv}
	r := client.doJSON(t, http.MethodPost,
		"/console/api/v1/console/signin-link?address=Linker@Example.com&user=linker&site=http://127.0.0.1:8223", nil)
	r.mustStatus(t, http.StatusOK)
	if !senderCalled {
		t.Fatal("the link was not sent")
	}
	var remembered string
	for _, c := range client.cookies {
		if c.Name == "tv_signin_address" {
			remembered = c.Value
		}
	}
	if remembered != "linker@example.com" {
		t.Fatalf("remembered address = %q, want the lower-cased one", remembered)
	}

	// The pending session - the same subject the link mints - reads it back.
	pending := pendingSession(t, ts, srv, "linker@example.com")
	pending.cookies = append(pending.cookies,
		&http.Cookie{Name: "tv_signin_address", Value: remembered})
	me := pending.do(t, http.MethodGet, "/console/api/v1/console/me").body
	reg, _ := me["registration"].(map[string]any)
	if reg == nil || reg["email"] != "linker@example.com" {
		t.Fatalf("registration = %v, want the remembered address", me["registration"])
	}
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

	// Approving mints the invitation and discards the placeholder, so the person
	// registers with the code like anybody else (adr/0029).
	r = adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-requests/"+uid+"/invite", nil)
	r.mustStatus(t, http.StatusOK)
	if code, _ := r.body["code"].(string); code == "" {
		t.Fatalf("the approval should return an invitation code: %s", r.raw)
	}
	if _, err := srv.store.AccountByID(context.Background(), uid); err == nil {
		t.Fatalf("the pending placeholder should be gone after the invite")
	}
	// ...and the person can now register with the code, which is the point.
	code, _ := r.body["code"].(string)
	reverify := pendingSession(t, ts, srv, "asker@example.com")
	reg := reverify.doJSON(t, http.MethodPost, "/console/api/v1/console/register",
		map[string]any{"email": "asker@example.com", "agree": true, "code": code})
	reg.mustStatus(t, http.StatusNoContent)

	// A second approval has nothing left to approve.
	r = adminDo(t, op, http.MethodPost,
		"/console/api/v1/admin/registration-requests/"+uid+"/invite", nil)
	r.mustStatus(t, http.StatusNotFound)
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
