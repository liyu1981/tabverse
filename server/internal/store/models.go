package store

import (
	"fmt"
	"time"
)

// Entities are the record kinds mirrored between the extension and the
// server. The set is intentionally closed so the API can validate input and
// search can apply per entity policy.
var Entities = map[string]bool{
	"tabspace": true, // a saved session of tabs (title, tags, ...)
	"tab":      true, // a single tab belonging to a tabspace
	"session":  true, // periodic chrome window/tab snapshot (retention applies)
	"note":     true,
	"todo":     true,
	"bookmark": true,
	// Closed tabs of a tabverse (the History tool in the right side panel).
	// One record per url, ordered by the row's own closedAt, so no aggregate
	// entity is needed. Not indexed: these rows are dropped by the client once
	// they fall off the history cap, and a stale search hit would be a link to
	// something the user no longer has.
	"closedtab": true,
	// The extension keeps per tabspace aggregates (id lists, ordered). They
	// are synced as their own records so ordering survives without the
	// server knowing anything about the client's data model.
	"allnote":     true,
	"alltodo":     true,
	"allbookmark": true,
}

// IndexedEntities are the entities worth putting into the full text index;
// aggregates are id lists, pure noise for search.
var IndexedEntities = map[string]bool{
	"tabspace": true, "tab": true, "session": true,
	"note": true, "todo": true, "bookmark": true,
}

// PrunableEntities are subject to server side retention.
var PrunableEntities = map[string]bool{"session": true}

func ValidateEntity(entity string) error {
	if !Entities[entity] {
		return fmt.Errorf("unknown entity %q", entity)
	}
	return nil
}

type User struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

type Device struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// Record is one versioned row of client data.
type Record struct {
	Entity   string `json:"entity"`
	ID       string `json:"id"`
	DeviceID string `json:"device_id,omitempty"`
	Rev      int64  `json:"rev"`
	Deleted  bool   `json:"deleted"`
	// UpdatedAt is the client assigned modification time in unix milliseconds.
	// Conflict resolution is last-writer-wins on this field.
	UpdatedAt int64  `json:"updated_at"`
	Payload   string `json:"payload"`
	// ServerAt is when the server accepted the record, unix milliseconds.
	ServerAt int64 `json:"server_at"`
}

// RecordInput is a client proposed write during a sync push.
type RecordInput struct {
	Entity    string `json:"entity"`
	ID        string `json:"id"`
	UpdatedAt int64  `json:"updated_at"`
	Deleted   bool   `json:"deleted"`
	Payload   string `json:"payload"`
}

// RecordStatus values returned by a sync push.
const (
	StatusOK    = "ok"    // accepted, server state now reflects the input
	StatusStale = "stale" // rejected, server copy is newer (LWW lost)
)

// RecordResult is the per record outcome of a sync push.
type RecordResult struct {
	Entity    string `json:"entity"`
	ID        string `json:"id"`
	Status    string `json:"status"`
	Rev       int64  `json:"rev"`
	UpdatedAt int64  `json:"updated_at"`
	// Current is present when Status == StatusStale so the client can resolve
	// the conflict without another round trip.
	Current *Record `json:"current,omitempty"`
}

type SearchHit struct {
	Entity  string  `json:"entity"`
	ID      string  `json:"id"`
	Score   float64 `json:"score"` // higher is better
	Snippet string  `json:"snippet,omitempty"`
}
