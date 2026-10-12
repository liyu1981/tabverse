package accounts

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/liyu1981/tabverse/server/internal/config"
)

// Resend is the preferred transport: one HTTPS call, carrying the caller's
// message.
func TestSenderPrefersResend(t *testing.T) {
	var gotPath, gotAuth string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"email_1"}`))
	}))
	defer srv.Close()

	cfg := config.Config{
		ResendAPIKey:  "re_test",
		ResendFrom:    "tabs@example.com",
		ResendBaseURL: srv.URL,
	}
	m := newSender(cfg, nil, "http://127.0.0.1:8223")
	if err := m.SendInvite("newbie@example.com", "You are invited", "body text"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if gotPath != "/emails" {
		t.Fatalf("path = %q, want /emails", gotPath)
	}
	if gotAuth != "Bearer re_test" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if gotBody["from"] != "tabs@example.com" || gotBody["subject"] != "You are invited" ||
		gotBody["text"] != "body text" {
		t.Fatalf("body = %v", gotBody)
	}
	to, _ := gotBody["to"].([]any)
	if len(to) != 1 || to[0] != "newbie@example.com" {
		t.Fatalf("to = %v", gotBody["to"])
	}
}

// A rejection from Resend is surfaced, not swallowed: the operator has to know
// the invitation did not go out.
func TestSenderReportsResendError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"message":"domain is not verified"}`))
	}))
	defer srv.Close()

	cfg := config.Config{ResendAPIKey: "re", ResendFrom: "a@b.c", ResendBaseURL: srv.URL}
	m := newSender(cfg, nil, "")
	err := m.SendInvite("x@y.z", "s", "b")
	if err == nil || !strings.Contains(err.Error(), "422") {
		t.Fatalf("err = %v, want a 422 error", err)
	}
}

// Resend needs a From on a verified domain; without one the caller gets a
// sentence rather than a send that quietly fails at the API.
func TestSenderRequiresFromForResend(t *testing.T) {
	cfg := config.Config{ResendAPIKey: "re", ResendBaseURL: "http://127.0.0.1:1"}
	m := newSender(cfg, nil, "")
	if err := m.SendInvite("x@y.z", "s", "b"); err == nil {
		t.Fatalf("expected an error when no from address is set")
	}
}
