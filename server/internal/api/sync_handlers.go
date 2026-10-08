package api

import (
	"net/http"
	"strconv"

	"github.com/liyu1981/tabverse/server/internal/hub"
	"github.com/liyu1981/tabverse/server/internal/store"
)

// ---- sync handlers --------------------------------------------------------

// handlePull is the delta download side of the sync protocol:
//
//	GET /console/api/v1/sync?since=<rev>&limit=<n>
//
// Returns every record with rev > since, oldest first.
func (s *Server) handlePull(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r.Context())
	since, err := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	if err != nil {
		since = 0
	}
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = s.cfg.SyncBatchLimit
	}
	if limit > s.cfg.SyncBatchLimit {
		limit = s.cfg.SyncBatchLimit
	}

	records, hasMore, err := s.store.PullRecords(r.Context(), userID, since, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	nextRev := since
	if len(records) > 0 {
		nextRev = records[len(records)-1].Rev
	}
	serverRev, err := s.store.ServerRev(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"records":    records,
		"next_rev":   nextRev,
		"has_more":   hasMore,
		"server_rev": serverRev,
	})
}

// handlePush is the delta upload side of the sync protocol:
//
//	POST /console/api/v1/sync  {"records":[{entity,id,updated_at,deleted,payload}]}
//
// Applies last-writer-wins per record, then notifies every other device of
// the account over the realtime hub.
func (s *Server) handlePush(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r.Context())
	deviceID := deviceIDFrom(r.Context())

	var req struct {
		Records []store.RecordInput `json:"records"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if len(req.Records) == 0 {
		writeErr(w, http.StatusBadRequest, "bad_request", "records must not be empty")
		return
	}
	if len(req.Records) > s.cfg.SyncBatchLimit {
		writeErr(w, http.StatusRequestEntityTooLarge, "too_many_records",
			"batch exceeds "+strconv.Itoa(s.cfg.SyncBatchLimit))
		return
	}
	for _, rec := range req.Records {
		if err := store.ValidateEntity(rec.Entity); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		if rec.ID == "" {
			writeErr(w, http.StatusBadRequest, "bad_request", "record id must not be empty")
			return
		}
		if int64(len(rec.Payload)) > s.cfg.MaxRecordBytes {
			writeErr(w, http.StatusRequestEntityTooLarge, "payload_too_large",
				"record "+rec.Entity+"/"+rec.ID+" exceeds the payload limit")
			return
		}
	}

	results, serverRev, err := s.store.ApplyRecords(r.Context(), userID, deviceID, req.Records, s.cfg.MaxRecordBytes)
	if err != nil {
		writeStoreErr(w, err)
		return
	}

	entities := make([]string, 0, len(req.Records))
	seen := map[string]bool{}
	accepted := false
	for _, in := range req.Records {
		if !seen[in.Entity] {
			seen[in.Entity] = true
			entities = append(entities, in.Entity)
		}
	}
	for _, res := range results {
		if res.Status == store.StatusOK {
			accepted = true
		}
	}
	if accepted {
		s.hub.Publish(userID, hub.Message{
			Type: "records_changed", Rev: serverRev, Entities: entities,
			ServerAt: nowMillis(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"results":    results,
		"server_rev": serverRev,
	})
}

// ---- entity handlers ------------------------------------------------------

// handleGetEntity fetches a single record by id (tombstones included).
func (s *Server) handleGetEntity(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	id := r.PathValue("id")
	if err := store.ValidateEntity(entity); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	rec, err := s.store.GetRecord(r.Context(), userIDFrom(r.Context()), entity, id)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// handleDeleteEntity soft deletes a record (creates a tombstone so every
// device learns about the removal through delta sync).
func (s *Server) handleDeleteEntity(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	id := r.PathValue("id")
	if err := store.ValidateEntity(entity); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	userID := userIDFrom(r.Context())
	results, serverRev, err := s.store.ApplyRecords(r.Context(), userID, deviceIDFrom(r.Context()),
		[]store.RecordInput{{Entity: entity, ID: id, UpdatedAt: nowMillis(), Deleted: true}},
		s.cfg.MaxRecordBytes)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	s.hub.Publish(userID, hub.Message{
		Type: "records_changed", Rev: serverRev, Entities: []string{entity},
		ServerAt: nowMillis(),
	})
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "server_rev": serverRev})
}

// ---- search ---------------------------------------------------------------

// handleSearch answers GET /console/api/v1/search?q=<free text>&entity=&limit=.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = s.cfg.SearchLimit
	}
	hits, err := s.store.Search(r.Context(), userIDFrom(r.Context()), q, r.URL.Query().Get("entity"), limit)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if hits == nil {
		hits = []store.SearchHit{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"query": q, "hits": hits})
}
