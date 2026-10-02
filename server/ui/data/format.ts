/**
 * The words the console says about a record's age, size and counts.
 *
 * These are pure functions on purpose: they are the ones the tests can reach
 * without a DOM, and they are where the console's tone lives ("3d ago" next to
 * the exact timestamp, so neither reading is a guess).
 */

/** "4s ago", "12m ago", "5h ago", "9d ago" - never "never" for a real time. */
export function ago(ms: number | undefined | null, now = Date.now()): string {
  if (!ms) return 'never';
  const secs = Math.max(0, (now - ms) / 1000);
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** The exact timestamp, with the relative one in brackets. */
export function dateOf(
  ms: number | undefined | null,
  now = Date.now(),
): string {
  if (!ms) return '—';
  return `${new Date(ms).toLocaleString()} (${ago(ms, now)})`;
}

/** An RFC3339 string as the accounts handlers marshal it, read as a date. */
export function agoIso(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 'never' : ago(ms, now);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1048576).toFixed(1)} MiB`;
}

/** How big a payload is on the wire, the way the server received it. */
export function jsonSize(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** A record's payload, pretty printed when it is json and as stored when not. */
export function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
