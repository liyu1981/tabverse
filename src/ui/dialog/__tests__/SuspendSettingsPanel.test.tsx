/**
 * The tab suspension section of the settings dialog (static markup, AGENTS.md:
 * no browser).
 *
 * What this pins: the switch reflects the stored answer, `null` (not read yet)
 * is "Reading…" rather than "off", the threshold is shown in minutes, and the
 * plain-language sentence follows the switch.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { SuspendSettingsView, suspendSummary } from '../SuspendSettingsPanel';

const render = (
  over: Partial<React.ComponentProps<typeof SuspendSettingsView>> = {},
) =>
  renderToStaticMarkup(
    <SuspendSettingsView
      enabled={true}
      afterMinutes={30}
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

describe('suspension is on', () => {
  test('shows the switch, the window, and what it means', () => {
    const markup = render({ enabled: true, afterMinutes: 30 });
    const shown = text(markup);
    expect(shown).toContain('Suspend inactive tabs');
    expect(shown).toContain('Suspend after');
    expect(shown).toContain('30');
    expect(shown).toContain('minutes');
    expect(shown).toContain('Tabs left alone for more than 30 minutes');
    // a checked Blueprint switch carries the input's checked attribute
    expect(markup).toContain('checked');
  });

  test('a different window is echoed in the sentence', () => {
    const markup = render({ enabled: true, afterMinutes: 60 });
    expect(text(markup)).toContain('more than 60 minutes');
  });
});

describe('suspension is off', () => {
  test('says so and does not claim tabs are unloaded', () => {
    const markup = render({ enabled: false, afterMinutes: 30 });
    expect(text(markup)).toContain('Suspension is off');
    expect(text(markup)).not.toContain('are unloaded; opening one reloads it');
    // the number field is not offered while it does nothing
    expect(markup).toContain('disabled');
  });
});

describe('the setting has not been read yet', () => {
  test('null is "Reading…", not "off"', () => {
    const markup = render({ enabled: null, afterMinutes: null });
    expect(text(markup)).toContain('Reading…');
    expect(text(markup)).not.toContain('Suspension is off');
  });
});

describe('suspendSummary', () => {
  test('follows the three states', () => {
    expect(suspendSummary(null, null)).toBe('Reading…');
    expect(suspendSummary(false, 30)).toContain('off');
    expect(suspendSummary(true, 15)).toContain('15 minutes');
  });
});
