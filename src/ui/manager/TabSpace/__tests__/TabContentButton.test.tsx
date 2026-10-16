/**
 * The page-action control on a live tab (static markup, AGENTS.md: no browser).
 *
 * Two things are pinned. The menu names its four outcomes and disables the two
 * that need the model when the model is not there - while "copy as Markdown"
 * stays usable, which is why the button is no longer hidden when AI is off. And
 * the container draws the button for a live tab, disables it while the tab is
 * suspended, and still draws it (with the AI items disabled) when the browser
 * has no built-in AI or the person switched it off.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  resetAiAvailabilityForTest,
  setAiAvailabilityForTest,
} from '../../../../ai/availability';
import { setAiEnabledForTest } from '../../../../ai/aiSettings';
import type { Tab } from '../../../../data/tabSpace/Tab';
import {
  TabContentButton,
  TabContentButtonView,
  TabContentMenu,
} from '../TabContentButton';

const liveTab = {
  id: 't1',
  chromeTabId: 7,
  title: 'A page about tabs',
  tabSpaceId: 'ts1',
} as Tab;

const ARIA = 'Page actions for this tab';

beforeEach(() => {
  setAiAvailabilityForTest({ state: 'ready', progress: null });
  setAiEnabledForTest(true);
});

afterEach(() => {
  resetAiAvailabilityForTest();
  setAiEnabledForTest(null);
});

describe('TabContentMenu', () => {
  test('names the four outcomes', () => {
    const markup = renderToStaticMarkup(
      <TabContentMenu
        canAppend={true}
        aiDisabled={false}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain('View page content as Markdown');
    expect(markup).toContain('Send page content to AI chat');
    expect(markup).toContain('New note with AI summary');
    expect(markup).toContain('Append to current note with AI summary');
  });

  test('append is disabled when no note is open', () => {
    const markup = renderToStaticMarkup(
      <TabContentMenu
        canAppend={false}
        aiDisabled={false}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain('bp6-disabled');
  });

  test('the AI items are disabled without a model, the copy one is not', () => {
    const markup = renderToStaticMarkup(
      <TabContentMenu
        canAppend={true}
        aiDisabled={true}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain('View page content as Markdown');
    expect(markup).toContain('bp6-disabled');
  });
});

describe('TabContentButtonView', () => {
  test('renders the button', () => {
    const markup = renderToStaticMarkup(
      <TabContentButtonView
        busy={false}
        status="Page actions"
        canAppend={false}
        aiDisabled={false}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain(ARIA);
  });

  test('a run in flight shows the loading state', () => {
    const markup = renderToStaticMarkup(
      <TabContentButtonView
        busy={true}
        status="Converting…"
        canAppend={false}
        aiDisabled={false}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain('bp6-loading');
  });

  test('a disabled button says so', () => {
    const markup = renderToStaticMarkup(
      <TabContentButtonView
        busy={false}
        disabled={true}
        status="This tab is suspended"
        canAppend={false}
        aiDisabled={false}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain('disabled');
  });
});

describe('TabContentButton', () => {
  test('offers the actions on a live tab', () => {
    const markup = renderToStaticMarkup(
      <TabContentButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toContain(ARIA);
  });

  test('is still drawn when the person switched AI off', () => {
    setAiEnabledForTest(false);
    const markup = renderToStaticMarkup(
      <TabContentButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toContain(ARIA);
  });

  test('is still drawn when the browser has no built-in AI', () => {
    setAiAvailabilityForTest({ state: 'absent', progress: null });
    const markup = renderToStaticMarkup(
      <TabContentButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toContain(ARIA);
  });

  test('is disabled while the tab is suspended', () => {
    const markup = renderToStaticMarkup(
      <TabContentButton
        tab={{ ...liveTab, suspended: true } as Tab}
        tabSpaceId="ts1"
      />,
    );
    expect(markup).toContain('disabled');
  });
});
