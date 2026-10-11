/**
 * The list filter box (static markup, AGENTS.md: no browser).
 *
 * What this pins: the field carries the caller's placeholder and label, the
 * count says the total when nothing is filtered and "matches of total" when
 * something is, and the clear button is always present so the count does not
 * jump when the box fills.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { ListFilter } from '../ListFilter';

const render = (over: Partial<React.ComponentProps<typeof ListFilter>> = {}) =>
  renderToStaticMarkup(
    <ListFilter
      value=""
      onChange={() => undefined}
      count={3}
      total={10}
      ariaLabel="Filter these todos"
      {...over}
    />,
  );

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('ListFilter', () => {
  test('the field carries the label and placeholder', () => {
    const markup = render({ placeholder: 'filter these todos…' });
    expect(markup).toContain('aria-label="Filter these todos"');
    expect(markup).toContain('filter these todos…');
  });

  test('empty shows the total', () => {
    expect(text(render({ value: '', total: 10 }))).toContain('10');
    expect(text(render({ value: '', total: 10 }))).not.toContain('of');
  });

  test('filtering shows matches of total', () => {
    const shown = text(render({ value: 'milk', count: 3, total: 10 }));
    expect(shown).toContain('3 of 10');
  });

  test('the clear button is always there', () => {
    expect(render({ value: '' })).toContain('aria-label="Clear the filter"');
    expect(render({ value: 'milk' })).toContain(
      'aria-label="Clear the filter"',
    );
  });
});
