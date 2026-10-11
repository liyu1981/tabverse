/**
 * The AI section of the settings dialog (static markup, AGENTS.md: no browser).
 *
 * What this pins are the three answers it exists to give, each in its own
 * state: can this device use it (absent is the browser's answer, not an error),
 * is it switched on (the person's answer), and is the local model installed
 * (the one thing that downloads). The download button is offered only when
 * there is something to download, and the switch is not offered at all when the
 * browser has no model to switch on.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import type { AiAvailabilityState } from '../../../ai/availability';
import { AiSettingsView } from '../AiSettingsPanel';

const render = (
  over: Partial<React.ComponentProps<typeof AiSettingsView>> = {},
) =>
  renderToStaticMarkup(
    <AiSettingsView
      state="ready"
      progress={null}
      enabled={true}
      busy={false}
      onToggle={() => undefined}
      onDownload={() => undefined}
      onCheck={() => undefined}
      {...over}
    />,
  );

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the model is ready', () => {
  test('says so, and offers nothing to download', () => {
    const markup = render({ state: 'ready' });
    expect(text(markup)).toContain('Available on this device');
    expect(text(markup)).toContain('Installed and ready');
    expect(markup).not.toContain('Download the model now');
  });

  test('the switch is on, and offered', () => {
    const markup = render({ state: 'ready', enabled: true });
    expect(text(markup)).toContain('Name suggestions are offered');
    expect(markup).toContain('Use the on-device model');
    // a checked Blueprint switch carries the input's checked attribute
    expect(markup).toContain('checked');
  });
});

describe('the model is not installed yet', () => {
  test('says so and offers the download', () => {
    const markup = render({ state: 'downloadable' });
    expect(text(markup)).toContain('Not installed yet');
    expect(markup).toContain('Download the model now');
  });

  test('installing reports the progress the monitor gives', () => {
    const markup = render({
      state: 'downloading',
      progress: 0.42,
      busy: true,
    });
    expect(text(markup)).toContain('Installing… 42%');
    // and not a second button to press while it runs
    expect(markup).not.toContain('Download the model now');
  });

  test('installing without a known percentage still says what is happening', () => {
    const markup = render({ state: 'downloading', progress: null });
    expect(text(markup)).toContain('Installing…');
    expect(text(markup)).not.toContain('%');
  });
});

describe('the browser has no such model', () => {
  test('says not available, and does not report it as an error', () => {
    const markup = render({ state: 'absent' });
    expect(text(markup)).toContain('Not available in this browser');
    expect(text(markup)).not.toContain('Could not check');
    // nothing to download and nothing to check
    expect(markup).not.toContain('Download the model now');
    expect(markup).not.toContain('Check again');
  });

  test('the switch is not offered when there is nothing to switch on', () => {
    const markup = render({ state: 'absent', enabled: null });
    expect(markup).toContain('disabled');
  });
});

describe('the check itself failed', () => {
  test('says so and offers to ask again', () => {
    const markup = render({ state: 'error' });
    expect(text(markup)).toContain('Could not check');
    expect(markup).toContain('Check again');
  });
});

describe('the switch state', () => {
  test('null is "reading", not "off"', () => {
    const markup = render({ enabled: null });
    expect(text(markup)).toContain('Reading…');
    // the value cell itself, not the "Offered" label beside it
    expect(markup).not.toContain('>Off<');
  });

  test('off says off', () => {
    const markup = render({ enabled: false });
    expect(markup).toContain('>Off<');
  });
});

describe('every state renders the same three questions', () => {
  const states: AiAvailabilityState[] = [
    'checking',
    'absent',
    'downloadable',
    'downloading',
    'ready',
    'error',
  ];

  test('device support, local model, and whether it is offered', () => {
    for (const state of states) {
      const markup = render({ state });
      const shown = text(markup);
      expect(shown).toContain('Device support');
      expect(shown).toContain('Local model');
      expect(shown).toContain('Offered');
    }
  });
});
