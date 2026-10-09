/**
 * The wand and its popover (plan doc/tabverse-gemma-nano-plan.md section 7,
 * "ui/manager/TabSpace/__tests__/SuggestNameButton.test.tsx").
 *
 * Rendered to static markup, the way ADR 0019 established - there is no
 * component-test setup in this repo (AGENTS.md: no browser). The rows this
 * pins: absent renders nothing (no dead button); ready renders the control;
 * each candidate is a button - click-to-apply, nothing pre-selected, no form
 * to auto-submit (D6); downloading shows the one line; and every other state
 * speaks in one line rather than an empty popover.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  resetAiAvailabilityForTest,
  setAiAvailabilityForTest,
} from '../../../../ai/availability';
import {
  SuggestNameButton,
  SuggestNamePopoverContent,
} from '../SuggestNameButton';

const ready = { state: 'ready' as const, progress: null };

const renderContent = (
  props: Partial<React.ComponentProps<typeof SuggestNamePopoverContent>> = {},
) =>
  renderToStaticMarkup(
    <SuggestNamePopoverContent
      availability={ready}
      busy={false}
      candidates={null}
      note={null}
      onApply={() => undefined}
      onDismiss={() => undefined}
      {...props}
    />,
  );

beforeEach(() => {
  resetAiAvailabilityForTest();
});

afterEach(() => {
  resetAiAvailabilityForTest();
});

describe('SuggestNameButton', () => {
  test('absent renders nothing - no dead button in the row', () => {
    setAiAvailabilityForTest({ state: 'absent', progress: null });
    const markup = renderToStaticMarkup(
      <SuggestNameButton tabs={[]} onApply={() => undefined} />,
    );
    expect(markup).toBe('');
  });

  test('checking renders nothing either - the probe has not answered yet', () => {
    const markup = renderToStaticMarkup(
      <SuggestNameButton tabs={[]} onApply={() => undefined} />,
    );
    expect(markup).toBe('');
  });

  test('ready renders the control with an accessible name', () => {
    setAiAvailabilityForTest(ready);
    const markup = renderToStaticMarkup(
      <SuggestNameButton
        tabs={[{ title: 'A', url: 'https://example.com' }]}
        onApply={() => undefined}
      />,
    );
    expect(markup).toContain('Suggest a name for this tabverse');
    // no candidate could be pre-applied: the control draws no names
    expect(markup).not.toContain('<form');
  });
});

describe('SuggestNamePopoverContent', () => {
  test('candidates are buttons: click-to-apply, none pre-selected', () => {
    const markup = renderContent({
      candidates: ['Weeknight dinners', 'Pasta queue', 'Recipe tab collection'],
    });
    expect(markup).toContain('Weeknight dinners');
    expect(markup).toContain('Pasta queue');
    expect(markup).toContain('Recipe tab collection');
    // three candidate buttons plus the dismiss button
    expect(markup.match(/<button/g)).toHaveLength(4);
    // no radio/checkbox could pre-select a name, no form could auto-submit
    expect(markup).not.toContain('type="radio"');
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain('checked');
    expect(markup).not.toContain('<form');
  });

  test('downloading shows the one line, with progress when known', () => {
    const markup = renderContent({
      availability: { state: 'downloading', progress: 0.42 },
      busy: true,
    });
    expect(markup).toContain('Downloading the on-device model');
    expect(markup).toContain('42%');
  });

  test('downloading without progress still says the one line', () => {
    const markup = renderContent({
      availability: { state: 'downloading', progress: null },
      busy: true,
    });
    expect(markup).toContain('Downloading the on-device model');
    expect(markup).not.toContain('%');
  });

  test('busy and ready says it is thinking', () => {
    expect(renderContent({ busy: true })).toContain('Suggesting names');
  });

  test('the note is the one line when there is nothing to click', () => {
    const markup = renderContent({
      note: 'This tabverse has no tabs to name yet.',
    });
    expect(markup).toContain('This tabverse has no tabs to name yet.');
    expect(markup).not.toContain('<button');
  });

  test('a downloadable model says what the first click will do', () => {
    const markup = renderContent({
      availability: { state: 'downloadable', progress: null },
    });
    expect(markup).toContain('downloads once');
  });

  test('an error state says so in one line, with a way out', () => {
    const markup = renderContent({
      availability: { state: 'error', progress: null },
    });
    expect(markup).toContain('try again');
  });

  test('idle says what the control is for', () => {
    expect(renderContent()).toContain('Pick a name');
  });
});
