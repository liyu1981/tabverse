/**
 * Date/time formatting helpers.
 *
 * Replaces the moment dependency: everything the UI needs is relative
 * labels ("3 days ago", "Today at 14:30"), one long timestamp format and a
 * day grouping key. date-fns is tree-shakeable, so only the pieces we use
 * end up in the bundle.
 */

import { format, formatDistanceToNow, startOfDay } from 'date-fns';

/** "3 days ago" / "in 2 hours" (moment's fromNow()). */
export function fromNow(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

/** 'March 3rd 2024, 2:05:07 pm' (moment's 'MMMM Do YYYY, h:mm:ss a'). */
export function formatDateTime(timestamp: number): string {
  return format(new Date(timestamp), 'MMMM do yyyy, h:mm:ss aaa');
}

/** Start of the local day, in ms (moment's startOf('day').valueOf()). */
export function startOfDayMs(timestamp: number): number {
  return startOfDay(new Date(timestamp)).getTime();
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
  const day = startOfDayMs(timestamp);
  const today = startOfDayMs(now);
  const diffDays = Math.round((day - today) / 86_400_000);

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Tomorrow';
  }
  if (diffDays === -1) {
    return 'Yesterday';
  }
  if (diffDays > 1 && diffDays < 7) {
    return format(new Date(timestamp), 'EEEE');
  }
  if (diffDays < -1 && diffDays > -7) {
    return `Last ${format(new Date(timestamp), 'EEEE')}`;
  }
  return format(new Date(timestamp), 'dd/MM/yyyy');
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
  const label = dayGroupLabel(timestamp, now);
  if (label === 'Today' || label === 'Yesterday') {
    return `${label} at ${format(new Date(timestamp), 'h:mm a')}`;
  }
  if (label.startsWith('Last ')) {
    return `${label} at ${format(new Date(timestamp), 'h:mm a')}`;
  }
  // week day names keep their time, plain dates do not (moment behaviour)
  if (/^[A-Za-z]+$/.test(label)) {
    return `${label} at ${format(new Date(timestamp), 'h:mm a')}`;
  }
  return label;
}
