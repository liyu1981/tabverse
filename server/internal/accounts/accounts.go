// Package accounts is the server's account layer (adr/0012): who a *person* is,
// as opposed to which device is talking.
//
// Not to be confused with internal/auth, which issues the extension's opaque
// device tokens and pairing codes. The extension never logs in - it pairs,
// because a service worker cannot use cookies and an extension has no business
// holding a password. This package is for the web console, where a person signs
// in with an account and then manages their devices and looks at their data.
//
// The OAuth2 dance, the JWT cookie, the XSRF echo, refresh and the provider
// allow-list are go-pkgz/auth's, because they are solved problems. What stays
// ours is everything about *our* data:
//
//   - the account is a row in our own users table, with the same id the sync
//     protocol uses
//   - the password hash is ours (Argon2id); the library only asks a yes/no
//     question through its credential checker
//   - revocation is a cut-off column, not a session table
//   - "the person who signed in" becomes "the rows they own" in one place, the
//     authenticator's UpdateUser hook, which is also where the role is attached
package accounts

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/liyu1981/tabverse/server/internal/store"
)

// ErrInvalidCredentials is deliberately vague: "no such account" and "wrong
// password" must be indistinguishable, or the login form becomes an account
// enumeration oracle.
var ErrInvalidCredentials = errors.New("invalid email or password")

// SessionRevocationWindow is how long a revocation can take to bite.
//
// go-pkgz/auth stamps IssuedAt with time.Unix(now, 0) when it signs a session,
// so a session's issue time carries no sub-second precision (setting the JWT
// library's global precision does not help: the value itself has zero
// nanoseconds). Revocation is therefore compared at second granularity, and the
// two consequences are accepted rather than papered over:
//
//   - a cut-off takes effect within one second
//   - a login that lands in the same second as a revocation is refused once and
//     succeeds on retry
//
// Everything else in the server is millisecond resolution. This is the one
// place that is not, and the reason belongs to the library.
const SessionRevocationWindow = time.Second

// Argon2id parameters: 64 MiB and three passes is the OWASP baseline. The
// parameters live inside the hash string, so raising them later does not
// invalidate existing passwords - they are re-encoded on the next login.
const (
	argonTime    = 3
	argonMemory  = 64 * 1024 // KiB
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

// MinPasswordLength is a sanity floor, not a security control: anything shorter
// is a typo, and refusing it is kinder than storing a weak account.
const MinPasswordLength = 8

// HashPassword returns an encoded Argon2id hash:
//
//	$argon2id$v=19$m=65536,t=3,p=2$<salt>$<key>
func HashPassword(password string) (string, error) {
	if len(password) < MinPasswordLength {
		return "", fmt.Errorf("password must be at least %d characters", MinPasswordLength)
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword checks a password against an encoded hash, comparing the key in
// constant time. A malformed hash is a failed login, not a panic: the column is
// data, and data can be wrong.
func VerifyPassword(encoded, password string) bool {
	// "", "argon2id", "v=19", "m=..,t=..,p=..", salt, key
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var memory uint32
	var iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// ResolveAccountID turns a session id into the account that owns the data.
//
// go-pkgz/auth's convention is that a user id is "<provider>_<subject>": the
// authenticator's provider allow-list reads that prefix, which is the only way
// it knows which login produced a token. Ours is a plain "usr_..." row id, so
// the two are bridged here and in exactly one other place - the authenticator's
// UpdateUser hook, which rewrites the claim for the request that follows.
//
// The subject is our own user id, because UserIDFunc hands it over at login: the
// pairing is made once, at sign-in, and every later request is a primary key
// lookup.
func ResolveAccountID(ctx context.Context, st *store.Store, sessionID string) (string, error) {
	subject := sessionID
	if i := strings.IndexByte(sessionID, '_'); i >= 0 {
		subject = sessionID[i+1:]
	}
	if subject == "" {
		return "", store.ErrNotFound
	}
	if _, err := st.AccountByID(ctx, subject); err != nil {
		return "", err
	}
	return subject, nil
}

// SessionAllowed is the one predicate that decides whether a session token is
// still good: the account exists, is not disabled, and the token was issued
// after the account's revocation cut-off.
//
// It is a function rather than a closure over the store so that the
// authenticator's Validator hook and the tests can share one implementation -
// a second copy of this rule is how "revoked but still logged in" happens.
func SessionAllowed(ctx context.Context, st *store.Store, sessionID string, issuedAt time.Time) bool {
	userID, err := ResolveAccountID(ctx, st, sessionID)
	if err != nil {
		// An account that no longer exists cannot hold a live session.
		return false
	}
	if _, err := st.RoleOf(ctx, userID); err != nil {
		// RoleOf reports ErrAccountDisabled for a switched-off account.
		return false
	}
	cut, err := st.TokensValidAfter(ctx, userID)
	if err != nil {
		return false
	}
	if issuedAt.IsZero() {
		return true
	}
	// Second granularity: see SessionRevocationWindow.
	return issuedAt.Unix() > time.UnixMilli(cut).Unix()
}
