import { expect, test } from 'vitest';

import {
  NO_HISTORY_SITE,
  groupHistoryBySite,
  historySearchTerms,
  historySiteOf,
  isHistorySearchActive,
  matchHistoryEntries,
} from '../historyFilter';
import type { ClosedTab } from '../ClosedTab';

/**
 * The two things the History card's search box and group switch ask for.
 *
 * Neither the box nor the switch can be pressed in a test in this repo (no
 * jsdom, no testing-library - AGENTS.md), so the questions are asked here
 * instead and the view is left to only wire the answers up.
 */

// Local time on purpose: a day bucket is a local day, so an entry has to be
// placed in the local day it names. Building the timestamps from UTC strings
// would make this file pass or fail with the runner's timezone.
const at = (month: number, day: number, hour: number): number =>
  new Date(2026, month, day, hour, 0, 0).getTime();

/** A Tuesday, midday. */
const NOW = at(9, 6, 12);

function closed(
  i: number,
  title: string,
  url: string,
  closedAt: number = NOW,
): ClosedTab {
  return {
    id: `c${i}`,
    tabSpaceId: 'ts_1',
    title,
    url,
    favIconUrl: '',
    closedAt,
    timesClosed: 1,
    createdAt: 0,
    updatedAt: 0,
    version: 0,
  };
}

const titlesOf = (entries: readonly ClosedTab[]) => entries.map((e) => e.title);

test('the box is looking for every one of its terms, not any of them', () => {
  const entries = [
    closed(1, 'github issues', 'https://github.com/a/b/issues'),
    closed(2, 'github pull requests', 'https://github.com/a/b/pulls'),
    closed(3, 'notes about github', 'https://example.com/notes'),
  ];
  const matched = titlesOf(matchHistoryEntries(entries, 'github issues'));
  expect(matched).toEqual(['github issues']);
});

test('a term may come from the title and another from the url', () => {
  // The row says "issues" in its title and "github" only in its url. The
  // global search needs both words in one field; a filter box over rows you can
  // see should not, or "github issues" would miss the very tab you mean.
  const entries = [
    closed(1, 'issues', 'https://github.com/a/b/issues'),
    closed(2, 'github', 'https://example.com/github'),
  ];
  expect(titlesOf(matchHistoryEntries(entries, 'github issues'))).toEqual([
    'issues',
  ]);
});

test('terms match inside a word, and case is what nobody remembers', () => {
  const entries = [
    closed(1, 'GitHub Issues', 'https://github.com/a/b'),
    closed(2, 'Gmail', 'https://mail.google.com'),
  ];
  expect(titlesOf(matchHistoryEntries(entries, 'hub'))).toEqual([
    'GitHub Issues',
  ]);
  expect(titlesOf(matchHistoryEntries(entries, 'HUB ISS'))).toEqual([
    'GitHub Issues',
  ]);
});

test('a blank box is not a filter, it is the whole list', () => {
  const entries = [
    closed(1, 'one', 'https://a'),
    closed(2, 'two', 'https://b'),
  ];
  for (const blank of ['', '   ', '\t\n']) {
    expect(matchHistoryEntries(entries, blank)).toEqual(entries);
    expect(isHistorySearchActive(blank)).toBe(false);
    expect(historySearchTerms(blank)).toEqual([]);
  }
  expect(isHistorySearchActive(' github ')).toBe(true);
  expect(historySearchTerms(' GitHub  Issues ')).toEqual(['github', 'issues']);
});

test('a search that matches nothing is an empty list, not the whole list', () => {
  const entries = [
    closed(1, 'one', 'https://a'),
    closed(2, 'two', 'https://b'),
  ];
  expect(matchHistoryEntries(entries, 'nothing')).toEqual([]);
});

test('searching keeps the order the list came in', () => {
  // No ranking: the history is a timeline, so "the best match" would put a page
  // closed last Tuesday above one closed an hour ago.
  const entries = [
    closed(1, 'today', 'https://a', NOW),
    closed(2, 'old match', 'https://b', NOW - 86_400_000 * 5),
    closed(3, 'also today', 'https://c', NOW - 1000),
  ];
  expect(titlesOf(matchHistoryEntries(entries, 'o'))).toEqual([
    'today',
    'old match',
    'also today',
  ]);
});

test('searching does not touch the list it was given', () => {
  const entries = [
    closed(1, 'one', 'https://a'),
    closed(2, 'two', 'https://b'),
  ];
  const before = [...entries];
  matchHistoryEntries(entries, 'one');
  groupHistoryBySite(entries);
  expect(entries).toEqual(before);
  // and the caller owns the array it gets back: no shared array to sort later
  expect(matchHistoryEntries(entries, '')).not.toBe(entries);
});

test('entries are grouped by site, newest first inside each group', () => {
  // The list the store hands over is newest first, and grouping must not
  // reorder it: within a site the most recently closed page comes first, and
  // the site whose newest page is the newest of all comes first of all.
  const entries = [
    closed(1, 'github newest', 'https://github.com/a', NOW + 9000),
    closed(2, 'news newest', 'https://news.example.com/x', NOW + 8000),
    closed(3, 'github middle', 'https://github.com/b', NOW + 7000),
    closed(4, 'github oldest', 'https://github.com/c', NOW + 6000),
  ];
  const groups = groupHistoryBySite(entries);

  expect(groups.map((group) => group.site)).toEqual([
    'github.com',
    'news.example.com',
  ]);
  expect(titlesOf(groups[0].entries)).toEqual([
    'github newest',
    'github middle',
    'github oldest',
  ]);
  expect(titlesOf(groups[1].entries)).toEqual(['news newest']);
});

