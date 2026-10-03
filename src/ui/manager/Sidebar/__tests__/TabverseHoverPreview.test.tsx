/**
 * The hover panel's markup.
 *
 * Rendered to static markup and read as text - the pattern ADR 0019 established
 * for the console's views, and the only component-level check this repo has (no
 * testing-library, per AGENTS.md). What is pinned here is the promise the panel
 * makes: the tabverse's name, how many tabs it has, the first few in order, how
 * many more there are, and *no buttons* - it is read-only on purpose, because a
 * saved tab carries no live tab id and a dead button is worse than none.
 */

import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { TabversePreviewRows } from '../TabverseHoverPreview';
import tabCardClasses from '../../TabSpace/TabCard.module.scss';
import {
  PreviewTab,
  TabversePreview,
} from '../../../../data/tabSpace/tabversePreview';

const previewTab = (over: Partial<PreviewTab> = {}): PreviewTab => ({
  chromeTabId: 1,
  title: 'A page',
  url: 'https://example.com/a',
  favIconUrl: '',
  pinned: false,
  ...over,
});

const preview = (over: Partial<TabversePreview> = {}): TabversePreview => ({
  windowId: 2,
  tabCount: 1,
  tabs: [previewTab()],
  readAt: 1,
  ...over,
});

function say(props: { name: string; preview?: TabversePreview }): string {
  return renderToStaticMarkup(<TabversePreviewRows {...props} />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function markup(props: { name: string; preview?: TabversePreview }): string {
  return renderToStaticMarkup(<TabversePreviewRows {...props} />);
}

test('the panel names the tabverse and counts its tabs', () => {
  const said = say({
    name: 'Java concurrency notes',
    preview: preview({ tabCount: 12 }),
  });
  expect(said).toContain('Java concurrency notes');
  expect(said).toContain('12 tabs');
  // and it says so before the read lands, rather than claiming zero
  expect(say({ name: 'x' })).toContain('reading…');
});

test('it lists the first few tabs, in order, and how many more there are', () => {
  const said = say({
    name: 'Reading list',
    preview: preview({
      tabCount: 9,
      tabs: [
        previewTab({ chromeTabId: 1, title: 'first', url: 'https://one.com' }),
        previewTab({ chromeTabId: 2, title: 'second', url: 'https://two.com' }),
        previewTab({
          chromeTabId: 3,
          title: 'third',
          url: 'https://three.com',
        }),
        previewTab({
          chromeTabId: 4,
          title: 'fourth',
          url: 'https://four.com',
        }),
      ],
    }),
  });

  expect(said).toContain('first');
  expect(said).toContain('fourth');
  expect(said).toContain('+5 more');
  // strip order, not alphabetical and not the order they were recorded
  expect(said.indexOf('first')).toBeLessThan(said.indexOf('second'));
  expect(said.indexOf('third')).toBeLessThan(said.indexOf('fourth'));
  // the urls are there too: two tabverses with the same tab title are common
  expect(said).toContain('https://one.com');
});

test('no "+N more" when everything fits', () => {
  const said = say({
    name: 'Small',
    preview: preview({ tabCount: 2, tabs: [previewTab({ title: 'only' })] }),
  });
  expect(said).not.toContain('more');
});

test('one tab is one tab', () => {
  expect(say({ name: 'x', preview: preview({ tabCount: 1 }) })).toContain(
    '1 tab',
  );
});

test('an empty window says so, rather than showing an empty box', () => {
  const said = say({
    name: 'Nothing open',
    preview: preview({ tabCount: 0, tabs: [] }),
  });
  expect(said).toContain('No tabs open in this window.');
});

test("it reuses the tab card's preview classes rather than restating them", () => {
  // a css module key that does not exist is `undefined` at runtime and fails
  // silently, so the reuse is asserted rather than assumed: the panel is meant
  // to look like the tab preview, not like a second opinion on it
  const rendered = markup({ name: 'x', preview: preview() });
  expect(tabCardClasses.previewCard.length).toBeGreaterThan(0);
  expect(rendered).toContain(tabCardClasses.previewCard);
  expect(rendered).toContain(tabCardClasses.previewHeaderContainer);
  expect(rendered).toContain(tabCardClasses.previewWrapText);
});

test('the panel is read-only: no buttons, nothing to press', () => {
  // a button here would act on a tab in a window that is not on screen, and a
  // saved tab carries no live id to act with (adr/0019's dead close button)
  const rendered = markup({
    name: 'Read only',
    preview: preview({ tabCount: 3 }),
  });
  expect(rendered).not.toContain('<button');
  expect(rendered).not.toContain('bp6-button');
});

test('each row keeps its full text available for a hover', () => {
  const rendered = markup({
    name: 'A very long tabverse name indeed',
    preview: preview({
      tabCount: 1,
      tabs: [
        previewTab({
          title: 'a long page title',
          url: 'https://long.example/path',
        }),
      ],
    }),
  });
  expect(rendered).toContain('title="A very long tabverse name indeed"');
  expect(rendered).toContain('title="a long page title"');
  expect(rendered).toContain('title="https://long.example/path"');
});
