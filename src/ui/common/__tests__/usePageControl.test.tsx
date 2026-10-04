import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { clampPage, usePageControl } from '../usePageControl';

/**
 * The page arithmetic, on its own.
 *
 * The bug this file exists for: the right arrow handed back the *last* page
 * where it meant to hand back the *next* one. A person on page 1 of 3 clicked
 * "next" and was shown "4/3", and only the left arrow could walk them back. It
 * was found by a person clicking the arrows, because nothing about the rendered
 * markup is wrong until the arrows are pressed - `renderToStaticMarkup` cannot
 * press anything, and this repo has no jsdom (AGENTS.md).
 *
 * So the step function is named, exported, and walked here instead: every page
 * of every list size, every click, checking the two things that were broken -
 * that the step is really one page, and that the page never says "4/3".
 */
const PAGE_LIMIT = 10;

function totalPages(totalCount: number, pageLimit = PAGE_LIMIT): number {
  return totalCount % pageLimit === 0
    ? Math.floor(totalCount / pageLimit)
    : Math.floor(totalCount / pageLimit) + 1;
}

/** One click on an arrow, which is what the hook does with the result. */
const step = (page: number, delta: number, totalPage: number) =>
  clampPage(page + delta, totalPage);

test('the page a person is shown is always a page that exists', () => {
  for (let items = 0; items <= 200; items++) {
    const totalPage = totalPages(items);
    let page = 0;
    for (let click = 0; click < 12; click++) {
      const label = `${page + 1}/${totalPage}`;
      // The reported bug, in general: the number before the slash was one past
      // the number after it.
      expect(page + 1).toBeLessThanOrEqual(Math.max(totalPage, 1));
      expect(label).toBe(`${page + 1}/${totalPage}`);

      page = step(page, 1, totalPage);
      expect(page + 1).toBeLessThanOrEqual(Math.max(totalPage, 1));

      // and back down again, all the way
      page = step(page, -1, totalPage);
      expect(page).toBeGreaterThanOrEqual(0);
    }
  }
});

test('next walks one page at a time and stops on the last', () => {
  const totalPage = 3;
  const seen: number[] = [];
  let page = 0;
  for (let i = 0; i < 6; i++) {
    page = step(page, 1, totalPage);
    seen.push(page + 1);
  }
  // 1 -> 2 -> 3, and then it stays. What it used to do: 1 -> 4 -> 3 -> 3.
  expect(seen).toEqual([2, 3, 3, 3, 3, 3]);
});

test('previous walks back one page at a time and stops on the first', () => {
  const totalPage = 3;
  let page = 2;
  const seen: number[] = [];
  for (let i = 0; i < 4; i++) {
    page = step(page, -1, totalPage);
    seen.push(page + 1);
  }
  expect(seen).toEqual([2, 1, 1, 1]);
});

test('one page of history is one page, and there is nothing to step to', () => {
  expect(totalPages(10)).toBe(1);
  expect(step(0, 1, 1)).toBe(0);
  expect(step(0, -1, 1)).toBe(0);
  // an empty list is zero pages and still clamps to page one, so the label can
  // never read 1/0
  expect(totalPages(0)).toBe(0);
  expect(clampPage(3, 0)).toBe(0);
});

test('a list that shrinks under the person cannot leave them past the end', () => {
  // The extension's History is live: delete or clear entries while reading page
  // three of three and the list is two pages long. Without clamping on the way
  // out, the panel would show an empty page labelled "3/2".
  const startedAt = 2;
  const nowTwoPages = totalPages(20);
  expect(startedAt + 1).toBeGreaterThan(nowTwoPages);
  expect(clampPage(startedAt, nowTwoPages)).toBe(1);
});

test('exactly divisible lists get no empty trailing page', () => {
  expect(totalPages(30)).toBe(3);
  expect(step(2, 1, totalPages(30))).toBe(2);
});

// What the markup can honestly say. The arrows cannot be pressed here - no jsdom
// (AGENTS.md) and no testing-library - so what is guaranteed is the arithmetic
// above plus the wiring being visible: both arrows exist, and the label is the
// clamped page. The handlers are one call into `clampPage` each, so this file
// plus that line is the whole of it.

function control(items: number) {
  function Probe({ count }: { count: number }) {
    const [, renderControl] = usePageControl(
      Array.from({ length: count }, (_, i) => i),
      PAGE_LIMIT,
    );
    return <>{renderControl()}</>;
  }
  return renderToStaticMarkup(<Probe count={items} />);
}

test('the control carries both arrows and the page it is on', () => {
  const html = control(25);
  expect(html).toContain('bp6-icon-chevron-left');
  expect(html).toContain('bp6-icon-chevron-right');
  expect(html).toContain('1/3');
});

test('one page of history draws no control to press', () => {
  expect(control(10)).not.toContain('chevron');
  expect(control(4)).not.toContain('chevron');
  expect(control(0)).not.toContain('chevron');
});
