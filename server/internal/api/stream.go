package api

import (
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/liyu1981/tabverse/server/internal/auth"
	"github.com/liyu1981/tabverse/server/internal/hub"
)

func nowMillis() int64 { return time.Now().UnixMilli() }

// handleStream upgrades the request to a WebSocket and attaches it to the
// realtime hub for this device's user.
//
// Auth: the browser WebSocket API cannot set headers, so a token may be
// passed as ?access_token=<token>; the Authorization header is also honored
// for non browser clients. The upgrade is refused without a valid token.
//
// Frame format (server -> client):
//
//	{"type":"hello","rev":<server_rev>,"server_at":<ms>}
//	{"type":"records_changed","rev":<server_rev>,"entities":[...],"server_at":<ms>}
func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	token, ok := s.extractToken(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "missing_token", "provide access_token query parameter")
		return
	}
	userID, _, err := s.store.LookupToken(r.Context(), auth.HashToken(token))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_token", "token unknown or revoked")
		return
	}

	opts := &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled}
	if len(s.cfg.WSOrigins) > 0 {
		opts.OriginPatterns = s.cfg.WSOrigins
	} else {
		// Token auth happens before the upgrade, so origin checking is only
		// defense in depth; default to permissive to allow chrome-extension
		// origins out of the box. Set TABVERSED_WS_ORIGINS to restrict.
		opts.InsecureSkipVerify = true
	}
	ws, err := websocket.Accept(w, r, opts)
	if err != nil {
		s.logger.Warn("websocket accept failed", "err", err)
		return
	}
	ws.SetReadLimit(4096)

	conn := s.hub.Attach(userID, ws)
	if rev, err := s.store.ServerRev(r.Context(), userID); err == nil {
		conn.Send(hub.Message{Type: "hello", Rev: rev, ServerAt: nowMillis()})
	}

	// Block until the connection dies: the hub's read pump detects the
	// disconnect and closes Done. The request context of a hijacked
	// connection is not reliable for this.
	<-conn.Done()
}
