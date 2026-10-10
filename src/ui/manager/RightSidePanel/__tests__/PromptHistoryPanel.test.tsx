/**
 * The AI-history view of the right panel (static markup).
 *
 * What this pins: the loading and empty states are honest one-liners (an empty
 * history is not an error), every exchange is drawn as what was asked and what
 * came back, a failed one says so instead of pretending, and the view is a
 * record with a way to clear it - not a chat, so there is no input.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import type { PromptLogEntry } from '../../../../ai/promptLog';
import { PromptHistoryList } from '../PromptHistoryPanel';

const entry = (over: Partial<PromptLogEntry> = {}): PromptLogEntry => ({
  at: Date.now() - 60_000,
  systemPrompt: 'You suggest short names…',
  input: 'React documentation — react.dev',
  output: 'Weeknight reading',
  error: null,
  durationMs: 812,
  ...over,
});

const render = (
  props: Partial<React.ComponentProps<typeof PromptHistoryList>> = {},
) =>
  renderToStaticMarkup(
    <PromptHistoryList entries={[]} onClear={() => undefined} {...props} />,
  );

describe('PromptHistoryList', () => {
  test('loading shows a spinner, and no empty-state copy', () => {
    const markup = render({ entries: null });
    expect(markup).toContain('bp6-spinner');
    expect(markup).not.toContain('Nothing has been asked');
  });

  test('an empty history is one line, and offers nothing to clear', () => {
    const markup = render({ entries: [] });
    expect(markup).toContain('Nothing has been asked of the on-device model');
    expect(markup).not.toContain('>Clear<');
  });

  test('an exchange is drawn as what was asked and what came back', () => {
    const markup = render({ entries: [entry()] });
    expect(markup).toContain('React documentation — react.dev');
    expect(markup).toContain('Weeknight reading');
    expect(markup).toContain('asked');
    expect(markup).toContain('answered');
    expect(markup).toContain('812 ms');
    expect(markup).toContain('Kept on this device');
    expect(markup).toContain('>Clear<');
  });

  test('a failed exchange says failed, with the reason and no answer', () => {
    const markup = render({
      entries: [entry({ output: null, error: 'model went away' })],
    });
    expect(markup).toContain('failed');
    expect(markup).toContain('model went away');
    expect(markup).not.toContain('answered');
  });

  test('the newest entry is drawn first', () => {
    const markup = render({
      entries: [
        entry({ input: 'the newer question', at: Date.now() }),
        entry({ input: 'the older question', at: Date.now() - 3_600_000 }),
      ],
    });
    expect(markup.indexOf('the newer question')).toBeLessThan(
      markup.indexOf('the older question'),
    );
  });

  test('there is no way to continue the conversation here', () => {
    const markup = render({ entries: [entry()] });
    // a record, not a chat: no text input and no send button
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<textarea');
  });
});
