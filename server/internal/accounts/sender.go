package accounts

import (
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/liyu1981/tabverse/server/internal/config"
)

// The passwordless flow is only as good as the delivery of its link, so the
// sender has two honest modes and no pretending in between:
//
//   - SMTP configured: send it
//   - no SMTP: log it
//
// The second is not a stub. A self hoster running on a LAN has nowhere to send
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
	if !m.cfg.SMTPConfigured() {
		// Log it, and make it impossible to miss.
		m.log.Warn("no TABVERSED_SMTP_HOST configured: printing the sign-in link instead of "+
			"emailing it. Set the SMTP_* variables to send it properly.", "to", dest)
		for _, line := range strings.Split(msg, "\n") {
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
	subject := "Your Tabverse sign-in link"
	body := msg + "\n\n" +
		"If you did not ask to sign in, ignore this: nothing has changed.\n"

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
