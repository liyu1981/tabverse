/**
 * The summarize-tab control (static markup, AGENTS.md: no browser).
 *
 * Two things are pinned: the presentational view draws a button and shows the
 * busy state, and the container disappears entirely when the browser has no
 * built-in AI, the probe has not answered, or the person switched AI off -
 * rather than leaving a button that does nothing.
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
  SummarizeTabButton,
  SummarizeTabButtonView,
} from '../SummarizeTabButton';

const liveTab = {
  id: 't1',
  chromeTabId: 7,
  title: 'A page about tabs',
  tabSpaceId: 'ts1',
} as Tab;

const ARIA = 'Summarize this tab into a new note';

beforeEach(() => {
  setAiAvailabilityForTest({ state: 'ready', progress: null });
  setAiEnabledForTest(true);
});

afterEach(() => {
  resetAiAvailabilityForTest();
  setAiEnabledForTest(null);
});

describe('SummarizeTabButtonView', () => {
  test('renders the button', () => {
    const markup = renderToStaticMarkup(
      <SummarizeTabButtonView
        busy={false}
        status="Summarize this tab"
        onSummarize={() => undefined}
      />,
    );
    expect(markup).toContain(ARIA);
  });

  test('a run in flight shows the loading state', () => {
    const markup = renderToStaticMarkup(
      <SummarizeTabButtonView
        busy={true}
        status="Summarizing…"
        onSummarize={() => undefined}
      />,
    );
    expect(markup).toContain('bp6-loading');
  });

  test('a disabled button says so', () => {
    const markup = renderToStaticMarkup(
      <SummarizeTabButtonView
        busy={false}
        disabled={true}
        status="This tab is suspended"
        onSummarize={() => undefined}
      />,
    );
    expect(markup).toContain('disabled');
  });
});

describe('SummarizeTabButton', () => {
  test('offers the action when the model is ready and AI is on', () => {
    const markup = renderToStaticMarkup(
      <SummarizeTabButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toContain(ARIA);
  });

  test('is hidden when the person switched AI off', () => {
    setAiEnabledForTest(false);
    const markup = renderToStaticMarkup(
      <SummarizeTabButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toBe('');
  });

  test('is hidden before the setting has been read', () => {
    setAiEnabledForTest(null);
    const markup = renderToStaticMarkup(
      <SummarizeTabButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toBe('');
  });

  test('is hidden when the browser has no built-in AI', () => {
    setAiAvailabilityForTest({ state: 'absent', progress: null });
    const markup = renderToStaticMarkup(
      <SummarizeTabButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toBe('');
  });

  test('is hidden while the probe is still checking', () => {
    setAiAvailabilityForTest({ state: 'checking', progress: null });
    const markup = renderToStaticMarkup(
      <SummarizeTabButton tab={liveTab} tabSpaceId="ts1" />,
    );
    expect(markup).toBe('');
  });

  test('is disabled while the tab is suspended', () => {
    const markup = renderToStaticMarkup(
      <SummarizeTabButton
        tab={{ ...liveTab, suspended: true } as Tab}
        tabSpaceId="ts1"
      />,
    );
    expect(markup).toContain('disabled');
  });
});
