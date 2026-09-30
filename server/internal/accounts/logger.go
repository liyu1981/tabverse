package accounts

import (
	"fmt"
	"log/slog"
)

// loggerAdapter bridges the library's single-method logger onto slog, so its
// messages end up in the same stream as ours instead of the standard log.
type loggerAdapter struct{ log *slog.Logger }

func (l loggerAdapter) Logf(format string, args ...any) {
	if l.log == nil {
		return
	}
	l.log.Debug(fmt.Sprintf(format, args...))
}
