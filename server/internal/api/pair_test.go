package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Pairing an extension from the console's page (adr/0020). The session is the
// whole security story: an invite code is what a self-hosted deployment hands
// out, and a browser that wants its own server should not have to carry one.

func TestPairingAnExtensionNeedsASignedInAccount(t *testing.T) {
	ts, _ := newAccountServer(t)
	resp := postPair(t, ts, "", map[string]string{"device_name": "chrome"})
	resp.mustStatus(t, http.StatusUnauthorized)
	if resp.body["error"] != "unauthorized" {
		t.Fatalf("expected the sign-in refusal, got %s", resp.raw)
	}
}

func TestASignedInAccountMintsADeviceAndItsToken(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	aliceID, _ := alice.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	resp := alice.postJSON(t, "/api/v1/console/pair", map[string]string{
		"device_name":  "alice's laptop",
		"extension_id": "abcdefghijklmnoabcdefhijklmnoabc",
	})
	resp.mustStatus(t, http.StatusCreated)
	if resp.body["user_id"] != aliceID {
		t.Fatalf("the token belongs to %v, want the signed-in account %s", resp.body["user_id"], aliceID)
	}
	token, _ := resp.body["token"].(string)
	deviceID, _ := resp.body["device_id"].(string)
	if token == "" || deviceID == "" {
		t.Fatalf("no credentials came back: %s", resp.raw)
	}

	// The device is on the account's detail, named as the page asked - so
	// "which browser is this" is answerable later. The console reads the list
	// from the account itself (there is no separate devices route).
	detail := alice.do(t, http.MethodGet, "/api/v1/admin/users/"+aliceID)
	detail.mustStatus(t, http.StatusOK)
	if !bodyContains(detail.body, "alice's laptop") {
		t.Fatalf("the named device is not on the account: %s", detail.raw)
	}
	if !bodyContains(detail.body, deviceID) {
		t.Fatalf("the device is not on the account: %s", detail.raw)
	}

	// And the token is a real device credential: the extension's first request
	// with it is a sync pull, which is the whole point of handing it over.
	pull := bearerGet(t, ts, "/api/v1/sync?since=0", token)
	if pull.status != http.StatusOK {
		t.Fatalf("the new token cannot sync: %d %s", pull.status, pull.raw)
	}
}

func TestTheDeviceNameDefaultsWhenThePageAsksForNothing(t *testing.T) {
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	resp := alice.postJSON(t, "/api/v1/console/pair", map[string]string{})
	resp.mustStatus(t, http.StatusCreated)
	if resp.body["token"] == "" {
		t.Fatalf("no token came back: %s", resp.raw)
	}
}

func TestPairingTwiceIsTwoDevices(t *testing.T) {
	// Two browsers, two tokens: the wizard is not a login, it is what a browser
	// joins an account with, and a profile can have several.
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")

	first := alice.postJSON(t, "/api/v1/console/pair", map[string]string{"device_name": "laptop"})
	first.mustStatus(t, http.StatusCreated)
	second := alice.postJSON(t, "/api/v1/console/pair", map[string]string{"device_name": "desktop"})
	second.mustStatus(t, http.StatusCreated)
	if first.body["device_id"] == second.body["device_id"] {
		t.Fatal("two pairings made one device")
	}
	if first.body["token"] == second.body["token"] {
		t.Fatal("two pairings issued the same token")
	}
}

func TestAnAccountCannotNameTheAccountItPairs(t *testing.T) {
	// There is no account parameter, and a body that carries one is ignored:
	// the account is the session's.
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	bob := signInAs(t, ts, s, "bob@example.com")
	bobID, _ := bob.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	resp := alice.postJSON(t, "/api/v1/console/pair", map[string]string{
		"device_name": "sneaky",
		"user_id":     bobID,
	})
	resp.mustStatus(t, http.StatusCreated)
	aliceID, _ := resp.body["user_id"].(string)
	if aliceID == bobID {
		t.Fatalf("the body named the account: token went to %s", bobID)
	}
}

