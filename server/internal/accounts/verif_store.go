package accounts

import (
	"context"
	"time"
)

// The sign-in link's one-shot guarantee, in the database.
//
// The auth library enforces "a confirmation token cannot be redeemed twice"
// through a VerifConfirmationStore, and its default is an in-memory map - which
// means the guarantee lasts exactly as long as the process. Restarting the
// server inside a link's 30 minute window makes a used link work again, and two
// replicas behind a load balancer each have their own map and so neither knows
// what the other has seen.
//
// The store is the same SQLite database everything else is in, so the check
// costs one indexed read and one write per sign-in - which is not a hot path -
// and it is shared by every replica of the deployment (ADR 0021).

type verifStore struct {
	svc *Service
}

// MarkUsed records a redeemed link and reports whether it was already redeemed
// while still valid. The library refuses the second one; that fail-closed
// behaviour is the point, so a database error here must NOT come back as "not
// used" - the library treats a non-nil error as a refusal, which is the right
// failure direction here and the wrong one for a payment.
func (v verifStore) MarkUsed(key string, ttl time.Duration) (bool, error) {
	if v.svc == nil || v.svc.store == nil {
		// Nothing to record against: the library's contract says nil store
		// means "no replay protection", and pretending otherwise would claim a
		// guarantee nobody is keeping.
		return false, nil
	}
	if ttl <= 0 {
		ttl = time.Minute
	}
	return v.svc.store.MarkVerifTokenUsed(context.Background(), key, ttl)
}
