/**
 * The hover preview's header (static markup, AGENTS.md: no browser).
 *
 * The preview is the wider surface, but a query-heavy or percent-encoded url
 * still runs past it, and the header wraps with `word-break: break-all` - so an
 * uncapped url made a header taller than the thumbnail it exists to caption.
 * What this pins: a url past the cap is truncated with an ellipsis while the
 * full url stays in its tooltip, and a url that fits is left alone.
 */
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import type { Tab } from '../../../../data/tabSpace/Tab';
import { TabDetailPreviewPanel } from '../TabCard';

function tabWithUrl(url: string): Tab {
  return {
    id: 't1',
    tabSpaceId: 'ts_1',
    title: 'a title',
    url,
    favIconUrl: '',
    pinned: false,
    suspended: false,
    createdAt: 1,
    updatedAt: 1,
    version: 0,
    chromeTabId: -1,
    chromeWindowId: -1,
  };
}

const render = (url: string) =>
  renderToStaticMarkup(
    <TabDetailPreviewPanel tab={tabWithUrl(url)} tabPreview="" />,
  );

/** The visible text nodes, so the assertion is about what is shown. */
function visibleTexts(markup: string): string[] {
  return [...markup.matchAll(/>([^<>]*)</g)].map((match) => match[1]);
}

test('a too-long url is truncated, and the full one is in the tooltip', () => {
  const url = `https://example.com/${'a'.repeat(300)}`;
  const markup = render(url);
  expect(markup).toContain(`title="${url}"`);
  const truncated = visibleTexts(markup).find((text) => text.endsWith('...'));
  expect(truncated).toBeDefined();
  expect(truncated?.length).toBeLessThan(url.length);
  expect(url.startsWith(truncated?.slice(0, -3) ?? '')).toBe(true);
});

test('a url that fits is shown as it is', () => {
  const url = 'https://example.com/';
  expect(visibleTexts(render(url))).toContain(url);
  expect(render(url)).not.toContain('...');
});
