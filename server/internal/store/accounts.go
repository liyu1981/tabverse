package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// The account layer (adr/0012): who a person is, as opposed to which device
// is talking. The extension's device tokens are unchanged - a device is paired,
// never logged in - so everything here exists for the web console.
//
// Three ideas, deliberately kept apart:
//
//	users.email / password_hash  one login the person types
//	identities                   one row per external login (github, google, oidc)
//	audit_log                    who did what, including impersonation
//
// The session token itself is a JWT in a cookie (go-pkgz/auth), so there is no
// session table: revocation is `users.tokens_valid_after`, a cut-off that
// invalidates everything issued before it.

// Roles. The empty role on an account that predates this column reads as
// "user", so an existing deployment is never accidentally an admin.
const (
	RoleUser  = "user"
	RoleAdmin = "admin"
)

// Audit actions worth naming as constants, so a typo in a caller is a compile
// error rather than a mystery in the log.
const (
	AuditLogin           = "login"
	AuditLoginFailed     = "login_failed"
	AuditLogout          = "logout"
	AuditPasswordChange  = "password_change"
	AuditPasswordReset   = "password_reset"
	AuditEmailVerified   = "email_verified"
	AuditRoleChange      = "role_change"
	AuditUserDisabled    = "user_disabled"
	AuditUserDeleted     = "user_deleted"
	AuditImpersonateIn   = "impersonate_start"
	AuditImpersonateOut  = "impersonate_end"
	AuditImpersonateFail = "impersonate_denied"
	// The credential lifecycle, which is what an operator asks about after an
	// incident: who added a device, who cut one off.
	AuditPairingCode     = "pairing_code"
	AuditDeviceRevoked   = "device_revoked"
	AuditTokenRevoked    = "token_revoked"
	AuditTokenArchived   = "token_archived"
	AuditDeviceArchived  = "device_archived"
	AuditRecordsArchived = "records_archived"
	AuditAccountRenamed  = "account_renamed"
	AuditRoleChanged     = "role_changed"
	AuditAccountDisabled = "account_disabled"
)

// Email token purposes.
const (
	EmailPurposeVerify = "verify"
	EmailPurposeReset  = "reset"
)

// Account is a person's login, on top of the sync account that already existed.
type Account struct {
	ID    string
	Name  string
	Email string
	// EmailVerifiedAt is nil until the address is proven; a console that
	// requires verification refuses to trust an unproven one.
	EmailVerifiedAt *time.Time
	// PasswordHash is the encoded Argon2id hash, or empty for an
	// account that only logs in with an external provider.
	PasswordHash string
	Role         string
	DisabledAt   *time.Time
	CreatedAt    time.Time
}

// IsAdmin reports whether the account may reach the operator surfaces.
func (a Account) IsAdmin() bool { return a.Role == RoleAdmin }

// CanLogin reports whether the account is allowed to authenticate at all.
func (a Account) CanLogin() bool { return a.DisabledAt == nil }

// RoleOf returns the account's role, defaulting to "user" for accounts that
// predate the column.
func (s *Store) RoleOf(ctx context.Context, userID string) (string, error) {
	var role sql.NullString
	var disabled sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		`SELECT role, disabled_at FROM users WHERE id = ?`, userID).Scan(&role, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if disabled.Valid {
		return "", ErrAccountDisabled
	}
	if !role.Valid || role.String == "" {
		return RoleUser, nil
	}
	return role.String, nil
}

// ErrAccountDisabled is returned for an account an operator switched off.
var ErrAccountDisabled = errors.New("account disabled")

// ErrEmailTaken is returned when a login claims an address that already has an
// account and the deployment does not allow linking: one address, one account.
var ErrEmailTaken = errors.New("an account already uses this email address")