test('grouping what the search left is one call, not two answers to keep in step', () => {
  // The grouped view is not a second, separately filtered list: it is the
  // matches, bucketed by site. So the two compose by being called in that order,
  // and a site whose rows were all filtered out is simply not a group.
  const entries = [
    closed(1, 'github issues', 'https://github.com/a', NOW + 3000),
    closed(2, 'github pull requests', 'https://github.com/b', NOW + 2000),
    closed(3, 'gmail', 'https://mail.google.com/', NOW + 1000),
    closed(4, 'github gist', 'https://gist.github.com/c', NOW + 500),
  ];
  const groups = groupHistoryBySite(matchHistoryEntries(entries, 'github'));
  // the gist matched on its url, and it stays its own site: grouping is by the
  // url's host, not by whatever word the search found
  expect(groups.map((group) => group.site)).toEqual([
    'github.com',
    'gist.github.com',
  ]);
  expect(titlesOf(groups[0].entries)).toEqual([
    'github issues',
    'github pull requests',
  ]);
});

// ---- which site a row belongs to -------------------------------------------

test('a site is the host, lower cased, without its www', () => {
  // www.github.com and github.com are one site to anyone closing tabs; splitting
  // them would answer "what was I reading here" with two half answers.
  expect(historySiteOf('https://github.com/a/b')).toBe('github.com');
  expect(historySiteOf('https://www.github.com/a/b')).toBe('github.com');
  expect(historySiteOf('https://GitHub.COM/a')).toBe('github.com');
  // the path and the query are not the site
  expect(historySiteOf('https://github.com/a/b?q=1')).toBe('github.com');
  // and neither is the port: the same host on another port is the same host
  expect(historySiteOf('https://example.com:8443/a')).toBe('example.com');
});

test('the host is the site, not the registrable domain', () => {
  // Without a public suffix list there is nothing to collapse mail.google.com
  // into google.com with, so it is a site of its own - which is what Chrome's
  // own history does with the same rows.
  expect(historySiteOf('https://mail.google.com/mail/u/0')).toBe(
    'mail.google.com',
  );
  expect(
    groupHistoryBySite([
      closed(1, 'a', 'https://github.com/a'),
      closed(2, 'b', 'https://mail.google.com/b'),
    ]).length,
  ).toBe(2);
});

test('a page the browser serves itself is named by its scheme', () => {
  // These have no host to group by, and the scheme is what a person recognises
  // them by.
  expect(historySiteOf('chrome://extensions')).toBe('chrome');
  expect(historySiteOf('file:///home/me/notes.html')).toBe('file');
  expect(historySiteOf('about:blank')).toBe('about');
});

test('a row that is not a url is never dropped for want of a group', () => {
  // It goes to the bucket that says so, rather than vanishing: a row the user
  // can see has to be somewhere they can find it again.
  expect(historySiteOf('')).toBe(NO_HISTORY_SITE);
  expect(historySiteOf('   ')).toBe(NO_HISTORY_SITE);
  expect(historySiteOf('not a url')).toBe(NO_HISTORY_SITE);
  const entries = [
    closed(1, 'a page', ''),
    closed(2, 'a site', 'https://a.com'),
  ];
  expect(groupHistoryBySite(entries).map((group) => group.site)).toEqual([
    NO_HISTORY_SITE,
    'a.com',
  ]);
});

test('one site, however many pages of it were closed', () => {
  const entries = [
    closed(1, 'one', 'https://www.example.com/1'),
    closed(2, 'two', 'https://example.com/2'),
    closed(3, 'three', 'https://EXAMPLE.com/3'),
  ];
  const groups = groupHistoryBySite(entries);
  expect(groups.length).toBe(1);
  expect(groups[0].site).toBe('example.com');
  expect(titlesOf(groups[0].entries)).toEqual(['one', 'two', 'three']);
});

test('the count on a header is the number of rows under it', () => {
  const entries = [
    closed(1, 'a', 'https://a.com/1'),
    closed(2, 'b', 'https://a.com/2'),
    closed(3, 'c', 'https://b.com/1'),
  ];
  const groups = groupHistoryBySite(entries);
  expect(groups.map((group) => group.entries.length)).toEqual([2, 1]);
});

test('nothing to group is no groups, and no header is drawn for it', () => {
  expect(groupHistoryBySite([])).toEqual([]);
});

test('a row is in exactly one group, and it is the one its url names', () => {
  const entries = [
    closed(1, 'a', 'https://a.com/1'),
    closed(2, 'b', 'https://b.com/1'),
    closed(3, 'c', 'https://a.com/2'),
  ];
  const bySite = new Map<string, ClosedTab[]>();
  for (const group of groupHistoryBySite(entries)) {
    bySite.set(group.site, group.entries);
  }
  expect([...bySite.keys()].sort()).toEqual(['a.com', 'b.com']);
  expect(titlesOf(bySite.get('a.com'))).toEqual(['a', 'c']);
  expect(bySite.get('b.com').length).toBe(1);
});
