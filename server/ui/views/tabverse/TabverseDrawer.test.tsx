import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { TabverseTabs } from './TabverseDrawer';
import type { BundleRow, TabspaceBundle } from '../../data/types';

/**
 * The drawer, rendered to markup.
 *
 * `renderToStaticMarkup` is what makes views testable in this repository at all:
 * the repo's rule is no jsdom (AGENTS.md), and a Blueprint `Portal` - which is
 * what a Drawer is - renders nothing without a document, so the drawer's own
 * wrapper is not what these assertions read.
 *
 * Since `adr/0019` the tab list inside is the extension's own `TabCard`,
 * `TabGroupBlock` and `tabverseEntries`, so these assertions are mostly about
 * the two things the console is still responsible for: the adapter produces the
 * shape those components expect, and nothing in them reaches for this browser.
 */

function tab(
  id: string,
  position: number,
  extra: Record<string, any> = {},
): BundleRow {
  return {
    id,
    rev: 1,
    updated_at: 1000,
    server_at: 1000,
    position,
    data: {
      title: `tab ${id}`,
      url: `https://example.com/${id}`,
      favIconUrl: '',
      pinned: false,
      suspended: false,
      ...extra,
    },
  };
}

function bundle(over: Partial<TabspaceBundle> = {}): TabspaceBundle {
  return {
    tabspace: {
      id: 'ts_1',
      name: 'Window-3',
      created_at: Date.parse('2026-09-30T08:00:00Z'),
      updated_at: Date.parse('2026-10-02T09:00:00Z'),
      rev: 4,
      tab_count: 2,
      groups: 1,
      notes: 0,
      todos: 0,
      bookmarks: 0,
      closed_tabs: 0,
    },
    tabspace_data: {
      tabGroups: [{ id: 'g1', title: 'work', color: 'blue', tabIds: ['t2'] }],
    },
    tabs: [
      tab('t1', 0, {
        title: 'docs',
        url: 'https://example.com/docs',
        favIconUrl: 'https://example.com/favicon.ico',
        pinned: true,
      }),
      tab('t2', 1, { title: 'mail', url: 'https://mail.example.com' }),
    ],
    notes: [],
    todos: [],
    bookmarks: [],
    closed_tabs: [],
    aggregates: {},
    ...over,
  };
}

