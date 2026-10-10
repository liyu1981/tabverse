/**
 * One row of the extension popup (static markup, AGENTS.md: no browser).
 *
 * What this pins is the primary action, which is the part of the popup that is
 * a decision rather than a label: a tabverse that is already open somewhere is
 * *gone to*, and one that is not is **added to this window** - it used to open
 * a new window, which made the row's most obvious click the one action nobody
 * asked for. "Open In A New Window" is still there as a button of its own.
 */
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { SavedTabSpaceRow } from '../SavedTabSpaceRow';
import { newEmptyTabSpace } from '../../../data/tabSpace/TabSpace';

const tabSpace = () => ({
  ...newEmptyTabSpace(),
  name: 'Recipes',
  updatedAt: Date.now(),
});

const render = (
  over: Partial<React.ComponentProps<typeof SavedTabSpaceRow>> = {},
) =>
  renderToStaticMarkup(
    <SavedTabSpaceRow
      tabSpace={tabSpace()}
      openWindowCount={0}
      isCurrentWindow={false}
      openInNewWindow={() => undefined}
      openInThisWindow={() => undefined}
      switchToOpen={() => undefined}
      {...over}
    />,
  );

test('a tabverse that is not open anywhere is added to this window', () => {
  const markup = render();
  expect(markup).toContain('title="Add to this window"');
  // leaving a new window as the explicit button, not the default
  expect(markup).toContain('Open In A New Window');
  // the old third button is gone: it did the same as the row's own click
  expect(markup).not.toContain('Open In This Window');
});

test('a tabverse open in another window is gone to, not copied', () => {
  const markup = render({ openWindowCount: 1 });
  expect(markup).toContain('title="Go to this tabverse"');
  expect(markup).toContain('open in 1 window');
  expect(markup).toContain('Go to the window of this tabverse');
});

test('the tabverse of this window says so, and is not sent anywhere', () => {
  const markup = render({ openWindowCount: 1, isCurrentWindow: true });
  expect(markup).toContain('this window');
  expect(markup).not.toContain('open in 1 window');
});
