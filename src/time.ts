/**
 * Date/time formatting helpers.
 *
 * Replaces the moment dependency: everything the UI needs is relative
 * labels ("3 days ago", "Today at 14:30"), one long timestamp format and a
 * day grouping key. date-fns is tree-shakeable, so only the pieces we use
 * end up in the bundle.
 *
 * Everything here is locale-aware: the words ("Today", "Last Monday") come
 * from `_locales/`, and the calendar rules (weekday names, the ordinal in
 * "September 28th", am/pm, the shape of a bare date) come from the matching
 * date-fns locale. Without the second half the first half would read oddly -
 * a German "Heute" beside an English "2:05 pm".
 *
 * Blueprint needs no locale of its own: the extension uses none of its date
 * or pagination components (which are the only ones carrying English text),
 * and its buttons and dialogs take their labels from us.
 */

import { format, formatDistanceToNow, startOfDay } from 'date-fns';
import type { Locale } from 'date-fns';
import {
  de,
  enAU,
  enGB,
  enUS,
  es,
  fr,
  frCA,
  it,
  ja,
  ko,
  nl,
  pl,
  pt,
  ptBR,
  ru,
  zhCN,
  zhTW,
} from 'date-fns/locale';

import { t } from './i18n';

/**
 * The languages the extension ships, keyed the way Chrome writes a locale.
 *
 * This is deliberately kept in step with `public/_locales/`: a language the
 * extension can show words in should also have its calendar right.
 */
const DATE_LOCALES: Record<string, Locale> = {
  en: enUS,
  en_GB: enGB,
  en_AU: enAU,
  zh_CN: zhCN,
  zh_TW: zhTW,
  fr: fr,
  fr_CA: frCA,
  de: de,
  es: es,
  es_419: es,
  pt: pt,
  pt_BR: ptBR,
  pt_PT: pt,
  ja: ja,
  ko: ko,
  it: it,
  ru: ru,
  nl: nl,
  pl: pl,
};

/**
 * The date-fns locale for the browser's UI language.
 *
 * `chrome.i18n.getUILanguage()` returns what the browser is set to, which is
 * not necessarily a language we ship - and the extension still has to render
 * dates when it is not. So this picks the closest of ours and falls back to
 * English rather than throwing or falling through to date-fns' own default.
 *
 * Exported for its test; nothing else should need the mapping.
 */
export function resolveDateLocale(uiLanguage: string | undefined): Locale {
  if (!uiLanguage) {
    return enUS;
  }
  // Chrome writes "pt-BR"; a locale tag may also arrive underscored
  const [language = '', region = ''] = uiLanguage
    .replace(/_/g, '-')
    .split('-')
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.toUpperCase(),
    );
  const exact = region ? `${language}_${region}` : language;
  if (exact in DATE_LOCALES) {
    return DATE_LOCALES[exact];
  }
  // Chinese with no region is simplified, which is also what Chrome defaults
  // to; any other unregioned language matches on the language alone
  if (language === 'zh') {
    return DATE_LOCALES.zh_CN;
  }
  if (language in DATE_LOCALES) {
    return DATE_LOCALES[language];
  }
  return enUS;
}

function currentLocale(): Locale {
  return resolveDateLocale(globalThis.chrome?.i18n?.getUILanguage?.());
}

/** "3 days ago" / "in 2 hours" (moment's fromNow()). */
export function fromNow(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), {
    addSuffix: true,
    locale: currentLocale(),
  });
}

/** 'March 3rd 2024, 2:05:07 pm' (moment's 'MMMM Do YYYY, h:mm:ss a'). */
export function formatDateTime(timestamp: number): string {
  return format(new Date(timestamp), 'MMMM do yyyy, h:mm:ss aaa', {
    locale: currentLocale(),
  });
}

/** Start of the local day, in ms (moment's startOf('day').valueOf()). */
export function startOfDayMs(timestamp: number): number {
  return startOfDay(new Date(timestamp)).getTime();
}

/**
 * How a day relates to today.
 *
 * Split out from the label because `calendarLabel` used to tell them apart by
 * comparing the *English* words it had just built - which stopped being true
 * the moment the words could be read in another language.
 */
export type DayKind =
  | 'today'
  | 'tomorrow'
  | 'yesterday'
  | 'weekday'
  | 'lastWeekday'
  | 'date';

export function dayKind(timestamp: number, now: number = Date.now()): DayKind {
  const day = startOfDayMs(timestamp);
  const today = startOfDayMs(now);
  const diffDays = Math.round((day - today) / 86_400_000);

  if (diffDays === 0) {
    return 'today';
  }
  if (diffDays === 1) {
    return 'tomorrow';
  }
  if (diffDays === -1) {
    return 'yesterday';
  }
  if (diffDays > 1 && diffDays < 7) {
    return 'weekday';
  }
  if (diffDays < -1 && diffDays > -7) {
    return 'lastWeekday';
  }
  return 'date';
}

/**
 * Day bucket label used by the session group selectors
 * (moment's calendar() with Tabverse's overrides):
 *
 *   Today / Tomorrow / Yesterday / Monday / Last Monday / 28/09/2026
 */
export function dayGroupLabel(
  timestamp: number,
  now: number = Date.now(),
): string {
  const locale = currentLocale();
  switch (dayKind(timestamp, now)) {
    case 'today':
      return t('timeToday');
    case 'tomorrow':
      return t('timeTomorrow');
    case 'yesterday':
      return t('timeYesterday');
    case 'weekday':
      return format(new Date(timestamp), 'EEEE', { locale });
    case 'lastWeekday':
      return t('timeLastWeekday', [
        format(new Date(timestamp), 'EEEE', { locale }),
      ]);
    default:
      return format(new Date(timestamp), 'dd/MM/yyyy', { locale });
  }
}

/**
 * moment's default calendar():
 *   "Today at 2:05 pm", "Yesterday at 2:05 pm", "Last Monday at 2:05 pm",
 *   otherwise just the date.
 */
export function calendarLabel(
  timestamp: number,
  now: number = Date.now(),
): string {
  const locale = currentLocale();
  const kind = dayKind(timestamp, now);
  const label = dayGroupLabel(timestamp, now);
  // week day names and the near days keep their time, plain dates do not
  // (moment behaviour)
  if (kind === 'date') {
    return label;
  }
  return t('timeCalendarAt', [
    label,
    format(new Date(timestamp), 'h:mm a', { locale }),
  ]);
}
