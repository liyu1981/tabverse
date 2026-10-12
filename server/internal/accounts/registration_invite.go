package accounts

import (
	"fmt"
	"strings"
	"time"

	"github.com/liyu1981/tabverse/server/internal/webui"
)

// RegistrationInviteEmail renders the invitation an operator sends. It is the
// one place the text lives: the console copies what this returns rather than
// writing its own, so a deployment with no SMTP and one with it send the same
// message.
//
// `code` may be empty (the invited address is the whole gate); `expiresAt` of 0
// means no expiry.
func RegistrationInviteEmail(publicURL, code string, expiresAt int64) (subject, body string) {
	console := strings.TrimRight(publicURL, "/") + webui.Mount
	subject = "You are invited to Tabverse"
	var b strings.Builder
	fmt.Fprintf(&b, "You have been invited to a Tabverse server.\n\n")
	fmt.Fprintf(&b, "Open the console and sign in with this address:\n  %s\n\n", console)
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

// RenderRegistrationInvite is the invitation text for this deployment, without
// sending it. The console shows it so the operator can copy it when there is no
// mail server.
func (s *Service) RenderRegistrationInvite(code string, expiresAt int64) (subject, body string) {
	return RegistrationInviteEmail(s.publicURL, code, expiresAt)
}

// SendRegistrationInvite renders and delivers an invitation. With no SMTP
// configured the sender logs it, so the call still succeeds and the caller
// still has the text to show.
func (s *Service) SendRegistrationInvite(dest, code string, expiresAt int64) (subject, body string, err error) {
	subject, body = RegistrationInviteEmail(s.publicURL, code, expiresAt)
	if s.sendOverride != nil {
		return subject, body, s.sendOverride(dest, subject+"\n\n"+body)
	}
	return subject, body, s.mail.SendInvite(dest, subject, body)
}
