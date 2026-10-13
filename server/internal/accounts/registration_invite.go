package accounts

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/liyu1981/tabverse/server/internal/webui"
)

// RegistrationInviteEmail renders the invitation an operator sends. It is the
// one place the text lives: the console copies what this returns rather than
// writing its own, so a deployment with no SMTP and one with it send the same
// message.
//
// `address` and `code` are also put in a clickable console URL, so opening the
// message can fill both in; the code stays in the text as well, for the person
// who would rather type or paste it. `code` may be empty (the invited address is
// the whole gate); `expiresAt` of 0 means no expiry.
func RegistrationInviteEmail(publicURL, address, code string, expiresAt int64) (subject, body string) {
	console := strings.TrimRight(publicURL, "/") + webui.Mount
	subject = "You are invited to Tabverse"
	var b strings.Builder
	fmt.Fprintf(&b, "You have been invited to a Tabverse server.\n\n")
	if code != "" && address != "" {
		fmt.Fprintf(&b, "Click this link to open the console with your address and the code already filled in:\n  %s\n\n",
			inviteLink(console, address, code))
	}
	fmt.Fprintf(&b, "Or open the console and sign in with this address:\n  %s\n\n", console)
	if code != "" {
		fmt.Fprintf(&b, "This invitation also needs the code below:\n  %s\n\n", code)
	}
	if expiresAt > 0 {
		fmt.Fprintf(&b, "The invitation expires on %s.\n\n",
			time.UnixMilli(expiresAt).Format("2 January 2006, 15:04 MST"))
	}
	b.WriteString("If you were not expecting this, you can ignore it - nothing has happened yet.\n")
	return subject, b.String()
}

// inviteLink is the console URL with the address and the code in its query - the
// shape the console reads at boot, and keeps across the sign-in round trip
// (which drops the query).
func inviteLink(console, address, code string) string {
	q := url.Values{}
	q.Set("invite", code)
	q.Set("email", address)
	return console + "?" + q.Encode()
}

// RenderRegistrationInvite is the invitation text for this deployment, without
// sending it. The console shows it so the operator can copy it when there is no
// mail server.
func (s *Service) RenderRegistrationInvite(address, code string, expiresAt int64) (subject, body string) {
	return RegistrationInviteEmail(s.publicURL, address, code, expiresAt)
}

// SendMessage delivers an operator's own message - the console's drafted
// invitation - through the same sender. It renders nothing: the body is the
// caller's.
func (s *Service) SendMessage(dest, subject, body string) error {
	if s.sendOverride != nil {
		return s.sendOverride(dest, subject+"\n\n"+body)
	}
	return s.mail.SendInvite(dest, subject, body)
}

// SendRegistrationInvite renders and delivers an invitation. With no SMTP
// configured the sender logs it, so the call still succeeds and the caller
// still has the text to show.
func (s *Service) SendRegistrationInvite(dest, code string, expiresAt int64) (subject, body string, err error) {
	subject, body = RegistrationInviteEmail(s.publicURL, dest, code, expiresAt)
	if s.sendOverride != nil {
		return subject, body, s.sendOverride(dest, subject+"\n\n"+body)
	}
	return subject, body, s.mail.SendInvite(dest, subject, body)
}
