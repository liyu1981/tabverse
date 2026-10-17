/**
 * The duplicate notice, checked by what it renders (static markup, ADR 0018:
 * no browser).
 *
 * What this pins: the collapsed summary and its two actions, a protected group
 * with no action, the expanded detail (the URL and what will close), and the
 * undo line after an apply.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import type {
  DedupReport,
  DuplicateGroup,
} from '../../../../data/tabSpace/dedup';
import {
  DedupAdvisorNoticeShell,
  DedupUndoNotice,
} from '../DedupAdvisorNotice';

function group(over: Partial<DuplicateGroup> = {}): DuplicateGroup {
  return {
    key: 'https://example.com/a',
    url: 'https://example.com/a',
    windowId: 10,
    keeper: {
      chromeTabId: 1,
      title: 'Example',
      url: 'https://example.com/a',
      pinned: false,
      active: true,
      audible: false,
    },
    closers: [
      {
        chromeTabId: 2,
        title: 'Example',
        url: 'https://example.com/a',
        pinned: false,
        active: false,
        audible: false,
      },
    ],
    ...over,
  };
}

function report(over: Partial<DedupReport> = {}): DedupReport {
  return {
    scannedAt: 1,
    windows: 1,
    tabs: 3,
    groups: [group()],
    fingerprint: 'fp',
    ...over,
  };
}

const render = (
  over: Partial<React.ComponentProps<typeof DedupAdvisorNoticeShell>> = {},
) =>
  renderToStaticMarkup(
    <DedupAdvisorNoticeShell
      report={report()}
      onApply={() => undefined}
      onIgnore={() => undefined}
      onAlwaysIgnore={() => undefined}
      {...over}
    />,
  );

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('DedupAdvisorNoticeShell', () => {
  test('collapsed, it counts the duplicates and offers the two actions', () => {
    const shown = text(render());
    expect(shown).toContain('1 duplicate tab found');
    expect(shown).toContain('Remove duplicates');
    expect(shown).toContain('Review');
    expect(shown).toContain('Ignore');
  });

  test('a protected group has no blind remove button', () => {
    const shown = text(
      render({
        report: report({
          groups: [
            group({
              closers: [],
              protectedReason: 'all other copies are pinned',
            }),
          ],
        }),
      }),
    );
    expect(shown).toContain('Duplicate tabs found');
    expect(shown).not.toContain('Remove duplicates');
  });

  test('expanded, it names the URL and what will close', () => {
    const shown = text(render({ defaultExpanded: true }));
    expect(shown).toContain('example.com/a');
    expect(shown).toContain('closing');
    expect(shown).toContain('Always ignore');
  });

  test('expanded, a protected group explains itself', () => {
    const shown = text(
      render({
        defaultExpanded: true,
        report: report({
          groups: [
            group({
              closers: [],
              protectedReason: 'all other copies are pinned',
            }),
          ],
        }),
      }),
    );
    expect(shown).toContain('all other copies are pinned');
  });
});

describe('DedupUndoNotice', () => {
  test('offers undo and dismiss', () => {
    const shown = text(
      renderToStaticMarkup(
        <DedupUndoNotice
          onUndo={() => undefined}
          onDismiss={() => undefined}
        />,
      ),
    );
    expect(shown).toContain('Duplicate tabs removed');
    expect(shown).toContain('Undo');
    expect(shown).toContain('Dismiss');
  });
});
