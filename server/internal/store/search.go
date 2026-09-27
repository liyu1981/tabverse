package store

import (
	"context"
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
func (s *Store) Search(ctx context.Context, userID, query, entity string, limit int) ([]SearchHit, error) {
	match := buildMatchExpr(query)
	if match == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	sqlQuery := `
		SELECT record_id, entity, bm25(records_fts) AS rank, snippet(records_fts, 3, '[', ']', '…', 16) AS snip
		FROM records_fts
		WHERE records_fts MATCH ? AND user_id = ?`
	args := []any{match, userID}
	if entity != "" {
		if err := ValidateEntity(entity); err != nil {
			return nil, err
		}
		sqlQuery += ` AND entity = ?`
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
		if err := rows.Scan(&h.ID, &h.Entity, &rank, &h.Snippet); err != nil {
			return nil, err
		}
		h.Score = -rank // bm25 is negative-better
		hits = append(hits, h)
	}
	return hits, rows.Err()
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
