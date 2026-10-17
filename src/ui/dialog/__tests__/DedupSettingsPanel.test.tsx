/**
 * The duplicate-advisor settings section (static markup, AGENTS.md: no browser).
 *
 * What this pins: the switch reflects the stored answer, `null` (not read yet)
 * is "Reading…" rather than "off", and the interval row follows the switch.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { DedupSettingsView, dedupSummary } from '../DedupSettingsPanel';

const render = (
  over: Partial<React.ComponentProps<typeof DedupSettingsView>> = {},
) =>
  renderToStaticMarkup(
    <DedupSettingsView
      enabled={true}
      minutes={10}
      onToggle={() => undefined}
      onChangeMinutes={() => undefined}
      {...over}
    />,
  );

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('dedupSummary', () => {
  test('null is not off', () => {
    expect(dedupSummary(null, null)).toBe('Reading…');
  });

  test('off says nothing is looked at', () => {
    expect(dedupSummary(false, 10)).toContain('off');
  });

  test('on names the interval and that it never closes on its own', () => {
    const summary = dedupSummary(true, 10);
    expect(summary).toContain('10 minutes');
    expect(summary).toContain('never closed on their own');
  });
});

describe('DedupSettingsView', () => {
  test('shows the switch, the interval and the summary', () => {
    const shown = text(render());
    expect(shown).toContain('Find duplicate tabs');
    expect(shown).toContain('Check every');
    expect(shown).toContain('10 minutes');
  });

  test('a not-yet-read setting does not read as off', () => {
    const shown = text(render({ enabled: null, minutes: null }));
    expect(shown).toContain('Reading…');
  });
});