// AccountByEmail finds the account with this address. The comparison is
// case-insensitive because people type their address however they like, and the
// unique index on users.email is case sensitive.
func (s *Store) AccountByEmail(ctx context.Context, email string) (Account, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return Account{}, ErrNotFound
	}
	var a Account
	var verified, disabled sql.NullInt64
	var hash, role sql.NullString
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, email, email_verified_at, password_hash, role, disabled_at, created_at
		FROM users WHERE lower(email) = ?`, email).
		Scan(&a.ID, &a.Name, &a.Email, &verified, &hash, &role, &disabled, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	a.EmailVerifiedAt = nullTime(verified)
	a.DisabledAt = nullTime(disabled)
	a.PasswordHash, a.Role, a.CreatedAt = hash.String, role.String, unixMS(createdAt)
	return a, nil
}

// AccountByID returns the account behind a sync user.
func (s *Store) AccountByID(ctx context.Context, id string) (Account, error) {
	var a Account
	var email, hash, role sql.NullString
	var verified, disabled sql.NullInt64
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, email, email_verified_at, password_hash, role, disabled_at, created_at
		FROM users WHERE id = ?`, id).
		Scan(&a.ID, &a.Name, &email, &verified, &hash, &role, &disabled, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	a.Email, a.PasswordHash, a.Role = email.String, hash.String, role.String
	a.EmailVerifiedAt, a.CreatedAt = nullTime(verified), unixMS(createdAt)
	a.DisabledAt = nullTime(disabled)
	return a, nil
}

func nullTime(v sql.NullInt64) *time.Time {
	if !v.Valid {
		return nil
	}
	t := unixMS(v.Int64)
	return &t
}

// SetEmail records the address a person logs in with.
func (s *Store) SetEmail(ctx context.Context, userID, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return fmt.Errorf("email must not be empty")
	}
	res, err := s.db.ExecContext(ctx, `UPDATE users SET email = ? WHERE id = ?`, email, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkEmailVerified proves the address.
//
// It deliberately does *not* move the revocation cut-off. The cut-off exists to
// invalidate sessions issued before a *credential* change - a new password - and
// proving an email address is not that: the account could not sign in at all
// until the address was proven, so there is no earlier session to invalidate.
// Bumping it here instead invalidated the very first sign-in, because that
// session is issued in the same millisecond the proof happens.
func (s *Store) MarkEmailVerified(ctx context.Context, userID string) error {
	now := nowMS()
	res, err := s.db.ExecContext(ctx,
		`UPDATE users SET email_verified_at = ? WHERE id = ?`, now, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetPasswordHash stores a new password hash and invalidates every session
// issued before it, which is what makes "log out everywhere after a password
// change" work with stateless tokens.
func (s *Store) SetPasswordHash(ctx context.Context, userID, hash string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE users SET password_hash = ?, tokens_valid_after = ? WHERE id = ?`,
		hash, nowMS(), userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetRole promotes or demotes an account. The target cannot be the last admin,
// which would leave the deployment with nobody able to fix it.
func (s *Store) SetRole(ctx context.Context, userID, role string) error {
	if role != RoleUser && role != RoleAdmin {
		return fmt.Errorf("unknown role %q", role)
	}
	if err := s.RequireUser(ctx, userID); err != nil {
		return err
	}
	if role != RoleAdmin {
		admins, err := s.CountAdmins(ctx)
		if err != nil {
			return err
		}
		if admins <= 1 {
			var current string
			if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(role, 'user') FROM users WHERE id = ?`, userID).
				Scan(&current); err != nil {
				return err
			}
			if current == RoleAdmin {
				return errors.New("cannot demote the last admin")
			}
		}
	}
	_, err := s.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, role, userID)
	return err
}

