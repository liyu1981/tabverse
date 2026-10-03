/**
 * What a group containing a split view draws.
 *
 * Reported as: a group "github" with tab1 and tab2, then a split of tab1 with a
 * new tab3 - and the tabverse kept showing `github: tab1, tab2`, with neither
 * tab3 nor the split. `tabverseEntries` takes a group's tabs and stops, so the
 * pairing has to be drawn inside the block, which is what GroupTabs does.
 *
 * Rendered to static markup, the way ADR 0019 established for the console's
 * views - there is no component-test setup in this repo (AGENTS.md).
 */

import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { GroupTabs, TabGroupBlock } from '../TabGroupBlock';
import { Tab, newEmptyTab, setTitle } from '../../../../data/tabSpace/Tab';
import { TabGroupHint } from '../../../../data/tabSpace/TabSpace';

function tab(title: string, splitViewId?: number): Tab {
  return { ...setTitle(title, newEmptyTab()), splitViewId };
}

const group: TabGroupHint = {
  id: 'g-github',
  title: 'github',
  color: 'blue',
  tabIds: [],
};

const card = (t: Tab) => (
  <div key={t.id} className="card">
    {t.title}
  </div>
);

function draw(tabs: Tab[], withGroup = true): string {
  const inner = <GroupTabs tabs={tabs} card={card} />;
  const markup = withGroup ? (
    <TabGroupBlock group={group} tabCount={tabs.length}>
      {inner}
    </TabGroupBlock>
  ) : (
    <>{inner}</>
  );
  return renderToStaticMarkup(markup);
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test('a split inside a group is drawn as a split block, not two cards', () => {
  // the reported case: the group holds tab1, tab3 and tab2, and tab1 is split
  // with tab3
  const markup = draw([tab('tab1', 7), tab('tab3', 7), tab('tab2')]);

  expect(markup).toContain('split view'); // the block's own label
  expect(text(markup)).toContain('github');
  const said = text(markup);
  expect(said).toContain('tab1');
  expect(said).toContain('tab3');
  expect(said).toContain('tab2');
  // and the two halves are in the block, in order, with tab2 outside it
  expect(markup.indexOf('tab1')).toBeLessThan(markup.indexOf('tab3'));
  expect(markup.indexOf('split view')).toBeLessThan(markup.indexOf('tab2'));
});

test('a group with no split reads as the plain list it was', () => {
  const markup = draw([tab('tab1'), tab('tab2')]);
  expect(markup).not.toContain('split view');
  expect(text(markup)).toContain('github');
  expect(text(markup)).toContain('tab1 tab2');
});

test('a pair whose partner is outside the group is a plain card in here', () => {
  // the pair spans the boundary; from inside the group it can only be what it
  // can show - one card, not a block with a half that is not here
  const markup = draw([tab('tab1', 9), tab('tab2')]);
  expect(markup).not.toContain('split view');
});

test('every card keeps its own key, so React does not warn', () => {
  // the cards are provided by the host and carry their keys; the block must
  // not wrap them in a way that drops one
  const markup = draw([tab('tab1', 7), tab('tab3', 7)], false);
  expect(markup.match(/class="card"/g)?.length).toEqual(2);
});
