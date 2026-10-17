package api

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// The membership surface (adr/0032): a paired device is refused at the expiry
// instant, a signed-in account is read-only while expired, and the master switch
// turns the whole thing off.

func bootstrapDevice(t *testing.T, ts string) (token, userID string) {
	t.Helper()
	res := doJSON(t, http.MethodPost, ts+"/console/api/v1/auth/bootstrap", "",
		map[string]string{"name": "membership-test"})
	res.mustStatus(t, http.StatusCreated)
	token, _ = res.body["token"].(string)
	userID, _ = res.body["user_id"].(string)
	if token == "" || userID == "" {
		t.Fatalf("bootstrap returned no token/user: %s", res.raw)
	}
	return token, userID
}

func TestSyncIsRefusedWhenTheLeaseHasExpired(t *testing.T) {
	ts, s := newTestServer(t)
	ctx := context.Background()
	token, userID := bootstrapDevice(t, ts.URL)

	if err := s.membership.SetEnabled(ctx, true, ""); err != nil {
		t.Fatalf("enable membership: %v", err)
	}
	// The enrollment sweep granted the trial, so the device still syncs.
	doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/sync?since=0", token, nil).
		mustStatus(t, http.StatusOK)

	// Expire it, without waiting for the worker.
	if _, err := s.store.SetMembership(ctx, userID, time.Now().Add(-time.Hour).UnixMilli(), false, "", "test"); err != nil {
		t.Fatalf("expire: %v", err)
	}

	pull := doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/sync?since=0", token, nil)
	pull.mustStatus(t, http.StatusPaymentRequired)
	if pull.body["error"] != "membership_expired" {
		t.Fatalf("error = %v, want membership_expired; body: %s", pull.body["error"], pull.raw)
	}

	push := doJSON(t, http.MethodPost, ts.URL+"/console/api/v1/sync", token, map[string]any{
		"records": []map[string]any{{
			"entity": "note", "id": "n1", "updated_at": time.Now().UnixMilli(), "payload": `{"text":"x"}`,
		}},
	})
	push.mustStatus(t, http.StatusPaymentRequired)
}

func TestTheMasterSwitchRestoresUnlimited(t *testing.T) {
	ts, s := newTestServer(t)
	ctx := context.Background()
	token, userID := bootstrapDevice(t, ts.URL)
	if err := s.membership.SetEnabled(ctx, true, ""); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if _, err := s.store.SetMembership(ctx, userID, time.Now().Add(-time.Hour).UnixMilli(), false, "", "test"); err != nil {
		t.Fatalf("expire: %v", err)
	}
	doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/sync?since=0", token, nil).
		mustStatus(t, http.StatusPaymentRequired)

	// Turning the switch off must give everybody unlimited, expired lease or not.
	if err := s.membership.SetEnabled(ctx, false, ""); err != nil {
		t.Fatalf("disable: %v", err)
	}
	doJSON(t, http.MethodGet, ts.URL+"/console/api/v1/sync?since=0", token, nil).
		mustStatus(t, http.StatusOK)
}

