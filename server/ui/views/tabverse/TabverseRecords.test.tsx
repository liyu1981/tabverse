import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { BookmarkPanel } from './BookmarkPanel';
import { HistoryList, HistoryPanel } from './HistoryPanel';
import { NotePanel } from './NotePanel';
import { TabverseRecords } from './TabverseRecords';
import { TodoPanel } from './TodoPanel';
import historyClasses from '../../../../src/ui/history/HistoryView.module.scss';
import type {
  Bookmark,
  ClosedTab,
  Note,
  Todo,
} from '../../data/tabverseAdapter';

/**
 * The right side of a tabverse: the extension's four tools, read.
 *
 * The extension's own views are editors bound to the local database, so what is
 * reused here is their stylesheets and their wording - not the components. The
 * assertions are about the two things that follow: each tool looks like the
 * extension's, and none of them offers anything that could change a record.
 *
 * The tab strip is tested on its own and each panel below it, because the strip
 * renders one panel at a time - which is also how an operator meets them.
 */

const nothing = {
  todos: [],
  notes: [],
  bookmarks: [],
  history: [],
};

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    tabSpaceId: 'ts_1',
    content: 'ship the console',
    completed: false,
    createdAt: 0,
    updatedAt: 1,
    version: 0,
    ...over,
  };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    tabSpaceId: 'ts_1',
    name: 'plan',
    data: '<p>first line</p>',
    createdAt: 0,
    updatedAt: 1,
    version: 0,
    ...over,
  };
}

function bookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'b1',
    tabSpaceId: 'ts_1',
    name: 'docs',
    url: 'https://example.com/docs',
    favIconUrl: 'https://example.com/favicon.ico',
    createdAt: 0,
    updatedAt: 1,
    version: 0,
    ...over,
  };
}

function closed(over: Partial<ClosedTab> = {}): ClosedTab {
  return {
    id: 'c1',
    tabSpaceId: 'ts_1',
    title: 'a search result',
    url: 'https://example.com/search?q=tabverse',
    favIconUrl: '',
    closedAt: Date.parse('2026-10-02T09:00:00Z'),
    timesClosed: 3,
    createdAt: 0,
    updatedAt: 1,
    version: 0,
    ...over,
  };
}

// ---- the strip -------------------------------------------------------------

test('the four tools are the extension`s, in the extension`s order', () => {
  const html = renderToStaticMarkup(<TabverseRecords {...nothing} />);
  expect(html.indexOf('Todo')).toBeLessThan(html.indexOf('Note'));
  expect(html.indexOf('Note')).toBeLessThan(html.indexOf('Bookmark'));
  expect(html.indexOf('Bookmark')).toBeLessThan(html.indexOf('History'));
  // the extension's icons, and its pill tabs
  expect(html).toContain('bp6-icon-confirm');
  expect(html).toContain('bp6-icon-clipboard');
  expect(html).toContain('bp6-icon-book');
  expect(html).toContain('bp6-icon-history');
  expect(html).toContain('bp6-tab');
});

test('there is no lock: a tool cannot be pinned in a read-only view', () => {
  const html = renderToStaticMarkup(<TabverseRecords {...nothing} />);
  expect(html).not.toContain('Pin current tool');
  expect(html).not.toContain('Unpin current tool');
});

test('todo is the tool that is already open, as it is in the extension', () => {
  const html = renderToStaticMarkup(<TabverseRecords {...nothing} />);
  expect(html).toContain('aria-selected="true"');
  expect(html.indexOf('data-tab-id="todo"')).toBeLessThan(
    html.indexOf('data-tab-id="note"'),
  );
});

// ---- todo ------------------------------------------------------------------

test('a todo is the extension`s row, and the circle is state, not a control', () => {
  const html = renderToStaticMarkup(
    <TodoPanel
      todos={[todo(), todo({ id: 't2', content: 'later', completed: true })]}
    />,
  );
  expect(html).toContain('ship the console');
  expect(html).toContain('later');
  // completed sorts to the bottom, as the extension sorts it
  expect(html.indexOf('later')).toBeGreaterThan(
    html.indexOf('ship the console'),
  );
  // the checkbox that draws the circle is disabled: it shows the state and does
  // not offer to change it
  expect(html).toContain('disabled');
  expect(html).toContain('aria-label="not completed"');
  expect(html).toContain('aria-label="completed"');
});

