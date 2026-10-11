import { expect, test } from 'vitest';

import { groupHits } from './SearchPanel';
import type { AdminSearchHit } from '../data/types';

const hit = (over: Partial<AdminSearchHit>): AdminSearchHit => ({
  entity: 'note',
  id: 'n1',
  score: 1,
  ...over,
});

test('groups hits by entity, then by tabverse, in a stable order', () => {
  const groups = groupHits([
    hit({
      entity: 'todo',
      id: 'td1',
      tabspace_id: 'ts1',
      tabspace_title: 'One',
    }),
    hit({
      entity: 'note',
      id: 'n1',
      tabspace_id: 'ts1',
      tabspace_title: 'One',
    }),
    hit({
      entity: 'note',
      id: 'n2',
      tabspace_id: 'ts2',
      tabspace_title: 'Two',
    }),
    hit({ entity: 'tabspace', id: 'ts1', title: 'One' }),
    hit({
      entity: 'closedtab',
      id: 'c1',
      tabspace_id: 'ts1',
      tabspace_title: 'One',
    }),
  ]);

  // A fixed order: Tabverses, Tabs, History, Notes, Todos, Bookmarks.
  expect(groups.map((group) => group.entity)).toEqual([
    'tabspace',
    'closedtab',
    'note',
    'todo',
  ]);

  const notes = groups.find((group) => group.entity === 'note');
  expect(notes?.count).toBe(2);
  expect(notes?.tabverses.map((tabverse) => tabverse.title)).toEqual([
    'One',
    'Two',
  ]);
  expect(notes?.tabverses[0].hits.map((entry) => entry.id)).toEqual(['n1']);

  // A tabverse hit is its own group and takes its title from the hit.
  const tabspaces = groups.find((group) => group.entity === 'tabspace');
  expect(tabspaces?.count).toBe(1);
  expect(tabspaces?.tabverses[0].title).toBe('One');
});

test('a hit without a tabverse still lands in a group', () => {
  const groups = groupHits([hit({ id: 'solo' })]);
  expect(groups).toHaveLength(1);
  expect(groups[0].tabverses[0].id).toBe('');
  expect(groups[0].tabverses[0].title).toBe('');
});
