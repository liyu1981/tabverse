// Package rlimit derives the user-DB pool size from the process file-descriptor
// limit and raises that limit where it can, so the descriptor budget is
// computed rather than left for the operator to pair with
// TABVERSED_MAX_OPEN_USER_DBS by hand (ADR 0027).
//
// The server targets linux/amd64 and linux/arm64, so this uses the Linux
// rlimit syscalls directly rather than carrying a per-platform fallback.
package rlimit

import "syscall"

// Fit returns the effective user-DB pool cap for a process whose soft
// descriptor limit is soft. reserve is the number of descriptors kept for
// everything that is not an open user DB - sockets, the central file, logs. A
// soft of 0 means the limit is unknown, and the cap is returned unchanged. Each
// open user DB costs three descriptors (the file, its -wal and its -shm), so the
// result is never below 1.
func Fit(maxOpen int, soft uint64, reserve int) int {
	if soft == 0 {
		return maxOpen
	}
	budget := int64(soft) - int64(reserve)
	if budget < 3 {
		return 1
	}
	if fit := int(budget / 3); fit < maxOpen {
		return fit
	}
	return maxOpen
}

// Limit returns the current soft and hard RLIMIT_NOFILE values. ok is false
// when the limit cannot be read.
func Limit() (soft, hard uint64, ok bool) {
	var l syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &l); err != nil {
		return 0, 0, false
	}
	return l.Cur, l.Max, true
}

// RaiseSoft raises the soft limit toward to, never above the hard limit, and
// returns the resulting soft limit and whether the call succeeded. Raising the
// soft limit up to the hard limit needs no privilege; raising the hard limit
// does, which is why this never touches Max.
func RaiseSoft(to uint64) (uint64, bool) {
	var l syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &l); err != nil {
		return 0, false
	}
	if to > l.Max {
		to = l.Max
	}
	if to <= l.Cur {
		return l.Cur, true
	}
	if err := syscall.Setrlimit(syscall.RLIMIT_NOFILE, &syscall.Rlimit{Cur: to, Max: l.Max}); err != nil {
		return l.Cur, false
	}
	return to, true
}
