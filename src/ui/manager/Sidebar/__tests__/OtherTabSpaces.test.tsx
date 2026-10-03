/**
 * The sidebar's other-windows section, in both of its shapes.
 *
 * The expanded sidebar and the collapsed rail are two renderings of one list, so
 * both are asserted here: an expanded one is a heading plus a row per window,
 * and a collapsed one is an icon per window whose tooltip is that name. What
 * matters is that a row says which tabverse it is - the rail has nowhere else to
 * put it - and that nothing is rendered for a profile with one window.
 */

import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { OtherTabSpaces, labelOfOtherTabSpace } from '../OtherTabSpaces';
import { openWindowStoreApi } from '../../../../data/tabSpace/openWindowStore';
import { SidebarContext } from '../../../common/SidebarContainer';

const openIn = (windowId: number, tabSpaceId: string) => ({
  tabSpaceId,
  chromeTabId: windowId * 10,
  chromeWindowId: windowId,
});

function setOpen(ids: [number, string][], names: [string, string, number][]) {
  openWindowStoreApi.setOpenTabSpaces(ids.map(([w, t]) => openIn(w, t)));
  openWindowStoreApi.setOtherWindowNames(
    new Map(names.map(([id, name, tabCount]) => [id, { name, tabCount }])),
  );
}

function render(collapsed: boolean): string {
  return renderToStaticMarkup(
    <SidebarContext.Provider
      value={{
        collapsed,
        toggleCollapsed: () => undefined,
        expandSidebar: () => undefined,
      }}
    >
      <OtherTabSpaces />
    </SidebarContext.Provider>,
  );
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test('expanded: a heading, then one row per other window, each with its name', () => {
  setOpen(
    [
      [2, 'ts-b'],
      [3, 'ts-c'],
    ],
    [
      ['ts-b', 'Recipes for the week', 12],
      ['ts-c', 'Java concurrency notes', 3],
    ],
  );

  const markup = render(false);
  const said = text(markup);
  expect(said).toContain('Other Tabverses');
  expect(said).toContain('Recipes for the week');
  expect(said).toContain('Java concurrency notes');
  // the full name is on the row, for a hover and for a screen reader
  expect(markup).toContain('title="Recipes for the week"');
  // the derived-tab icon, which is what distinguishes these from the current one
  expect(markup).toContain('th-derived');
});

test('collapsed: no heading, and the name is the tooltip', () => {
  setOpen(
    [
      [2, 'ts-b'],
      [3, 'ts-c'],
    ],
    [
      ['ts-b', 'Recipes for the week', 12],
      ['ts-c', 'Java concurrency notes', 3],
    ],
  );

  const markup = render(true);
  expect(text(markup)).not.toContain('Other Tabverses');
  // the rail is icons only, so the name has to be the accessible name
  expect(markup).toContain('aria-label="Recipes for the week"');
  expect(markup).toContain('aria-label="Java concurrency notes"');
  expect(markup).toContain('th-derived');
});

test('one window, no section: a heading over nothing is worse than nothing', () => {
  setOpen([], []);
  expect(render(false)).toEqual('');
  expect(render(true)).toEqual('');
});

test('a tabverse with no saved row yet is listed by its id, not dropped', () => {
  // the window is real even when its row is not in IndexedDB yet; the id is a
  // poor label but it is a true one, and the row must not disappear
  setOpen([[2, 'ts-brand-new']], []);

  expect(
    labelOfOtherTabSpace({
      ...openIn(2, 'ts-brand-new'),
      name: '',
      tabCount: 0,
    }),
  ).toEqual('ts-brand-new');
  expect(text(render(false))).toContain('ts-brand-new');
  expect(render(true)).toContain('aria-label="ts-brand-new"');
});

test('a name is preferred over an id when there is one', () => {
  expect(
    labelOfOtherTabSpace({
      ...openIn(2, 'ts-b'),
      name: 'Recipes for the week',
      tabCount: 12,
    }),
  ).toEqual('Recipes for the week');
});