test('the todo filters and the count stay, because they only change what is shown', () => {
  const html = renderToStaticMarkup(<TodoPanel todos={[todo()]} />);
  expect(html).toContain('left');
  expect(html).toContain('All');
  expect(html).toContain('Active');
  expect(html).toContain('Completed');
});

test('no todo can be added, ticked or deleted from here', () => {
  const html = renderToStaticMarkup(<TodoPanel todos={[todo()]} />);
  expect(html).not.toContain('What needs to be done?');
  expect(html).not.toContain('Mark all as complete');
  expect(html).not.toContain('Clear completed');
  expect(html).not.toContain('Delete todo');
});

// ---- note ------------------------------------------------------------------

test('a note is its name and its body, as text', () => {
  const html = renderToStaticMarkup(
    <NotePanel
      notes={[note({ data: '<p>first <strong>line</strong></p>' })]}
    />,
  );
  expect(html).toContain('plan');
  expect(html).toContain('first line');
  // and no markup: that HTML was written on another machine
  expect(html).not.toContain('<strong>');
});

test('a note is a card, like everything else this drawer puts in a column', () => {
  const html = renderToStaticMarkup(
    <NotePanel notes={[note(), note({ id: 'n2', name: 'second' })]} />,
  );
  // two notes, two cards
  expect(html.match(/bp6-card/g) || []).toHaveLength(2);
  expect(html).toContain('second');
});

test('a note cannot be created, renamed or deleted from here', () => {
  const html = renderToStaticMarkup(<NotePanel notes={[note()]} />);
  expect(html).not.toContain('New Note');
  expect(html).not.toContain('bp6-editable-text');
});

test('an empty note body says so rather than drawing an empty box', () => {
  const html = renderToStaticMarkup(<NotePanel notes={[note({ data: '' })]} />);
  expect(html).toContain('(empty)');
});

test('no notes at all is the extension`s own notice', () => {
  const html = renderToStaticMarkup(<NotePanel notes={[]} />);
  expect(html).toContain('No notes');
});

// ---- bookmark --------------------------------------------------------------

test('a bookmark is its name over its url, with the icon it stored', () => {
  const html = renderToStaticMarkup(<BookmarkPanel bookmarks={[bookmark()]} />);
  expect(html).toContain('docs');
  expect(html).toContain('https://example.com/docs');
  expect(html).toContain('favicon.ico');
});

test('a bookmark cannot be opened into this window or deleted from here', () => {
  const html = renderToStaticMarkup(<BookmarkPanel bookmarks={[bookmark()]} />);
  expect(html).not.toContain('Open In Current Tabverse');
  expect(html).not.toContain('Delete It');
});

test('a bookmark with no icon draws no image, rather than fetching one', () => {
  const html = renderToStaticMarkup(
    <BookmarkPanel bookmarks={[bookmark({ favIconUrl: '' })]} />,
  );
  expect(html).not.toContain('<img');
  expect(html).not.toContain('dummyimage.com');
});

// ---- history ---------------------------------------------------------------

test('history says when a tab was closed, in the extension`s own words', () => {
  const html = renderToStaticMarkup(<HistoryPanel history={[closed()]} />);
  expect(html).toContain('a search result');
  expect(html).toContain('https://example.com/search?q=tabverse');
  // `calendarLabel` from src/time.ts, reused rather than re-worded. It answers
  // with Today/Tomorrow/Yesterday, a weekday, "Last <weekday>", or a dd/MM/yyyy
  // date - never "October 12th 2026", which the first version of this assertion
  // waited for and never got: the fixture is a fixed date, so its label moves
  // with the calendar, and a regex that only covers two days of it fails on the
  // other 364.
  expect(html).toMatch(
    /Today|Tomorrow|Yesterday|Last [A-Za-z]+|\d{2}\/\d{2}\/\d{4}/,
  );
  // a tab closed three times says so, as the extension says so
  expect(html).toContain('x3');
});

