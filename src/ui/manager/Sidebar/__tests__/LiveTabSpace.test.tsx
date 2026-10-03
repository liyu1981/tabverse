import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { LiveTabSpace } from '../LiveTabSpace';
import { $tabSpace, tabSpaceStoreApi } from '../../../../data/tabSpace/store';

/**
 * What the current tabverse's own entry says.
 *
 * The entry's label ("Current Tabverse") is the sidebar's, not this component's
 * - see Sidebar.tsx - so what is asserted here is the name under it, and that
 * the old "In This Window" heading is not back. The other tabverses have their
 * own suite (OtherTabSpaces.test.tsx).
 */

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function render(): string {
  return renderToStaticMarkup(<LiveTabSpace active={true} />);
}

function named(name: string, id = 'ts-self') {
  tabSpaceStoreApi.reset({ chromeTabId: 1, chromeWindowId: 1 });
  tabSpaceStoreApi.updateTabSpace({ id, name });
}

test('the entry shows the tabverse name, once', () => {
  named('Recipes for the week');
  const said = text(render());
  expect(said).toEqual('Recipes for the week');
  // the entry's label already says which tabverse this is
  expect(said).not.toContain('Current Tabverse');
  expect(said).not.toContain('In This Window');
});

test('the whole name is available for a hover, because the row truncates it', () => {
  const long = 'A tabverse name far longer than any sidebar row could ever be';
  named(long);
  const markup = render();
  expect(markup).toContain(`title="${long}"`);
});

test('before the name is written, the id is shown rather than an empty row', () => {
  named('', 'ts-just-minted');
  expect(text(render())).toEqual('ts-just-minted');
});

test('the store is where the name comes from, not the url', () => {
  named('Named here');
  expect($tabSpace.getState().name).toEqual('Named here');
  expect(text(render())).toEqual('Named here');
});
