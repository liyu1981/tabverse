import { RealtimeClient, Scheduler, WebSocketLike } from '../realtime';

class FakeSocket implements WebSocketLike {
  onopen: ((ev?: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onclose: ((ev?: any) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;
  sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    if (this.onclose) {
      this.onclose({});
    }
  }

  // test drivers
  open(): void {
    if (this.onopen) {
      this.onopen({});
    }
  }

  message(data: any): void {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }

  remoteClose(): void {
    if (this.onclose) {
      this.onclose({});
    }
  }
}

interface Task {
  at: number;
  callback: () => void;
}

/** Deterministic replacement for jest fake timers. */
class ManualScheduler implements Scheduler {
  now = 0;
  private tasks: Task[] = [];

  setTimeout(callback: () => void, delayMs: number): unknown {
    const task: Task = { at: this.now + delayMs, callback };
    this.tasks.push(task);
    return task;
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t !== handle);
  }

  pending(): number {
    return this.tasks.length;
  }

  /** Runs every task due within the next `ms`, in scheduled order. */
  advance(ms: number): void {
    const limit = this.now + ms;
    const due = this.tasks
      .filter((t) => t.at <= limit)
      .sort((a, b) => a.at - b.at);
    this.tasks = this.tasks.filter((t) => t.at > limit);
    this.now = limit;
    for (const task of due) {
      task.callback();
    }
  }
}

function setup(delays = [10, 10, 10]) {
  const sockets: FakeSocket[] = [];
  const messages: any[] = [];
  const statuses: string[] = [];
  const scheduler = new ManualScheduler();

  const client = new RealtimeClient({
    url: 'wss://sync.example.com/console/api/v1/sync/stream?access_token=t',
    factory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    reconnectDelaysMs: delays,
    scheduler,
  });
  return { client, sockets, messages, statuses, scheduler };
}

test('connects, reports status and dispatches frames', () => {
  const { client, sockets, messages, statuses } = setup();
  client.connect();
  expect(sockets).toHaveLength(1);
  expect(client.status).toBe('connecting');

  sockets[0].open();
  expect(statuses).toContain('connected');
  expect(client.status).toBe('connected');

  sockets[0].message(JSON.stringify({ type: 'hello', rev: 3, server_at: 1 }));
  sockets[0].message(
    JSON.stringify({ type: 'records_changed', rev: 4, entities: ['note'] }),
  );

  expect(messages).toEqual([
    { type: 'hello', rev: 3, server_at: 1 },
    { type: 'records_changed', rev: 4, entities: ['note'] },
  ]);
});

test('malformed frames are ignored', () => {
  const { client, sockets, messages } = setup();
  client.connect();
  sockets[0].open();

  sockets[0].message('not json');
  sockets[0].message(JSON.stringify({ nope: true }));
  sockets[0].message(12345);

  expect(messages).toEqual([]);
});

test('reconnects with backoff after an unexpected close', () => {
  const { client, sockets, scheduler } = setup([50, 200]);
  client.connect();
  sockets[0].open();

  sockets[0].remoteClose();
  expect(sockets).toHaveLength(1);
  expect(scheduler.pending()).toBe(1);

  scheduler.advance(49);
  expect(sockets).toHaveLength(1);
  scheduler.advance(2);
  expect(sockets).toHaveLength(2);

  // a successful open resets the backoff
  sockets[1].open();
  sockets[1].remoteClose();
  scheduler.advance(50);
  expect(sockets).toHaveLength(3);
});

test('backoff grows up to the last configured delay', () => {
  const { client, sockets, scheduler } = setup([10, 30]);
  client.connect();

  sockets[0].remoteClose();
  scheduler.advance(11);
  expect(sockets).toHaveLength(2);

  sockets[1].remoteClose();
  scheduler.advance(31); // second attempt uses the last delay
  expect(sockets).toHaveLength(3);

  sockets[2].remoteClose();
  scheduler.advance(31); // still the last delay
  expect(sockets).toHaveLength(4);
});

test('disconnect closes the socket and stops reconnecting', () => {
  const { client, sockets, statuses, scheduler } = setup([10]);
  client.connect();
  sockets[0].open();

  client.disconnect();
  expect(sockets[0].closed).toBe(true);
  expect(client.status).toBe('disconnected');
  expect(scheduler.pending()).toBe(0);

  scheduler.advance(1000);
  expect(sockets).toHaveLength(1);
  expect(statuses[statuses.length - 1]).toBe('disconnected');
});

test('a close after disconnect does not schedule anything', () => {
  const { client, sockets, scheduler } = setup([10]);
  client.connect();
  sockets[0].open();
  client.disconnect();

  // the socket fires its close event after we already tore down
  sockets[0].remoteClose();
  scheduler.advance(1000);
  expect(sockets).toHaveLength(1);
  expect(scheduler.pending()).toBe(0);
});
