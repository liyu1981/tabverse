/**
 * The merged settings dialog (static markup, AGENTS.md: no browser).
 *
 * Its content is checked through `SettingsBody`, because the `Dialog` around it
 * is a Blueprint `Portal` and a portal renders nothing under
 * `renderToStaticMarkup` - so the dialog wrapper's own test is that fact, and
 * everything about the sections is asserted where it can be seen.
 *
 * What this pins: the sections are the left column (Blueprint's vertical tabs),
 * the section the button asked for is the one selected, and a closed dialog
 * simply is not there.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { SettingsBody, SettingsDialog } from '../SettingsDialog';

const body = (tab: 'sync' | 'ai' | 'about') =>
  renderToStaticMarkup(
    <SettingsBody tab={tab} onSelectTab={() => undefined} />,
  );

describe('SettingsBody', () => {
  test('the sections are the left column: vertical tabs', () => {
    const markup = body('sync');
    expect(markup).toContain('bp6-tabs bp6-vertical');
    expect(markup).toContain('Sync');
    expect(markup).toContain('AI');
    expect(markup).toContain('About');
  });

  test('the AI section is the Prompt API page', () => {
    const markup = body('ai');
    // its three rows, before the availability probe has answered
    expect(markup).toContain('Device support');
    expect(markup).toContain('Local model');
    expect(markup).toContain('Offered');
  });

  test('Sync is the section showing when it is selected', () => {
    const markup = body('sync');
    // the sync panel's loading row (it reads its state in an effect, which a
    // static render does not run)
    expect(markup).toContain('bp6-spinner');
    expect(markup).not.toContain('Created in Sydney');
  });

  test('About is the section showing when it is selected', () => {
    const markup = body('about');
    expect(markup).toContain('Opinionated Way of Managing Tabs');
    expect(markup).toContain('Created in Sydney');
    expect(markup).not.toContain('bp6-spinner');
  });
});

describe('SettingsDialog', () => {
  test('a Dialog is a portal: static markup cannot show it', () => {
    // not a defect - it is why the sections are checked through SettingsBody
    expect(
      renderToStaticMarkup(
        <SettingsDialog isOpen={true} onClose={() => undefined} />,
      ),
    ).toBe('');
  });
});
