package api

import (
	"testing"
	"time"
)

// The throttle is the answer to "a stranger can ask this server to send mail",
// and the property worth pinning down is that the window *closes*: a fixed
// counter with no reset is a denial of service, not a limit.
func TestThrottleLimitsWithinAWindowAndResetsAfter(t *testing.T) {
	clock := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	th := newThrottle(3, time.Hour)
	th.now = func() time.Time { return clock }

	for i := 1; i <= 3; i++ {
		if !th.allow("alice@example.com") {
			t.Fatalf("request %d was refused inside the limit", i)
		}
	}
	if th.allow("alice@example.com") {
		t.Fatal("the fourth request was allowed")
	}

	// A different key has its own budget: this is a per-address limit, and one
	// person's exhaustion must not lock everyone else out.
	if !th.allow("bob@example.com") {
		t.Fatal("a second address was refused by the first one's usage")
	}

	// And the window closes.
	clock = clock.Add(time.Hour + time.Second)
	if !th.allow("alice@example.com") {
		t.Fatal("the limit did not reset once the window passed")
	}
}

func TestThrottleSweepsKeysItWillNotSeeAgain(t *testing.T) {
	clock := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	th := newThrottle(1, time.Minute)
	th.now = func() time.Time { return clock }

	// Well past the sweep threshold, so the map has to be walked.
	for i := 0; i < 2000; i++ {
		th.allow(string(rune('a'+i%26)) + string(rune('a'+i/26)))
	}
	clock = clock.Add(2 * time.Minute)
	th.allow("one-more")
	if len(th.windows) > 1024 {
		t.Fatalf("the map grew to %d keys; it is meant to be swept", len(th.windows))
	}
}
