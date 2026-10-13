package accounts

import (
	"net/url"
	"strings"
	"testing"
)

// The invitation carries a link that fills the register page in, and keeps the
// code as text too, for somebody who would rather paste it.
func TestRegistrationInviteCarriesAReadyLink(t *testing.T) {
	const code = "KQ3F-7T2M-9ZWD-4BHN"
	subject, body := RegistrationInviteEmail("https://tabs.example/", "Invitee@Example.com", code, 0)
	if subject == "" {
		t.Fatal("no subject")
	}
	// The code is still in the body in the clear, for manual copy.
	if !strings.Contains(body, code) {
		t.Fatalf("the code should be in the text: %q", body)
	}
	// And the link carries it with the address, in the console's query.
	link := "https://tabs.example/console?" + url.Values{
		"invite": {code},
		"email":  {"Invitee@Example.com"},
	}.Encode()
	if !strings.Contains(body, link) {
		t.Fatalf("the body should contain the ready link %q:\n%s", link, body)
	}
	// The bare console URL is still offered, for somebody who would rather sign
	// in and type the code.
	if !strings.Contains(body, "https://tabs.example/console\n") {
		t.Fatalf("the body should name the console on its own: %q", body)
	}
}

// With no code the invitation is the address alone, so there is nothing to put
// in a link and no code section to print.
func TestRegistrationInviteWithoutACodeHasNoLink(t *testing.T) {
	_, body := RegistrationInviteEmail("https://tabs.example", "a@b.c", "", 0)
	if strings.Contains(body, "?invite=") {
		t.Fatalf("an invitation with no code should have no link: %q", body)
	}
	if strings.Contains(body, "code below") {
		t.Fatalf("an invitation with no code should not print a code: %q", body)
	}
}