// CountAdmins is how many accounts may reach the operator surfaces.
func (s *Store) CountAdmins(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM users WHERE role = ? AND disabled_at IS NULL`, RoleAdmin).Scan(&n)
	return n, err
}

// SetDisabled switches an account off (or back on). Disabling also kills its
// sessions, and refuses to disable the last admin.
func (s *Store) SetDisabled(ctx context.Context, userID string, disabled bool) error {
	if err := s.RequireUser(ctx, userID); err != nil {
		return err
	}
	if disabled {
		role, err := s.RoleOf(ctx, userID)
		if err != nil {
			return err
		}
		if role == RoleAdmin {
			if admins, err := s.CountAdmins(ctx); err != nil {
				return err
			} else if admins <= 1 {
				return errors.New("cannot disable the last admin")
			}
		}
		if _, err := s.db.ExecContext(ctx,
			`UPDATE users SET disabled_at = ?, tokens_valid_after = ? WHERE id = ?`,
			nowMS(), nowMS(), userID); err != nil {
			return err
		}
		return nil
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET disabled_at = NULL WHERE id = ?`, userID)
	return err
}

// TokensValidAfter is the revocation cut-off: sessions issued at or before this
// instant are refused. go-pkgz/auth calls the hook that enforces it.
func (s *Store) TokensValidAfter(ctx context.Context, userID string) (int64, error) {
	var cut sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT tokens_valid_after FROM users WHERE id = ?`, userID).Scan(&cut)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if !cut.Valid {
		return 0, nil
	}
	return cut.Int64, nil
}

// ---- external identities --------------------------------------------------

// Identity is one external login (github, google, a self hosted OIDC server)
// attached to an account. A person may have several, and may also have a
// password; the account is what ties them together.
type Identity struct {
	Provider  string
	Subject   string
	Email     string
	UserID    string
	CreatedAt time.Time
}

// UpsertIdentity resolves an external login to an account, creating the account
// on first sight. This is the one place a person becomes a user of the server.
//
// Linking rule: an external login whose email matches an existing account links
// to it, which is what makes "sign in with Google" land on the account you
// registered with.
//
// That is only safe while the provider verifies the address. A deployment that
// cannot vouch for its providers sets linkByEmail false, and then a login
// claiming an address that already has an account is *refused* with
// ErrEmailTaken rather than linked - and it is definitely not given a second
// account, because one address is one account: a duplicate would be a way to
// end up with two accounts holding the same person's data, one of which nobody
// is looking at.
func (s *Store) UpsertIdentity(ctx context.Context, provider, subject, email, name string, linkByEmail bool) (userID string, created bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback()

	// already known?
	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT user_id FROM identities WHERE provider = ? AND subject = ?`,
		provider, subject).Scan(&existing)
	switch {
	case err == nil:
		return existing, false, tx.Commit()
	case !errors.Is(err, sql.ErrNoRows):
		return "", false, err
	}

	email = strings.ToLower(strings.TrimSpace(email))
	var linked string
	if email != "" {
		if err := tx.QueryRowContext(ctx,
			`SELECT id FROM users WHERE lower(email) = ?`, email).Scan(&linked); err != nil &&
			!errors.Is(err, sql.ErrNoRows) {
			return "", false, err
		}
		if linked != "" && !linkByEmail {
			return "", false, ErrEmailTaken
		}
	}
	if linked == "" {
		// Before creating a row, is there an abandoned one to adopt? A server
		// that predates accounts has sync users with no email: they got there
		// through the old bootstrap or a pairing code. With exactly one such
		// user it is obviously the person registering now, and adopting the row
		// keeps their id - so every record they already synced stays attached
		// instead of being orphaned on an account the console cannot show.
		//
		// With more than one it is a guess, and a wrong guess would hand one
		// person another person's browsing history, so nothing is adopted and
		// the caller is expected to say so out loud.
		adoptable, err := adoptableUserTx(ctx, tx)
		if err != nil {
			return "", false, err
		}
		if adoptable != "" {
			// The name is *not* taken from the provider: an adopted row was
			// named when the server was bootstrapped or paired, and a GitHub
			// display name is no reason to throw that away. The address is
			// what makes it an account.
			if _, err := tx.ExecContext(ctx,
				`UPDATE users SET name = CASE WHEN name IS NULL OR name = '' THEN ? ELSE name END,
				        email = ? WHERE id = ?`,
				name, email, adoptable); err != nil {
				return "", false, err
			}
			linked = adoptable
		} else {
			// A brand new account, and a brand new sync account with it: a person
			// who registers has no tabverses yet, and the sync protocol needs
			// somewhere to put them.
			created = true
			if linked, err = s.createUserTx(ctx, tx, newAccountID(), name, email); err != nil {
				return "", false, err
			}
		}
	} else if name != "" {
		// A provider's display name is a fine *initial* name and a bad
		// replacement: the person may have named the account themselves, and
		// this runs on every login, not just the first.
		if _, err := tx.ExecContext(ctx,
			`UPDATE users SET name = CASE WHEN name IS NULL OR name = '' THEN ? ELSE name END WHERE id = ?`,
			name, linked); err != nil {
			return "", false, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO identities (user_id, provider, subject, email, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		linked, provider, subject, email, nowMS()); err != nil {
		return "", false, err
	}
	return linked, created, tx.Commit()
}

// IdentitiesFor lists a person's external logins, so the account page can show
// and unlink them.
func (s *Store) IdentitiesFor(ctx context.Context, userID string) ([]Identity, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT provider, subject, COALESCE(email, ''), user_id, created_at
		FROM identities WHERE user_id = ? ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Identity
	for rows.Next() {
		var i Identity
		var createdAt int64
		if err := rows.Scan(&i.Provider, &i.Subject, &i.Email, &i.UserID, &createdAt); err != nil {
			return nil, err
		}
		i.CreatedAt = unixMS(createdAt)
		out = append(out, i)
	}
	return out, rows.Err()
}

// ---- one time email tokens -----------------------------------------------

// CreateEmailToken stores the hash of a verification or reset token. The
// plaintext is emailed; only the hash is kept, so a database copy cannot be
// used to take an account over.
func (s *Store) CreateEmailToken(ctx context.Context, userID, purpose, tokenHash string, ttl time.Duration) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		userID, purpose, tokenHash, nowMS()+int64(ttl/time.Millisecond), nowMS())
	return err
}