func TestPairingIsRefusedWhileLookingAtSomebodyElse(t *testing.T) {
	// An operator mid-impersonation is read only, and a token issued under an
	// assumed identity would outlive the impersonation.
	ts, s := newAccountServer(t)
	root := operatorSession(t, ts, s)
	rootID, _ := root.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)
	alice := signInAs(t, ts, s, "alice@example.com")
	aliceID, _ := alice.do(t, http.MethodGet, "/api/v1/console/me").body["user_id"].(string)

	root.do(t, http.MethodPost, "/api/v1/admin/users/"+aliceID+"/impersonate").
		mustStatus(t, http.StatusOK)

	resp := root.postJSON(t, "/api/v1/console/pair", map[string]string{"device_name": "not hers"})
	resp.mustStatus(t, http.StatusForbidden)
	if resp.body["error"] != "read_only" {
		t.Fatalf("expected the read-only refusal, got %s", resp.raw)
	}

	// Stop impersonating, and the operator's own account can pair again.
	root.do(t, http.MethodPost, "/api/v1/console/impersonate/stop").
		mustStatus(t, http.StatusNoContent)
	own := root.postJSON(t, "/api/v1/console/pair", map[string]string{"device_name": "operator's browser"})
	own.mustStatus(t, http.StatusCreated)
	if got, _ := own.body["user_id"].(string); got != rootID {
		t.Fatalf("the operator paired %v, want their own account %s", got, rootID)
	}
}

func TestPairingWithoutTheCSRFHeaderIsRefused(t *testing.T) {
	// The session cookie alone must not mint a credential: a page that got the
	// cookie without the XSRF token (a cross-site form post) is refused.
	ts, s := newAccountServer(t)
	alice := signInAs(t, ts, s, "alice@example.com")
	resp := postPairWithoutCSRF(t, ts, alice)
	if resp.status == http.StatusCreated {
		t.Fatalf("a post without the XSRF token minted a device: %s", resp.raw)
	}
}

// ---- helpers ----------------------------------------------------------------

// postPair is a session-free POST of the pair endpoint: the "not signed in" case.
func postPair(t *testing.T, ts *httptest.Server, cookie string, body map[string]string) apiResp {
	t.Helper()
	return rawPair(t, ts, cookie, body, true)
}

// postPairWithoutCSRF holds the session cookie but not the XSRF header, which is
// what a cross-site form post looks like to this server.
func postPairWithoutCSRF(t *testing.T, ts *httptest.Server, c *sessionClient) apiResp {
	t.Helper()
	return rawPair(t, ts, cookieHeader(c), map[string]string{"device_name": "chrome"}, false)
}

func cookieHeader(c *sessionClient) string {
	var out string
	for _, ck := range c.cookies {
		if out != "" {
			out += "; "
		}
		out += ck.Name + "=" + ck.Value
	}
	return out
}

func rawPair(t *testing.T, ts *httptest.Server, cookie string, body map[string]string, withCSRF bool) apiResp {
	t.Helper()
	data, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/console/pair", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	if withCSRF {
		for _, ck := range parseCookies(cookie) {
			if ck.Name == "tv_xsrf" {
				req.Header.Set("X-XSRF-Token", ck.Value)
			}
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return apiResp{status: res.StatusCode, body: out, raw: string(raw)}
}

func parseCookies(header string) []*http.Cookie {
	req := http.Request{Header: http.Header{}}
	req.Header.Set("Cookie", header)
	return req.Cookies()
}

// bearerGet is a request with a device token instead of a session, which is
// exactly what the extension does with the token this flow hands it.
func bearerGet(t *testing.T, ts *httptest.Server, path, token string) apiResp {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return apiResp{status: res.StatusCode, body: out, raw: string(raw)}
}

// bodyContains looks for a string anywhere in a decoded JSON value, which is
// what these assertions want: they care that a device id or a name is on the
// account, not where in it.
func bodyContains(v any, needle string) bool {
	switch typed := v.(type) {
	case string:
		return strings.Contains(typed, needle)
	case []any:
		for _, item := range typed {
			if bodyContains(item, needle) {
				return true
			}
		}
	case map[string]any:
		for _, item := range typed {
			if bodyContains(item, needle) {
				return true
			}
		}
	}
	return false
}