test('history cannot be restored, bookmarked or deleted from here', () => {
  const html = renderToStaticMarkup(<HistoryPanel history={[closed()]} />);
  expect(html).not.toContain('Reopen');
  expect(html).not.toContain('bp6-icon-undo');
});

test('history pages at ten, the number the extension uses', () => {
  // A tabverse keeps up to 999 closed tabs (adr/0007) and the drawer has the lot,
  // so an unpaginated panel was a thousand rows with no way to the bottom. Ten is
  // the extension's own HISTORY_PAGE_LIMIT and BookmarkView's, and this panel
  // pages with the extension's hook, so the two cannot drift apart.
  const many = Array.from({ length: 25 }, (_, i) =>
    closed({ id: `c${i + 1}`, title: `closed ${i + 1}` }),
  );
  const html = renderToStaticMarkup(<HistoryPanel history={many} />);
  // ten rows, and not the twenty-five
  expect((html.match(/<li>/g) ?? []).length).toBe(10);
  expect(html).toContain('closed 1');
  expect(html).not.toContain('closed 11');
  // the page control is the extension's, which says how many pages there are -
  // so it is visible that this is one page of the list and not all of it
  expect(html).toContain('1/3');
  expect(html).toContain('chevron-right');
});

test('a history that fits on one page carries no page control', () => {
  const few = Array.from({ length: 4 }, (_, i) =>
    closed({ id: `c${i + 1}`, title: `closed ${i + 1}` }),
  );
  const html = renderToStaticMarkup(<HistoryPanel history={few} />);
  expect((html.match(/<li>/g) ?? []).length).toBe(4);
  expect(html).not.toContain('chevron-left');
});

test('the first page is the newest ten, in the order the bundle sent them', () => {
  // The panel does not sort: the server ordered the bundle, and the extension's
  // list does the same (ADR 0015 reads the client's own ordering).
  const many = Array.from({ length: 12 }, (_, i) =>
    closed({ id: `c${i + 1}`, title: `closed ${i + 1}` }),
  );
  const said = renderToStaticMarkup(<HistoryPanel history={many} />)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ');
  expect(said.indexOf('closed 1')).toBeLessThan(said.indexOf('closed 10'));
  expect(said).not.toContain('closed 11');
});

test('no history at all is the extension`s own notice', () => {
  const html = renderToStaticMarkup(<HistoryPanel history={[]} />);
  expect(html).toContain('No closed tab');
  // and nothing to search or group, so neither control is drawn
  expect(html).not.toContain('bp6-icon-search');
  expect(html).not.toContain('bp6-icon-group-objects');
});

test('history is searched and grouped by the extension`s own two answers', () => {
  // The extension's card grew a search box and a switch to group by site, and it
  // would be a second implementation to go stale if this panel answered those
  // questions its own way: the box and the switch are the extension's
  // `HistoryToolbar` on the extension's classes, and what they filter and group
  // is the extension's `historyFilter`. What can be checked here is the wiring -
  // the controls are the extension's and the grouped list is the extension's
  // markup. Keystrokes and clicks are not: there is no DOM here (AGENTS.md).
  const many = Array.from({ length: 25 }, (_, i) =>
    closed({ id: `c${i + 1}`, title: `closed ${i + 1}` }),
  );
  const panel = renderToStaticMarkup(<HistoryPanel history={many} />);
  expect(panel).toContain('bp6-icon-search');
  expect(panel).toContain('search these closed tabs');
  expect(panel).toContain('bp6-icon-group-objects');
  expect(panel).toContain('aria-pressed="false"');

  const grouped = renderToStaticMarkup(
    <HistoryList entries={many} grouped={true} />,
  );
  // one header for the one site these rows are on, and all of them: the grouped
  // view is the whole list, not another page of it
  expect(grouped).toContain(historyClasses.groupHeader);
  expect((grouped.match(/<li>/g) ?? []).length).toBe(25);
  expect(grouped).not.toContain('chevron-right');

  // and the flat list is still the paged one, with no header on it
  const flat = renderToStaticMarkup(
    <HistoryList entries={many} grouped={false} />,
  );
  expect((flat.match(/<li>/g) ?? []).length).toBe(10);
  expect(flat).not.toContain(historyClasses.groupHeader);
});
