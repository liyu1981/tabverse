// Package auth issues opaque access tokens and single use pairing codes.
//
// Tokens are generated as 32 bytes of CSPRNG entropy, returned to the client
// exactly once, and stored server side only as a SHA-256 hash. Losing the
// token means re-pairing the device, which is the intended UX for an
// extension (no passwords).
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"strings"
)

var enc = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewToken returns a fresh opaque access token and its hash.
func NewToken() (plain string, hash string) {
	plain = randomToken(32)
	return plain, HashToken(plain)
}

// HashToken returns the storage hash of a plaintext token.
func HashToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// EqualHash compares a presented token with a stored hash in constant time.
func EqualHash(hash, storedHash string) bool {
	return subtle.ConstantTimeCompare([]byte(hash), []byte(storedHash)) == 1
}

// NewInviteCode returns a human transcribable pairing code, e.g.
// "KQ3F-7T2M-9ZWD-4BHN". Single use, short lived (enforced by the caller).
func NewInviteCode() (display string, normalized string) {
	raw := make([]byte, 10)
	if _, err := rand.Read(raw); err != nil {
		panic(err) // crypto/rand failure is not recoverable
	}
	code := enc.EncodeToString(raw) // 16 chars
	groups := make([]string, 0, 4)
	for i := 0; i < len(code); i += 4 {
		groups = append(groups, code[i:i+4])
	}
	normalized = code
	return strings.Join(groups, "-"), normalized
}

// NormalizeInviteCode canonicalizes a code typed by a human.
func NormalizeInviteCode(code string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(code)) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func randomToken(n int) string {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return enc.EncodeToString(raw)
}
