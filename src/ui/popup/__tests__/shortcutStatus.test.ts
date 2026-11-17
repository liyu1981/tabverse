import { expect, test } from 'vitest';

import { shortcutStatusText } from '../PopupView';

test('a created shortcut says what was added', () => {
  expect(
    shortcutStatusText({ ok: true, status: 'created', name: 'Figma' }),
  ).toBe('Added Figma to Launchpad');
});

test('an already-saved page says so', () => {
  expect(
    shortcutStatusText({ ok: true, status: 'existing', name: 'Figma' }),
  ).toBe('Figma is already in Launchpad');
});

test('anything else is a failure, never a success', () => {
  expect(shortcutStatusText({ ok: false })).toBe(
    'Could not add this tab to Launchpad',
  );
  expect(shortcutStatusText(undefined)).toBe(
    'Could not add this tab to Launchpad',
  );
  expect(
    shortcutStatusText({ ok: true, status: 'unreadable', name: 'x' }),
  ).toBe('Could not add this tab to Launchpad');
});
