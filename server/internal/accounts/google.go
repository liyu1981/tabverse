package accounts

import (
	"crypto/sha1"
	"strings"

	"github.com/go-pkgz/auth/v2"
	"github.com/go-pkgz/auth/v2/provider"
	"github.com/go-pkgz/auth/v2/token"
	"golang.org/x/oauth2/google"
)

// Google, registered by hand instead of through svc.AddProvider("google", ...).
//
// The library's built-in Google provider asks for one scope - profile - and its
// userinfo mapping keeps only the id, the name and the picture. So the account
// this console builds has **no address at all**, which is not a cosmetic gap
// here:
//
//   - the address is the account's identity: `TABVERSED_ADMIN_EMAIL` is matched
//     against it, and `TABVERSED_LINK_BY_EMAIL` merges a social login with an
//     existing account by it;
//   - an address nobody proved is refused, because
//     TABVERSED_REQUIRE_EMAIL_VERIFICATION defaults to true;
//   - and with no address at all, two Google users collide on the unique index
//     over users.email, so the second one cannot register.
//
// So this asks for the email scope as well and keeps what Google sends back.
// Nothing else about the flow changes: same endpoints as the library's own
// provider (google.Endpoint), same userinfo document, same callback URI - so
// the redirect URI registered in Google's console stays the one that works.
const (
	scopeGoogleProfile = "https://www.googleapis.com/auth/userinfo.profile"
	scopeGoogleEmail   = "https://www.googleapis.com/auth/userinfo.email"
	// googleUserInfoURL is the v3 userinfo endpoint, the same one the library's
	// own Google provider reads. It answers with `email` and `email_verified`
	// only when the email scope was granted.
	googleUserInfoURL = "https://www.googleapis.com/oauth2/v3/userinfo"
	// emailVerifiedAttr rides along in the claim: Google's own statement that the
	// address is verified, which is what makes a Google sign-in prove an address
	// the way following an emailed link does.
	emailVerifiedAttr = "email_verified"
)

// addGoogleProvider registers Google with the email scope, in place of the
// library's profile-only preset.
func addGoogleProvider(svc *auth.Service, clientID, clientSecret string) {
	svc.AddCustomProvider("google",
		auth.Client{Cid: clientID, Csecret: clientSecret},
		provider.CustomHandlerOpt{
			Endpoint:  google.Endpoint,
			InfoURL:   googleUserInfoURL,
			Scopes:    []string{scopeGoogleProfile, scopeGoogleEmail},
			MapUserFn: googleUser,
		})
}

// googleUser maps Google's userinfo document onto the claim.
//
// The subject is `sub`, not `id` (Google's accounts API uses `id`, the OAuth
// one does not), and it is hashed and prefixed with the provider name - which is
// what the library's own Google mapping does, for the same reason: two providers
// can hand out the same subject, and the prefix is also how the account layer
// decides which login this was.
func googleUser(data provider.UserData, _ []byte) token.User {
	subject := data.Value("sub")
	u := token.User{
		ID:      googleSubjectID(subject),
		Name:    data.Value("name"),
		Picture: data.Value("picture"),
		Email:   data.Value("email"),
	}
	if u.Name == "" {
		// Google's display name is optional, and an account with no name renders
		// as a blank row everywhere.
		u.Name = "noname_" + shortSubject(subject)
	}
	if strings.EqualFold(data.Value("email_verified"), "true") {
		u.SetBoolAttr(emailVerifiedAttr, true)
	}
	return u
}

// googleSubjectID is the claim id for a Google subject.
func googleSubjectID(subject string) string {
	if subject == "" {
		// No subject means no identity. Returning "" rather than the hash of an
		// empty string matters: that hash is the same for everybody, so every
		// such login would land on one account.
		return ""
	}
	return "google_" + token.HashID(sha1.New(), subject)
}

func shortSubject(subject string) string {
	if len(subject) <= 12 {
		return subject
	}
	return subject[:12]
}
