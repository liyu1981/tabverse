import { expect, test } from 'vitest';

import {
  collectTabverses,
  hitsForTabverse,
  matchCount,
  omniTabs,
  rankTabverses,
} from './omniSearchGrouping';
import type { SearchHit } from '../../../data/repo/types';

const hit = (over: Partial<SearchHit>): SearchHit => ({
  entity: 'note',
  id: 'n1',
  score: 1,
  ...over,
});

test('folds hits into tabverses and ranks each tab by its kind', () => {
  const tabverses = collectTabverses([
    hit({ entity: 'tabspace', id: 'ts1', title: 'One' }),
    hit({
      entity: 'note',
      id: 'n1',
      tabspace_id: 'ts1',
      tabspace_title: 'One',
    }),
    hit({
      entity: 'note',
      id: 'n2',
      tabspace_id: 'ts1',
      tabspace_title: 'One',
    }),
    hit({ entity: 'tab', id: 't1', tabspace_id: 'ts1', tabspace_title: 'One' }),
    hit({ entity: 'tab', id: 't2', tabspace_id: 'ts2', tabspace_title: 'Two' }),
    hit({ entity: 'tab', id: 't3', tabspace_id: 'ts2', tabspace_title: 'Two' }),
  ]);
  const byId = new Map(tabverses.map((tabverse) => [tabverse.id, tabverse]));

  expect(byId.get('ts1')?.total).toBe(4);
  expect(byId.get('ts1')?.byKind).toMatchObject({
    tabspace: 1,
    note: 2,
    tab: 1,
  });
  expect(byId.get('ts1')?.title).toBe('One');

  const tabs = omniTabs(tabverses);
  expect(tabs[0]).toEqual({ key: 'overview', label: 'Overview', count: 6 });
  expect(tabs.find((tab) => tab.key === 'note')).toMatchObject({ count: 2 });
  expect(tabs.find((tab) => tab.key === 'tab')).toMatchObject({ count: 3 });

  // Tabs tab: ts2 matched two tabs, ts1 one.
  expect(
    rankTabverses(tabverses, 'tab').map((tabverse) => tabverse.id),
  ).toEqual(['ts2', 'ts1']);
  // Overview: ts1 matched four records, ts2 two.
  expect(
    rankTabverses(tabverses, 'overview').map((tabverse) => tabverse.id),
  ).toEqual(['ts1', 'ts2']);

  expect(matchCount(byId.get('ts1')!, 'overview')).toBe(4);
  expect(matchCount(byId.get('ts1')!, 'note')).toBe(2);

  expect(
    hitsForTabverse(byId.get('ts1')!, 'note').map((entry) => entry.id),
  ).toEqual(['n1', 'n2']);
  expect(hitsForTabverse(byId.get('ts1')!, 'overview')).toHaveLength(4);
});

test('a tabverse that only matches by name ranks in overview, not in a kind tab', () => {
  const tabverses = collectTabverses([
    hit({ entity: 'tabspace', id: 'ts9', title: 'Nine' }),
  ]);
  expect(rankTabverses(tabverses, 'tab')).toHaveLength(0);
  expect(
    rankTabverses(tabverses, 'overview').map((tabverse) => tabverse.id),
  ).toEqual(['ts9']);
});
