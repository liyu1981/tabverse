import { expect, test } from 'vitest';

import {
  ago,
  agoIso,
  bytes,
  dateOf,
  jsonSize,
  plural,
  prettyPayload,
} from './format';

const NOW = Date.parse('2026-10-02T12:00:00Z');

test('a timestamp reads as how long ago, at the scale that fits', () => {
  expect(ago(NOW - 4_000, NOW)).toBe('4s ago');
  expect(ago(NOW - 12 * 60_000, NOW)).toBe('12m ago');
  expect(ago(NOW - 5 * 3_600_000, NOW)).toBe('5h ago');
  expect(ago(NOW - 9 * 86_400_000, NOW)).toBe('9d ago');
});

test('a time that was never set says never, not an epoch', () => {
  // `0` and `undefined` are both "never" in the payloads; a date in 1970 is a
  // bug, and showing "17500d ago" would hide it.
  expect(ago(0, NOW)).toBe('never');
  expect(ago(undefined, NOW)).toBe('never');
});

test('a clock that went backwards does not print a negative age', () => {
  expect(ago(NOW + 60_000, NOW)).toBe('0s ago');
});

test('the exact timestamp is shown next to the relative one', () => {
  // toLocaleString is locale dependent, so the assertion is on the shape: the
  // exact local time, then the relative reading in brackets.
  const ms = Date.parse('2026-10-01T09:30:00Z');
  expect(dateOf(ms, NOW)).toBe(
    new Date(ms).toLocaleString() + ' (' + ago(ms, NOW) + ')',
  );
  expect(dateOf(0, NOW)).toBe('—');
});

test('an RFC3339 time is read the same way', () => {
  expect(agoIso('2026-10-02T11:00:00Z', NOW)).toBe('1h ago');
  expect(agoIso('not a date', NOW)).toBe('never');
  expect(agoIso(undefined, NOW)).toBe('never');
});

test('sizes are read in the unit they fit', () => {
  expect(bytes(900)).toBe('900 B');
  expect(bytes(2048)).toBe('2.0 KiB');
  expect(bytes(5 * 1024 * 1024)).toBe('5.0 MiB');
});

test('a payload is pretty printed when it is json and shown as stored when not', () => {
  expect(prettyPayload('{"a":1}')).toBe('{\n  "a": 1\n}');
  expect(prettyPayload('not json at all')).toBe('not json at all');
});

test('the size of a bundle is the size of its json', () => {
  expect(jsonSize({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
});

test('a count knows its own singular', () => {
  expect(plural(1, 'tabverse')).toBe('tabverse');
  expect(plural(0, 'tabverse')).toBe('tabverses');
  expect(plural(2, 'record')).toBe('records');
});
