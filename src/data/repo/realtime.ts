/**
 * RealtimeClient: maintains the WebSocket to the sync server and reports
 * `records_changed` events, which the app turns into a delta pull.
 *
 * Reconnects with an exponential schedule. The WebSocket constructor is
 * injected so tests run without a network stack.
 */

export interface RealtimeMessage {
  type: 'hello' | 'records_changed' | string;
  rev?: number;
  entities?: string[];
  server_at?: number;
}

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: ((ev?: any) => void) | null;
  onerror: ((ev?: any) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Reconnect scheduling is injectable: tests drive it explicitly instead of
 * relying on jest fake timers (which cannot hijack `performance` on modern
 * node versions).
 */
export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as any),
};

export interface RealtimeOptions {
  url: string;
  onMessage: (message: RealtimeMessage) => void;
  onStatus?: (status: RealtimeStatus) => void;
  factory?: WebSocketFactory;
  /** Exponential schedule; the last value is reused. */
  reconnectDelaysMs?: number[];
  scheduler?: Scheduler;
}

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

function defaultFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

export class RealtimeClient {
  private readonly url: string;
  private readonly onMessage: (m: RealtimeMessage) => void;
  private readonly onStatus?: (s: RealtimeStatus) => void;
  private readonly factory: WebSocketFactory;
  private readonly delays: number[];
  private readonly scheduler: Scheduler;

  private socket: WebSocketLike | null = null;
  private connected = false;
  private attempts = 0;
  private timer: unknown = null;
  private stopped = false;

  constructor(options: RealtimeOptions) {
    this.url = options.url;
    this.onMessage = options.onMessage;
    this.onStatus = options.onStatus;
    this.factory = options.factory || defaultFactory;
    this.delays =
      options.reconnectDelaysMs && options.reconnectDelaysMs.length > 0
        ? options.reconnectDelaysMs
        : DEFAULT_RECONNECT_DELAYS;
    this.scheduler = options.scheduler || realScheduler;
  }

  connect(): void {
    if (this.stopped) {
      return;
    }
    this.setStatus('connecting');
    let socket: WebSocketLike;
    try {
      socket = this.factory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.connected = true;
      this.setStatus('connected');
    };
    socket.onmessage = (ev) => {
      const message = parseMessage(ev && ev.data);
      if (message) {
        this.onMessage(message);
      }
    };
    socket.onerror = () => {
      // onclose always follows; nothing to do here.
    };
    socket.onclose = () => {
      this.socket = null;
      this.connected = false;
      if (this.stopped) {
        this.setStatus('disconnected');
        return;
      }
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, 'client shutdown');
      } catch {
        // already gone
      }
    }
    this.setStatus('disconnected');
  }

  get status(): RealtimeStatus {
    if (this.connected) {
      return 'connected';
    }
    return this.stopped ? 'disconnected' : 'connecting';
  }

  private scheduleReconnect(): void {
    this.setStatus('disconnected');
    const idx = Math.min(this.attempts, this.delays.length - 1);
    const delay = this.delays[idx];
    this.attempts += 1;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.onStatus) {
      this.onStatus(status);
    }
  }
}

function parseMessage(data: any): RealtimeMessage | null {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.type === 'string') {
      return parsed as RealtimeMessage;
    }
  } catch {
    // ignore malformed frames
  }
  return null;
}
