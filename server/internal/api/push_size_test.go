package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// A push may legitimately carry up to SyncBatchLimit records, each up to
// MaxRecordBytes. The generic JSON body cap (1 MiB) is far below that, so a
// batch the server itself advertises as valid must still be accepted.
func TestPushAcceptsBodyLargerThanGenericJSONCap(t *testing.T) {
	ts, _ := newTestServer(t)
	b := bootstrap(t, ts)

	filler := strings.Repeat("x", 30_000)
	recs := make([]pushedRecord, 0, 40)
	for i := 0; i < 40; i++ {
		recs = append(recs, pushedRecord{
			Entity:    "note",
			ID:        fmt.Sprintf("n%d", i),
			UpdatedAt: int64(i + 1),
			Payload:   `{"name":"` + filler + `"}`,
		})
	}
	if _, r := push(t, ts, b.Token, recs); r.status != http.StatusOK {
		t.Fatalf("push of a large (but valid) batch failed: %d %s", r.status, r.raw)
	}
}
