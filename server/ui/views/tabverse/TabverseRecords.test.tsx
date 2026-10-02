import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { BookmarkPanel } from './BookmarkPanel';
import { HistoryPanel } from './HistoryPanel';
import { NotePanel } from './NotePanel';
import { TabverseRecords } from './TabverseRecords';
import { TodoPanel } from './TodoPanel';
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
  // `calendarLabel` from src/time.ts, reused rather than re-worded
  expect(html).toMatch(/October \d+(st|nd|rd|th) 2026|Today|Yesterday/);
  // a tab closed three times says so, as the extension says so
  expect(html).toContain('x3');
});

test('history cannot be restored, bookmarked or deleted from here', () => {
  const html = renderToStaticMarkup(<HistoryPanel history={[closed()]} />);
  expect(html).not.toContain('Reopen');
  expect(html).not.toContain('bp6-icon-undo');
});

test('no history at all is the extension`s own notice', () => {
  const html = renderToStaticMarkup(<HistoryPanel history={[]} />);
  expect(html).toContain('No closed tab');
});
