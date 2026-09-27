import {
  calendarLabel,
  dayGroupLabel,
  formatDateTime,
  fromNow,
  startOfDayMs,
} from './time';

const NOW = new Date('2026-09-28T14:30:00').getTime();
const day = (offset: number) => NOW + offset * 86_400_000;

test('dayGroupLabel buckets days like moment calendar did', () => {
  expect(dayGroupLabel(NOW, NOW)).toBe('Today');
  expect(dayGroupLabel(day(1), NOW)).toBe('Tomorrow');
  expect(dayGroupLabel(day(-1), NOW)).toBe('Yesterday');
  expect(dayGroupLabel(day(2), NOW)).toMatch(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/,
  );
  expect(dayGroupLabel(day(-2), NOW)).toMatch(
    /^Last (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/,
  );
  expect(dayGroupLabel(day(-30), NOW)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
});

test('calendarLabel adds the time to near days only', () => {
  expect(calendarLabel(NOW, NOW)).toMatch(/^Today at /);
  expect(calendarLabel(day(-1), NOW)).toMatch(/^Yesterday at /);
  expect(calendarLabel(day(-30), NOW)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
});

test('startOfDayMs normalises to local midnight', () => {
  const start = startOfDayMs(NOW);
  const d = new Date(start);
  expect(d.getHours()).toBe(0);
  expect(d.getMinutes()).toBe(0);
  expect(d.getDate()).toBe(28);
});

test('formatDateTime and fromNow are stable strings', () => {
  expect(formatDateTime(NOW)).toMatch(/September 28th 2026, 2:30:00 pm/i);
  // fromNow() is relative to the real clock, so derive from Date.now()
  expect(fromNow(Date.now())).toBeTruthy();
  expect(fromNow(Date.now() - 5 * 60_000)).toBe('5 minutes ago');
  expect(fromNow(Date.now() - 2 * 86_400_000)).toBe('2 days ago');
});
