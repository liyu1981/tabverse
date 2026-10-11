package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"syscall"
	"testing"

	"github.com/liyu1981/tabverse/server/internal/store"
)

func TestWriteStoreErrMapsBusyTo503(t *testing.T) {
	for _, err := range []error{store.ErrBusy, syscall.EMFILE, syscall.ENFILE} {
		rec := httptest.NewRecorder()
		writeStoreErr(rec, err)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%v mapped to %d, want 503", err, rec.Code)
		}
		if rec.Header().Get("Retry-After") == "" {
			t.Fatalf("%v: no Retry-After header", err)
		}
	}
	if !store.IsBusy(store.ErrBusy) || store.IsBusy(errors.New("nope")) {
		t.Fatal("IsBusy misclassifies")
	}
}
