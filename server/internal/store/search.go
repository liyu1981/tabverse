package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
)

// Search runs an FTS5 query for one user.
//
// The user input is never passed through raw: every whitespace separated
// term is quoted (with embedded quotes doubled), and the final term gets a
// trailing '*' for incremental, as-you-type matching. bm25 relevance is
// negated so that a higher score means a better hit.
//
// Every hit carries the id of the tabverse it belongs to, not just the id of
// the record that matched: the extension shows tabverses, and it filters the
// result against the rows it has locally. Resolving it here (a join with
// records) is what keeps the client from having to fetch each matching tab,
// note or todo just to learn which tabverse it hangs off.
func (s *Store) Search(ctx context.Context, userID, query, entity string, limit int) ([]SearchHit, error) {
	match := buildMatchExpr(query)
	if match == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	// records_fts is referenced by its table name, not an alias: the FTS5
	// auxiliary functions (bm25/snippet) and MATCH do not accept an alias here
	sqlQuery := `
		SELECT records_fts.record_id, records_fts.entity, bm25(records_fts) AS rank,
		       snippet(records_fts, 3, '[', ']', '…', 16) AS snip, r.payload
		FROM records_fts
		JOIN records r
		  ON r.user_id = records_fts.user_id
		 AND r.entity = records_fts.entity
		 AND r.id = records_fts.record_id
		WHERE records_fts MATCH ? AND records_fts.user_id = ? AND r.deleted = 0`
	args := []any{match, userID}
	if entity != "" {
		if err := ValidateEntity(entity); err != nil {
			return nil, err
		}
		sqlQuery += ` AND records_fts.entity = ?`
		args = append(args, entity)
	}
	sqlQuery += ` ORDER BY rank ASC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}
	defer rows.Close()

	var hits []SearchHit
	for rows.Next() {
		var h SearchHit
		var rank float64
		var payload string
		if err := rows.Scan(&h.ID, &h.Entity, &rank, &h.Snippet, &payload); err != nil {
			return nil, err
		}
		h.Score = -rank // bm25 is negative-better
		h.TabspaceID = tabspaceIDOf(h.Entity, h.ID, payload)
		hits = append(hits, h)
	}
	return hits, rows.Err()
}

// tabspaceIDOf resolves the tabverse a record belongs to. A tabverse is its
// own owner; every other entity carries a tabSpaceId in its payload.
func tabspaceIDOf(entity, recordID, payload string) string {
	if entity == "tabspace" {
		return recordID
	}
	var v struct {
		TabSpaceID string `json:"tabSpaceId"`
	}
	if err := json.Unmarshal([]byte(payload), &v); err != nil {
		return ""
	}
	return v.TabSpaceID
}

// buildMatchExpr turns free text into a safe FTS5 MATCH expression such as:
//
//	"tab"* AND "manager"   ->  ("tab"*) AND ("manager")
//
// Each term becomes a quoted prefix phrase.
func buildMatchExpr(query string) string {
	terms := strings.FieldsFunc(query, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsPunct(r) && !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	if len(terms) == 0 {
		return ""
	}
	parts := make([]string, 0, len(terms))
	for i, t := range terms {
		quoted := `"` + strings.ReplaceAll(t, `"`, `""`) + `"`
		if i == len(terms)-1 {
			quoted += "*"
		}
		parts = append(parts, "("+quoted+")")
	}
	return strings.Join(parts, " AND ")
}
