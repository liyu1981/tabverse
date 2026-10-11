package rlimit

import "testing"

func TestFit(t *testing.T) {
	cases := []struct {
		maxOpen int
		soft    uint64
		reserve int
		want    int
	}{
		{64, 0, 256, 64},       // unknown limit: unchanged
		{64, 1 << 20, 256, 64}, // plenty of room
		{1000, 1024, 256, 256}, // (1024-256)/3
		{1000, 300, 256, 14},   // (300-256)/3
		{1000, 256, 256, 1},    // no budget at all
		{1000, 200, 256, 1},    // below the reserve
	}
	for _, c := range cases {
		if got := Fit(c.maxOpen, c.soft, c.reserve); got != c.want {
			t.Errorf("Fit(%d, %d, %d) = %d, want %d", c.maxOpen, c.soft, c.reserve, got, c.want)
		}
	}
}
