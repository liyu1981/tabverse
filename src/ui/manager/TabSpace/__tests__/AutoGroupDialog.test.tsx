/**
 * The auto-grouping body, checked by what it renders (AGENTS.md: no browser).
 *
 * Blueprint's `Dialog` renders through a portal, so only `AutoGroupBody` can be
 * seen under `renderToStaticMarkup` - which is exactly the part with the rows,
 * the edits and the apply label. The container's Chrome work is tested in
 * `data/tabSpace/__tests__/autoGroupChrome.test.ts` with a fake API.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  AutoGroupBody,
  type AutoGroupBodyProps,
  type AutoGroupRow,
  rowsFromSuggestions,
} from '../AutoGroupDialog';
import type { AutoGroupSuggestion } from '../../../../data/tabSpace/autoGroup';

function suggestion(
  overrides: Partial<AutoGroupSuggestion> = {},
): AutoGroupSuggestion {
  return {
    id: 'create:github.com',
    kind: 'create',
    key: 'github.com',
    title: 'Github',
    color: 'blue',
    tabs: [
      {
        tabId: 't1',
        chromeTabId: 101,
        title: 'one',
        url: 'https://github.com/1',
        favIconUrl: '',
      },
      {
        tabId: 't2',
        chromeTabId: 102,
        title: 'two',
        url: 'https://github.com/2',
        favIconUrl: '',
      },
    ],
    ...overrides,
  };
}

function bodyProps(
  overrides: Partial<AutoGroupBodyProps> = {},
): AutoGroupBodyProps {
  return {
    rows: rowsFromSuggestions([suggestion()]),
    skipped: { pinned: 0, notWebPage: 0, alreadyGrouped: 0, singletons: 0 },
    mode: 'site',
    aiEnabled: false,
    aiState: 'idle',
    aiDownloadProgress: null,
    onModeChange: () => undefined,
    onToggleRow: () => undefined,
    onTitleChange: () => undefined,
    onColorChange: () => undefined,
    onToggleTab: () => undefined,
    onApply: () => undefined,
    onClose: () => undefined,
    onRetryAi: () => undefined,
    ...overrides,
  };
}

const render = (props: AutoGroupBodyProps) =>
  renderToStaticMarkup(<AutoGroupBody {...props} />);

describe('AutoGroupBody', () => {
  test('draws a row per group, and the apply label counts the tabs', () => {
    const second: AutoGroupRow = {
      ...rowsFromSuggestions([
        suggestion({
          id: 'extend:g1',
          kind: 'extend',
          groupId: 'g1',
          key: 'figma.com',
          title: 'Work',
          color: 'purple',
          tabs: [
            {
              tabId: 't3',
              chromeTabId: 103,
              title: 'three',
              url: 'https://figma.com/3',
              favIconUrl: '',
            },
            {
              tabId: 't4',
              chromeTabId: 104,
              title: 'four',
              url: 'https://figma.com/4',
              favIconUrl: '',
            },
          ],
        }),
      ])[0],
    };
    const markup = render(
      bodyProps({ rows: [...rowsFromSuggestions([suggestion()]), second] }),
    );

    expect(markup).toContain('Github');
    expect(markup).toContain('Work');
    expect(markup).toContain('Adds to the existing group');
    expect(markup).toContain('2 of 2 tabs');
    expect(markup).toContain('Group 4 tabs into 2 groups');
    // every tab is on the card, not hidden behind a disclosure
    expect(markup).toContain('github.com/1');
    expect(markup).toContain('github.com/2');
    expect(markup).toContain('figma.com/3');
    expect(markup).not.toContain('Show the tabs');
  });

  test('nothing to group says so, and apply is disabled', () => {
    const markup = render(bodyProps({ rows: [] }));
    expect(markup).toContain('Nothing to group here');
    expect(markup).toContain('disabled');
    expect(markup).toContain('>Apply<');
  });

  test('the AI switch is only there when the device has the model on', () => {
    expect(render(bodyProps())).not.toContain('With AI');
    expect(render(bodyProps({ aiEnabled: true }))).toContain('With AI');
  });

  test('an AI failure says so and offers a retry, keeping the rows', () => {
    const markup = render(
      bodyProps({ aiEnabled: true, mode: 'ai', aiState: 'error' }),
    );
    expect(markup).toContain('The on-device model could not group these tabs');
    expect(markup).toContain('Try again');
    // the plan the person can still apply is the one on screen
    expect(markup).toContain('Github');
  });

  test('a group edited down to one tab warns, and is not counted in apply', () => {
    const rows = rowsFromSuggestions([suggestion()]).map((row) => ({
      ...row,
      chosenTabIds: [row.chosenTabIds[0]],
    }));
    const markup = render(bodyProps({ rows }));
    expect(markup).toContain('A group needs at least two tabs');
    expect(markup).toContain('1 of 2 tabs');
    expect(markup).toContain('>Apply<');
  });

  test('the left-out counts are summarised, and only when there are some', () => {
    const skipped = {
      pinned: 2,
      notWebPage: 1,
      alreadyGrouped: 3,
      singletons: 0,
    };
    const withSkipped = render(bodyProps({ skipped }));
    expect(withSkipped).toContain(
      'Left out: 2 pinned, 3 already in a group, 1 not a web page.',
    );
    expect(render(bodyProps())).not.toContain('Left out');
  });

  test('a downloading model shows its percentage', () => {
    const markup = render(
      bodyProps({ aiEnabled: true, mode: 'ai', aiDownloadProgress: 0.42 }),
    );
    expect(markup).toContain('Installing the model… 42%');
  });
});
