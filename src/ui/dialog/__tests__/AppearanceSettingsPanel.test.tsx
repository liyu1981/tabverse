/**
 * The sidebar colour section of the settings dialog (static markup, AGENTS.md:
 * no browser).
 *
 * What this pins: every palette colour is offered as a swatch, the current
 * tabverse's colour is the one pressed, and the switch's sentence follows the
 * three states of the preference (including "not read yet").
 */
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { SIDEBAR_COLORS } from '../../../data/tabSpace/sidebarColor';
import {
  AppearanceSettingsView,
  randomColorSummary,
} from '../AppearanceSettingsPanel';

const render = (
  over: Partial<React.ComponentProps<typeof AppearanceSettingsView>> = {},
) =>
  renderToStaticMarkup(
    <AppearanceSettingsView
      color="#54617a"
      randomOnCreate={false}
      onPickColor={() => undefined}
      onToggleRandom={() => undefined}
      {...over}
    />,
  );

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test('every palette colour is a swatch, named for its colour', () => {
  const markup = render();
  for (const color of SIDEBAR_COLORS) {
    expect(markup).toContain(`background-color:${color.hex}`);
    expect(markup).toContain(color.name);
  }
});

test('the chosen colour is the one pressed', () => {
  const markup = render({ color: '#472a55' });
  expect((markup.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  expect(markup).toContain('aria-label="Plum"');
});

test('says the colour belongs to the tabverse', () => {
  expect(text(render())).toContain('belongs to the tabverse in this window');
});

test('the switch and its sentence follow the preference', () => {
  expect(render({ randomOnCreate: true })).toContain('checked');
  expect(text(render({ randomOnCreate: true }))).toContain('rolls a colour');
  expect(text(render({ randomOnCreate: false }))).toContain('default colour');
  expect(text(render({ randomOnCreate: null }))).toContain('Reading…');
});

test('randomColorSummary follows the three states', () => {
  expect(randomColorSummary(null)).toBe('Reading…');
  expect(randomColorSummary(true)).toContain('rolls');
  expect(randomColorSummary(false)).toContain('default');
});