// ConsumeEmailToken validates a token and marks it used in one transaction, so
// a link can only ever be followed once even if it is clicked twice.
func (s *Store) ConsumeEmailToken(ctx context.Context, purpose, tokenHash string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var userID string
	var expiresAt int64
	var usedAt sql.NullInt64
	err = tx.QueryRowContext(ctx, `
		SELECT user_id, expires_at, used_at FROM email_tokens
		WHERE purpose = ? AND token_hash = ?`, purpose, tokenHash).
		Scan(&userID, &expiresAt, &usedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if usedAt.Valid || expiresAt < nowMS() {
		return "", ErrNotFound
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE email_tokens SET used_at = ? WHERE purpose = ? AND token_hash = ?`,
		nowMS(), purpose, tokenHash); err != nil {
		return "", err
	}
	return userID, tx.Commit()
}

// ---- audit log ------------------------------------------------------------

// AuditEntry is one row of "who did what".
type AuditEntry struct {
	ID     int64
	Actor  string
	Action string
	Target string
	At     time.Time
	IP     string
	Detail string
}

// AppendAudit records an action. Failures here are logged and swallowed by
// callers: a full disk should not fail a login.
func (s *Store) AppendAudit(ctx context.Context, e AuditEntry) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audit_log (actor_user_id, action, target_user_id, at, ip, detail)
		VALUES (NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?)`,
		e.Actor, e.Action, e.Target, nowMS(), e.IP, e.Detail)
	return err
}

// ListAudit returns the newest entries, optionally filtered to one action or
// one subject, for the operator's user query interface.
func (s *Store) ListAudit(ctx context.Context, action, target string, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"1 = 1"}
	args := []any{}
	if action != "" {
		where = append(where, "action = ?")
		args = append(args, action)
	}
	if target != "" {
		where = append(where, "target_user_id = ?")
		args = append(args, target)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, COALESCE(actor_user_id, ''), action, COALESCE(target_user_id, ''), at, COALESCE(ip, ''), COALESCE(detail, '')
		FROM audit_log WHERE `+strings.Join(where, " AND ")+` ORDER BY at DESC, id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var at int64
		if err := rows.Scan(&e.ID, &e.Actor, &e.Action, &e.Target, &at, &e.IP, &e.Detail); err != nil {
			return nil, err
		}
		e.At = unixMS(at)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---- server secrets -------------------------------------------------------

// ServerSecret is a server-wide value generated once and kept in the database,
// so a self hosted deployment needs no configuration for it to work. Storing it
// beside the data it protects is acceptable in this threat model: anyone who can
// read the file can already read every payload (ADR 0002, plaintext at rest).
type ServerSecret struct {
	Name  string
	Value string
}

func (s *Store) ServerSecret(ctx context.Context, name string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM server_secrets WHERE name = ?`, name).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return v, err
}

// PutServerSecret stores a value if it is absent, and returns the stored one -
// so two processes racing to generate the first admin token agree on one value.
func (s *Store) PutServerSecret(ctx context.Context, name, value string) (string, error) {
	existing, err := s.ServerSecret(ctx, name)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return "", err
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO server_secrets (name, value, created_at) VALUES (?, ?, ?)`,
		name, value, nowMS()); err != nil {
		return "", err
	}
	return s.ServerSecret(ctx, name)
}

// newAccountID is the id of a brand new sync account, created because a person
// registered. Deliberately the same shape as the API's newID("usr_"), so an
// account created by a login is indistinguishable from one created by an
// operator in the console.
func newAccountID() string { return newID("usr_") }

// adoptableUserTx returns the id of the single pre-account user a registration
// may take over, or "" when there is nothing obvious to adopt.
//
// "Pre-account" means a user row with no email: nobody has ever signed in as
// them. Anything else (an existing account, several candidates, a deployment
// with no users at all) is left alone.
func adoptableUserTx(ctx context.Context, tx *sql.Tx) (string, error) {
	var id string
	var count int
	err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(MIN(id), '') FROM users
		WHERE email IS NULL OR email = ''`).Scan(&count, &id)
	if err != nil {
		return "", err
	}
	if count != 1 {
		return "", nil
	}
	return id, nil
}

// UnclaimedUserCount is how many sync users have no account. The console and
// the startup log use it to say "there is data here that no account owns",
// which is the failure mode adoption cannot fix on its own.
func (s *Store) UnclaimedUserCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM users WHERE email IS NULL OR email = ''`).Scan(&n)
	return n, err
}

