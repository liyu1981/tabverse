package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/liyu1981/tabverse/server/internal/config"
)

// The passwordless flow is only as good as the delivery of its link, so the
// sender has honest modes and no pretending in between:
//
//   - SMTPfast configured: one HTTPS call to the smtpfa.st API
//   - SMTP configured: send it
//   - neither: log it
//
// The last is not a stub. A self hoster running on a LAN has nowhere to send
// mail, and a deployment that cannot deliver a link should say so out loud
// rather than accept a login nobody can complete.

func newSender(cfg config.Config, logger *slog.Logger, publicURL string) *mailSender {
	return &mailSender{cfg: cfg, log: logger, base: publicURL}
}

type mailSender struct {
	cfg  config.Config
	log  *slog.Logger
	base string
}

// Send delivers the library's message, whose only dynamic part is the link. The
// library's Sender is Send(address, text) error; it also offers a
// ContextSender variant, which this does not implement on purpose - see the note
// on the timeout below.
func (m *mailSender) Send(dest, msg string) error {
	body := msg + "\n\n" +
		"If you did not ask to sign in, ignore this: nothing has changed.\n"
	return m.sendMessage(dest, "Your Tabverse sign-in link", body)
}

// SendInvite delivers an operator's registration invitation. It is our own
// message rather than the library's, so it carries its own subject and body.
func (m *mailSender) SendInvite(dest, subject, body string) error {
	return m.sendMessage(dest, subject, body)
}

// sendMessage is the one delivery path. SMTPfast when its key is set (one HTTPS
// call, no local mail setup), then SMTP, then a loud log line - the no-mail case
// is not a stub, because a LAN deployment has nowhere to send and a message
// nobody can receive has to be visible somewhere.
func (m *mailSender) sendMessage(dest, subject, body string) error {
	if m.cfg.SMTPFastConfigured() {
		return m.sendViaSMTPFast(dest, subject, body)
	}
	if !m.cfg.SMTPConfigured() {
		m.log.Warn("no mail transport configured (TABVERSED_SMTPFAST_API_KEY or "+
			"TABVERSED_SMTP_HOST): printing the message instead of emailing it.", "to", dest)
		m.log.Info("  Subject: " + subject)
		for _, line := range strings.Split(body, "\n") {
			if line = strings.TrimSpace(line); line != "" {
				m.log.Info("  " + line)
			}
		}
		return nil
	}

	from := m.cfg.SMTPFrom
	if from == "" {
		from = "tabversed@" + hostOnly(m.cfg.SMTPHost)
	}

	var auth smtp.Auth
	if m.cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", m.cfg.SMTPUser, m.cfg.SMTPPass, m.cfg.SMTPHost)
	}
	// net.JoinHostPort, not Sprintf: an IPv6 literal has colons of its own.
	addr := net.JoinHostPort(m.cfg.SMTPHost, strconv.Itoa(m.cfg.SMTPPort))
	// A timeout matters: a hung SMTP server must not hold a login open.
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp dial %s: %w", addr, err)
	}
	client, err := smtp.NewClient(conn, m.cfg.SMTPHost)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp: %w", err)
	}
	defer client.Close()
	if err := client.Hello("localhost"); err != nil {
		return fmt.Errorf("smtp hello: %w", err)
	}
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := client.Mail(m.cfg.SMTPUser); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := client.Rcpt(dest); err != nil {
		return fmt.Errorf("smtp rcpt to %s: %w", dest, err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	message := strings.Join([]string{
		"From: " + from,
		"To: " + dest,
		"Subject: " + subject,
		"Date: " + time.Now().Format(time.RFC1123Z),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
	}, "\r\n")
	if _, err := w.Write([]byte(message)); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close body: %w", err)
	}
	return client.Quit()
}

func hostOnly(host string) string {
	if i := strings.LastIndex(host, ":"); i > 0 {
		return host[:i]
	}
	return host
}

// sendViaSMTPFast delivers through SMTPfast (smtpfa.st), a Resend-compatible
// HTTP email API. It is preferred when configured: one HTTPS call, no local mail
// setup, and the response says whether the message was accepted.
//
// `from` must be on a domain verified in the SMTPfast dashboard; SMTPFastFrom
// falls back to SMTPFrom so one address can serve both transports.
func (m *mailSender) sendViaSMTPFast(dest, subject, body string) error {
	from := strings.TrimSpace(m.cfg.SMTPFastFrom)
	if from == "" {
		from = strings.TrimSpace(m.cfg.SMTPFrom)
	}
	if from == "" {
		return fmt.Errorf("smtpfast: set TABVERSED_SMTPFAST_FROM (or TABVERSED_SMTP_FROM) to a verified sending address")
	}
	// A sign-in link or an invitation is mail the recipient needs because of an
	// action on their account, so it is transactional: it skips marketing
	// opt-outs and carries no unsubscribe header.
	payload, err := json.Marshal(map[string]any{
		"from":     from,
		"to":       []string{dest},
		"subject":  subject,
		"text":     body,
		"category": "transactional",
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	url := strings.TrimRight(m.cfg.SMTPFastBaseURL, "/") + "/emails"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+m.cfg.SMTPFastAPIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("smtpfast: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("smtpfast %d: %s", res.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}
