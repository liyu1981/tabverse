import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { TabCard } from '../TabCard';

/**
 * A saved tab has no live tab behind it.
 *
 * `newEmptyTab()` uses `chromeTabId: -1` for "not a live tab", and the card
 * guarded on the field being *set* rather than on it being a real id - so every
 * card in the saved-tabverse list offered "Close this tab", which called
 * `chrome.tabs.remove(-1)`. It could never work: the row belongs to a window
 * this browser does not own.
 *
 * The console's drawer draws the same card (adr/0019) for a tabverse stored on
 * somebody else's account, so this is the assertion that keeps a browser action
 * out of an operator's read-only view as well as out of the extension's.
 */
function cardFor(chromeTabId: number): string {
  return renderToStaticMarkup(
    <TabCard
      tab={{
        id: 't1',
        tabSpaceId: 'ts_1',
        title: 'a title',
        url: 'https://example.com',
        favIconUrl: '',
        pinned: false,
        suspended: false,
        createdAt: 1,
        updatedAt: 1,
        version: 0,
        chromeTabId,
        chromeWindowId: -1,
      }}
      onActivate={() => undefined}
    />,
  );
}

test('a saved tab offers no close button', () => {
  expect(cardFor(-1)).not.toContain('Close this tab');
  expect(cardFor(0)).not.toContain('Close this tab');
});

test('a live tab still offers one', () => {
  const html = cardFor(42);
  expect(html).toContain('Close this tab');
  expect(html).toContain('a title');
});