// sessionRaw is do() for a non-JSON body (the NDJSON export).
func sessionRaw(t *testing.T, c *sessionClient, method, path string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, c.ts.URL+path, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	for _, cookie := range c.cookies {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	c.keepCookies(res)
	return res.StatusCode, string(raw)
}

func TestAnExpiredConsoleSessionIsReadOnly(t *testing.T) {
	ts, s := newServerWithConfig(t, testAdminEmail)
	ctx := context.Background()
	client := signInAs(t, ts, s, "member@example.com")

	me := client.do(t, http.MethodGet, "/console/api/v1/console/me")
	me.mustStatus(t, http.StatusOK)
	userID, _ := me.body["user_id"].(string)
	if userID == "" {
		t.Fatalf("no user id in /me: %s", me.raw)
	}

	if err := s.membership.SetEnabled(ctx, true, ""); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if _, err := s.store.SetMembership(ctx, userID, time.Now().Add(-time.Hour).UnixMilli(), false, "", "test"); err != nil {
		t.Fatalf("expire: %v", err)
	}

	// Reads and the download still work.
	client.do(t, http.MethodGet, "/console/api/v1/admin/users/"+userID).mustStatus(t, http.StatusOK)
	client.do(t, http.MethodGet, "/console/api/v1/console/membership").mustStatus(t, http.StatusOK)
	if code, raw := sessionRaw(t, client, http.MethodGet, "/console/api/v1/console/export"); code != http.StatusOK {
		t.Fatalf("export = %d, want 200; body: %s", code, raw)
	} else if !strings.Contains(raw, `"type":"manifest"`) {
		t.Fatalf("export did not start with a manifest: %s", raw)
	}

	// A write is refused with the same 402 a device gets.
	rename := client.doJSON(t, http.MethodPut, "/console/api/v1/admin/users/"+userID,
		map[string]string{"name": "nope"})
	rename.mustStatus(t, http.StatusPaymentRequired)
	if rename.body["error"] != "membership_expired" {
		t.Fatalf("rename error = %v, want membership_expired; body: %s", rename.body["error"], rename.raw)
	}

	// Renewal is allowed through the read-only gate: it fails on credits, not on
	// the lease, which proves the allowlist.
	renew := client.doJSON(t, http.MethodPost, "/console/api/v1/console/membership/renew", nil)
	renew.mustStatus(t, http.StatusPaymentRequired)
	if renew.body["error"] != "insufficient_credits" {
		t.Fatalf("renew error = %v, want insufficient_credits; body: %s", renew.body["error"], renew.raw)
	}
}

func TestOperatorIsNeverReadOnly(t *testing.T) {
	ts, s := newServerWithConfig(t, testAdminEmail)
	client := operatorSession(t, ts, s)
	me := client.do(t, http.MethodGet, "/console/api/v1/console/me")
	userID, _ := me.body["user_id"].(string)

	if err := s.membership.SetEnabled(context.Background(), true, ""); err != nil {
		t.Fatalf("enable: %v", err)
	}
	// Even an expired lease on the operator account: role exempts it.
	if _, err := s.store.SetMembership(context.Background(), userID,
		time.Now().Add(-time.Hour).UnixMilli(), false, "", "test"); err != nil {
		t.Fatalf("expire operator: %v", err)
	}
	client.doJSON(t, http.MethodPut, "/console/api/v1/admin/users/"+userID,
		map[string]string{"name": "renamed"}).mustStatus(t, http.StatusNoContent)
}

func TestAdminCanGrantCreditsAndExtend(t *testing.T) {
	ts, s := newServerWithConfig(t, testAdminEmail)
	op := operatorSession(t, ts, s)
	member := signInAs(t, ts, s, "granted@example.com")
	me := member.do(t, http.MethodGet, "/console/api/v1/console/me")
	userID, _ := me.body["user_id"].(string)

	if err := s.membership.SetEnabled(context.Background(), true, ""); err != nil {
		t.Fatalf("enable: %v", err)
	}
	// Grant 30 credits, then spend them on a period.
	op.doJSON(t, http.MethodPost, "/console/api/v1/admin/users/"+userID+"/membership/credits",
		map[string]any{"delta": 30, "reason": "grant"}).mustStatus(t, http.StatusOK)
	extend := op.doJSON(t, http.MethodPost, "/console/api/v1/admin/users/"+userID+"/membership/extend",
		map[string]any{"periods": 1, "use_credits": true})
	extend.mustStatus(t, http.StatusOK)

	view := op.do(t, http.MethodGet, "/console/api/v1/admin/users/"+userID+"/membership")
	view.mustStatus(t, http.StatusOK)
	mem, _ := view.body["membership"].(map[string]any)
	if mem["credits"].(float64) != 0 {
		t.Fatalf("credits after one paid period = %v, want 0", mem["credits"])
	}
}

// root must be immune to the two ways of removing access.
func TestConfiguredRootCannotBeClosedOrDePrivileged(t *testing.T) {
	ts, s := newServerWithConfig(t, testAdminEmail)
	op := operatorSession(t, ts, s)
	me := op.do(t, http.MethodGet, "/console/api/v1/console/me")
	rootID, _ := me.body["user_id"].(string)
	if err := s.membership.SetEnabled(context.Background(), true, ""); err != nil {
		t.Fatalf("enable: %v", err)
	}

	op.doJSON(t, http.MethodPost, "/console/api/v1/admin/users/"+rootID+"/membership/unlimited",
		map[string]any{"unlimited": false}).mustStatus(t, http.StatusForbidden)
	op.do(t, http.MethodPost, "/console/api/v1/admin/users/"+rootID+"/membership/close").
		mustStatus(t, http.StatusForbidden)
}

func TestExportCarriesTheAccountsRecords(t *testing.T) {
	ts, s := newServerWithConfig(t, testAdminEmail)
	client := signInAs(t, ts, s, "exporter@example.com")
	me := client.do(t, http.MethodGet, "/console/api/v1/console/me")
	userID, _ := me.body["user_id"].(string)

	if _, _, err := s.store.ApplyRecords(context.Background(), userID, "dev_1", []store.RecordInput{
		{Entity: "note", ID: "n1", UpdatedAt: time.Now().UnixMilli(), Payload: `{"text":"exported"}`},
	}, 1<<20); err != nil {
		t.Fatalf("apply: %v", err)
	}
	code, raw := sessionRaw(t, client, http.MethodGet, "/console/api/v1/console/export")
	if code != http.StatusOK {
		t.Fatalf("export = %d; body: %s", code, raw)
	}
	if !strings.Contains(raw, `"user_id":"`+userID+`"`) {
		t.Fatalf("export manifest names the wrong account: %s", raw)
	}
	if !strings.Contains(raw, `"id":"n1"`) {
		t.Fatalf("export did not carry the account's record: %s", raw)
	}
}