// createUserTx inserts a user inside a caller's transaction. The caller has
// already linked any row it means to adopt, so a new row here is genuinely new.
func (s *Store) createUserTx(ctx context.Context, tx *sql.Tx, id, name, email string) (string, error) {
	if name == "" {
		name = email
	}
	if name == "" {
		name = "account"
	}
	var emailArg any
	if email != "" {
		emailArg = email
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO users (id, name, email, role, created_at, rev_seq) VALUES (?, ?, ?, ?, ?, 0)`,
		id, name, emailArg, RoleUser, nowMS()); err != nil {
		return "", err
	}
	return id, nil
}

// CountAccounts is how many people have registered. It is what closes the
// bootstrap window: once somebody has, accounts come from the console and
// nowhere else (adr/0013).
func (s *Store) CountAccounts(ctx context.Context) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM users WHERE email IS NOT NULL AND email <> ''`).Scan(&n)
	return n, err
}

// EnsureAccountForEmail returns the account for an address, creating it if this
// is the first time it is seen.
//
// It exists because of the order the sign-in flow happens in. The library's
// verify provider derives a stable subject from the address and puts it in the
// session claim, and the session is checked against our accounts *before* the
// claim is mapped to one - so an account that does not exist yet would have its
// very first request refused. Asking for the link therefore creates the account,
// and following the link is what proves the address.
//
// The row is inert until then: it holds an address nobody has confirmed and no
// session can reach, so a stranger who submits somebody else's address gains
// nothing but a row.
func (s *Store) EnsureAccountForEmail(ctx context.Context, email, name string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return "", fmt.Errorf("email is required")
	}
	if acc, err := s.AccountByEmail(ctx, email); err == nil {
		return acc.ID, nil
	} else if !errors.Is(err, ErrNotFound) {
		return "", err
	}
	id := newAccountID()
	if _, err := s.createUser(ctx, id, name, email); err != nil {
		// A concurrent request for the same address may have won the race; that
		// is the answer we wanted anyway.
		if acc, err2 := s.AccountByEmail(ctx, email); err2 == nil {
			return acc.ID, nil
		}
		return "", err
	}
	return id, nil
}