/** The text a reader sees, with markup and the bold taken out. */
function say(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

test('the list label carries the count, in place of a summary sentence', () => {
  const html = renderToStaticMarkup(<TabverseTabs bundle={bundle()} />);
  expect(html).toContain('Tabs');
  expect(html.replace(/<[^>]+>/g, '')).toContain('Tabs (2)');
  // The extension says the same facts in a sentence; a label says them in less
  // space, and the groups are already named in the blocks they head.
  expect(html).not.toContain('Working on');
});

test('a tab is the extension`s card: title over url, with its pinned tag', () => {
  const html = renderToStaticMarkup(<TabverseTabs bundle={bundle()} />);
  // The card is a Blueprint card with the extension's own module classes, and
  // the url is the truncated label the extension shows.
  expect(html).toContain('bp6-card');
  expect(html).toContain('docs');
  expect(html).toContain('https://example.com/docs');
  // Chrome puts pinned tabs in their own section, so "pinned" is part of what a
  // tab is and has to be readable here too - as the extension's Tag, pin and
  // all, not as a chip of the console's own.
  expect(html).toContain('bp6-icon-pin');
  expect(html).toContain('pinned');
});

test('a group is the extension`s block, in that group`s colour', () => {
  const html = renderToStaticMarkup(<TabverseTabs bundle={bundle()} />);
  // #3b6fd4 is TAB_GROUP_COLORS_JS.blue, compiled into the component: the
  // console no longer keeps a palette of its own.
  expect(html).toContain('#3b6fd4');
  expect(html).toContain('work');
});

test('nothing in a tabverse on somebody else`s account can act on this browser', () => {
  const html = renderToStaticMarkup(<TabverseTabs bundle={bundle()} />);
  // The guard is `chromeTabId > 0` in TabCard and the adapter stores 0, so a
  // stored tab offers no close button. This is the assertion that would fail if
  // the sentinel ever came back as -1.
  expect(html).not.toContain('Close this tab');
  expect(html).not.toContain('Save this tab as a bookmark');
});

test('a tabverse with no tabs says so instead of drawing nothing', () => {
  const html = renderToStaticMarkup(
    <TabverseTabs bundle={bundle({ tabs: [], tabspace_data: {} })} />,
  );
  expect(html).toContain('no tabs in this tabverse');
  // the label says so too, rather than the list looking simply absent
  expect(say(html)).toContain('Tabs (0)');
});

test('the header is the tabverse, its two times, and how many tabs it holds', () => {
  const html = renderToStaticMarkup(<TabverseTabs bundle={bundle()} />);
  expect(html).toContain('Window-3');
  expect(html).toContain('Created');
  expect(html).toContain('Saved');
  // ...and none of the live window's furniture, which is about this browser and
  // not about the stored record.
  expect(html).not.toContain('Save and close');
  expect(html).not.toContain('Mark all as complete');
});

test('the list says what it is', () => {
  // The tools beside it have names on their tabs; a column of cards with
  // nothing over it read as the whole tabverse rather than as the tabs.
  const html = renderToStaticMarkup(<TabverseTabs bundle={bundle()} />);
  expect(html).toContain('Tabs');
});

test('the record`s own facts sit on the title row, as the extension`s control does', () => {
  const html = renderToStaticMarkup(
    <TabverseTabs bundle={bundle()} meta="ts_1 · rev 4 · updated 2h ago" />,
  );
  expect(html).toContain('rev 4');
  // and the pane on its own (as the drawer's right pane can be read) has no
  // invented facts
  expect(
    renderToStaticMarkup(<TabverseTabs bundle={bundle()} />),
  ).not.toContain('rev 4');
});

/**
 * The one image the console asks a third party for, asserted so it is a
 * decision rather than a surprise: `FavIcon` falls back to a dummyimage.com
 * URL for a tab with no icon of its own (ADR 0016 removed that from the
 * preview path for exactly this reason). The console accepts it for now and
 * will draw its own icon later (ADR 0019, decision 3) - so when FavIcon grows a
 * local placeholder, this is the assertion to delete.
 */
test('a tab without an icon gets the extension`s placeholder, which is remote', () => {
  const html = renderToStaticMarkup(<TabverseTabs bundle={bundle()} />);
  expect(html).toContain('dummyimage.com');
});

// Reported as: a tabverse with a split and a split inside a group shows every
// tab in the console, but the splits are gone - the window layout the user had is
// not in the console's picture of the account. The pairing is in the record now
// (ADR 0022), so it draws; `SplitBlock` was imported for exactly this.
test('a split view is drawn, from the pairing the record carries', () => {
  const html = renderToStaticMarkup(
    <TabverseTabs
      bundle={bundle({
        tabspace_data: {},
        tabs: [
          tab('t1', 0, { title: 'left', splitWith: 't2' }),
          tab('t2', 1, { title: 'right', splitWith: 't1' }),
          tab('t3', 2, { title: 'loose' }),
        ],
      })}
    />,
  );
  // The block's own label, which is what says "these two are side by side".
  expect(say(html)).toContain('split view');
  // Every tab is still there: a split block holds two cards, and the third is
  // loose beside it.
  expect(say(html)).toContain('left');
  expect(say(html)).toContain('right');
  expect(say(html)).toContain('loose');
  expect(html).not.toContain('Close this tab');
});

test('a split inside a group is drawn inside the group', () => {
  const html = renderToStaticMarkup(
    <TabverseTabs
      bundle={bundle({
        tabspace_data: {
          tabGroups: [
            { id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] },
          ],
        },
        tabs: [
          tab('t1', 0, { title: 'left', splitWith: 't2' }),
          tab('t2', 1, { title: 'right', splitWith: 't1' }),
        ],
      })}
    />,
  );
  // The group's own colour rule is there, and the split inside it, rather than
  // the two cards standing as plain tabs in the group.
  expect(html).toContain('#3b6fd4');
  expect(say(html)).toContain('split view');
  expect(say(html)).toContain('left');
  expect(say(html)).toContain('right');
});
