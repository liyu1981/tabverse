import { format } from 'date-fns';
import { enGB, enUS } from 'date-fns/locale';

import {
  calendarLabel,
  dayGroupLabel,
  formatDateTime,
  fromNow,
  resolveDateLocale,
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

test('resolveDateLocale maps the browser language onto a shipped language', () => {
  // 2026-09-28 is a Monday; the weekday name is where a locale shows
  expect(resolveDateLocale('en')).toBe(enUS);
  expect(resolveDateLocale('en-GB')).toBe(enGB);
  expect(resolveDateLocale('de')).not.toBe(enUS);
  expect(format(day(0), 'EEEE', { locale: resolveDateLocale('de') })).toBe(
    'Montag',
  );
  expect(format(day(0), 'EEEE', { locale: resolveDateLocale('fr') })).toBe(
    'lundi',
  );
  expect(format(day(0), 'EEEE', { locale: resolveDateLocale('es') })).toBe(
    'lunes',
  );
  expect(format(day(0), 'EEEE', { locale: resolveDateLocale('ja') })).toBe(
    '月曜日',
  );
});

test('resolveDateLocale keeps the two Chineses apart and falls back sanely', () => {
  // Chrome writes these with a dash, a locale tag may arrive underscored
  expect(resolveDateLocale('pt-BR')).toBe(resolveDateLocale('pt_BR'));
  // simplified and traditional are different locales, not one with two names
  expect(resolveDateLocale('zh-CN')).not.toBe(resolveDateLocale('zh-TW'));
  // Chinese with no region is simplified, which is what Chrome defaults to
  expect(resolveDateLocale('zh')).toBe(resolveDateLocale('zh-CN'));
  // a language we do not ship still has to render a date
  expect(resolveDateLocale('xx')).toBe(enUS);
  expect(resolveDateLocale(undefined)).toBe(enUS);
  expect(resolveDateLocale('')).toBe(enUS);
});
