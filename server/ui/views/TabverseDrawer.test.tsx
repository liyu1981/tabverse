import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { TabverseBody } from './TabverseDrawer';
import type { TabspaceBundle } from '../data/types';

/**
 * The drawer's content, rendered to markup.
 *
 * `renderToStaticMarkup` is what makes views testable in this repository at all:
 * the repo's rule is no jsdom (AGENTS.md), and a Blueprint `Portal` - which is
 * what a Drawer is - renders nothing without a document, so the drawer's own
 * wrapper is not what these assertions read. The content is a plain tree, and
 * this is the part with the information in it.
 */

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
      {
        id: 't1',
        rev: 1,
        updated_at: 1,
        server_at: 1,
        position: 0,
        data: {
          title: 'docs',
          url: 'https://example.com/docs',
          favIconUrl: 'https://example.com/favicon.ico',
          pinned: true,
        },
      },
      {
        id: 't2',
        rev: 1,
        updated_at: 1,
        server_at: 1,
        position: 1,
        data: {
          title: 'mail',
          url: 'https://mail.example.com',
          favIconUrl: '',
        },
      },
    ],
    notes: [
      {
        id: 'n1',
        rev: 1,
        updated_at: 1,
        server_at: 1,
        position: 0,
        data: { name: 'plan', data: 'ship the console' },
      },
    ],
    todos: [],
    bookmarks: [],
    closed_tabs: [],
    aggregates: { allnote: '{"noteIds":["n1"]}' },
    ...over,
  };
}

test('the summary line is the extension`s own sentence', () => {
  const html = renderToStaticMarkup(<TabverseBody bundle={bundle()} />);
  expect(html).toContain('Working on');
  expect(html).toContain('>2</b>');
  expect(html).toContain('tabs');
  expect(html).toContain('>1</b>');
  expect(html).toContain('group');
});

test('a tab is a card with its favicon, title, url and flags', () => {
  const html = renderToStaticMarkup(<TabverseBody bundle={bundle()} />);
  expect(html).toContain('https://example.com/favicon.ico');
  expect(html).toContain('docs');
  expect(html).toContain('https://example.com/docs');
  // Chrome puts pinned tabs in their own section, so "pinned" is part of what a
  // tab is and has to be readable here too.
  expect(html).toContain('pinned');
});

test('a group is a block carrying its colour and its count', () => {
  const html = renderToStaticMarkup(<TabverseBody bundle={bundle()} />);
  expect(html).toContain('var(--group-blue)');
  expect(html).toContain('work');
});

test('an empty tabverse says so instead of drawing nothing', () => {
  const html = renderToStaticMarkup(
    <TabverseBody bundle={bundle({ tabs: [], tabspace_data: {} })} />,
  );
  expect(html).toContain('no tabs in this tabverse');
});

test('everything that is not a tab is folded away, and counted', () => {
  const html = renderToStaticMarkup(<TabverseBody bundle={bundle()} />);
  expect(html).toContain(
    'notes, todos, bookmarks and closed tabs stored with it (1)',
  );
  expect(html).toContain('ship the console');
});

test('a tab without a favicon still draws its title', () => {
  const html = renderToStaticMarkup(<TabverseBody bundle={bundle()} />);
  expect(html).toContain('mail');
  // One favicon in the bundle, one image in the markup: the row with none does
  // not get a placeholder image, because a placeholder would be a request.
  expect(html.match(/<img/g) || []).toHaveLength(1);
});