// createUser inserts a user outside a transaction, for the paths that are not
// part of an identity upsert.
func (s *Store) createUser(ctx context.Context, id, name, email string) (User, error) {
	if name == "" {
		name = email
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, name, email, role, created_at, rev_seq) VALUES (?, ?, ?, ?, ?, 0)`,
		id, name, email, RoleUser, nowMS()); err != nil {
		return User{}, err
	}
	return User{ID: id, Name: name, CreatedAt: time.Now().UTC()}, nil
}

// AccountIDForIdentity resolves the session id the library mints
// ("<provider>_<subject>") to the account that owns the data.
//
// This is a lookup rather than an arithmetic trick on purpose: the subject is
// the *provider's* identifier (a hash of the address for the passwordless
// login, a numeric id for GitHub), and only the identities table knows which
// account a given one belongs to. It is also what lets two providers share one
// account.
//
// A subject with no identity row is a *new registration* rather than an unknown
// one - it cannot have been forged, since forging it needs the signing secret -
// so the caller may create the account. A subject that has been retired (its
// account was deleted) is refused, which is what stops an old session from
// resurrecting a deleted account.
func (s *Store) AccountIDForIdentity(ctx context.Context, provider, subject string) (userID string, known bool, retired bool, err error) {
	var user sql.NullString
	err = s.db.QueryRowContext(ctx,
		`SELECT user_id FROM identities WHERE provider = ? AND subject = ?`,
		provider, subject).Scan(&user)
	switch {
	case err == nil && user.Valid && user.String != "":
		return user.String, true, false, nil
	case err == nil:
		// A row without an account: a registration that was never completed.
		return "", true, true, nil
	case !errors.Is(err, sql.ErrNoRows):
		return "", false, false, err
	}
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM retired_subjects WHERE provider = ? AND subject = ?`,
		provider, subject).Scan(&n); err != nil {
		return "", false, false, err
	}
	if n > 0 {
		return "", false, true, nil
	}
	return "", false, false, nil
}

// Retires every identity of an account, so a session that outlives the account
// it belonged to is refused instead of creating a new one.
func (s *Store) retireIdentitiesTx(ctx context.Context, tx *sql.Tx, userID string) error {
	rows, err := tx.QueryContext(ctx, `SELECT provider, subject FROM identities WHERE user_id = ?`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type key struct{ provider, subject string }
	var keys []key
	for rows.Next() {
		var k key
		if err := rows.Scan(&k.provider, &k.subject); err != nil {
			return err
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, k := range keys {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO retired_subjects (provider, subject, at) VALUES (?, ?, ?)`,
			k.provider, k.subject, nowMS()); err != nil {
			return err
		}
	}
	return nil
}

// SubjectForAccount is the identity subject a session carries for an account
// under a given provider - the other half of AccountIDForIdentity, and what an
// assumed identity has to be minted with: a session id that does not resolve
// back to the account is a session that does not work.
func (s *Store) SubjectForAccount(ctx context.Context, userID, provider string) (string, bool, error) {
	var subject string
	err := s.db.QueryRowContext(ctx,
		`SELECT subject FROM identities WHERE user_id = ? AND provider = ?`,
		userID, provider).Scan(&subject)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return subject, true, nil
}
