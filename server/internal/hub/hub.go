// Package hub manages the realtime WebSocket fan-out: every connected
// device of a user receives a "records_changed" event whenever any other
// device writes. This replaces the extension's client side leader election /
// broadcast-channel machinery: the server is the single coordination point.
package hub

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Message is the server -> client realtime envelope.
type Message struct {
	Type     string   `json:"type"` // "hello" | "records_changed"
	Rev      int64    `json:"rev,omitempty"`
	Entities []string `json:"entities,omitempty"`
	ServerAt int64    `json:"server_at"`
}

type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[*Conn]struct{}
}

func New() *Hub {
	return &Hub{subs: make(map[string]map[*Conn]struct{})}
}

// Conn is one attached client.
type Conn struct {
	hub    *Hub
	userID string
	ws     *websocket.Conn
	send   chan []byte
	done   chan struct{}
	once   sync.Once
}

// Attach registers ws for userID and starts its read/write pumps.
func (h *Hub) Attach(userID string, ws *websocket.Conn) *Conn {
	c := &Conn{
		hub: h, userID: userID, ws: ws,
		send: make(chan []byte, 64),
		done: make(chan struct{}),
	}
	h.mu.Lock()
	if h.subs[userID] == nil {
		h.subs[userID] = make(map[*Conn]struct{})
	}
	h.subs[userID][c] = struct{}{}
	h.mu.Unlock()

	go c.writePump()
	go c.readPump()
	return c
}

// Publish sends msg to every connection of userID (including the writer;
// clients dedupe by rev, which keeps the server logic trivial).
func (h *Hub) Publish(userID string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	conns := make([]*Conn, 0, len(h.subs[userID]))
	for c := range h.subs[userID] {
		conns = append(conns, c)
	}
	h.mu.RUnlock()
	for _, c := range conns {
		c.enqueue(data)
	}
}

// Count reports attached connections for a user (used by tests).
func (h *Hub) Count(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs[userID])
}

func (h *Hub) detach(userID string, c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subs[userID], c)
}

// Send pushes a message to this connection (best effort, drops on full
// buffer; the client reconciles through delta sync anyway).
func (c *Conn) Send(m Message) {
	data, err := json.Marshal(m)
	if err != nil {
		return
	}
	c.enqueue(data)
}

// Done is closed when the connection has been detached.
func (c *Conn) Done() <-chan struct{} { return c.done }

func (c *Conn) enqueue(data []byte) {
	select {
	case <-c.done:
		return
	default:
	}
	select {
	case c.send <- data:
	default:
		// Buffer full: drop the oldest event so the client catches up with
		// the newest state via sync rather than falling behind forever.
		select {
		case <-c.send:
		default:
		}
		select {
		case c.send <- data:
		default:
		}
	}
}

func (c *Conn) close() {
	c.once.Do(func() {
		close(c.done)
		c.hub.detach(c.userID, c)
		_ = c.ws.CloseNow()
	})
}

// readPump consumes (and discards) inbound frames; it exists purely to
// detect disconnects.
func (c *Conn) readPump() {
	defer c.close()
	for {
		ctx, cancel := context.WithCancel(context.Background())
		go func() {
			select {
			case <-c.done:
				cancel()
			case <-ctx.Done():
			}
		}()
		_, _, err := c.ws.Read(ctx)
		cancel()
		if err != nil {
			return
		}
	}
}

func (c *Conn) writePump() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case data := <-c.send:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := c.ws.Write(ctx, websocket.MessageText, data)
			cancel()
			if err != nil {
				c.close()
				return
			}
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := c.ws.Ping(ctx)
			cancel()
			if err != nil {
				c.close()
				return
			}
		}
	}
}
