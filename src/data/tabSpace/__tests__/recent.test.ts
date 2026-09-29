import {
  countSavedTabSpaces,
  queryRecentSavedTabSpaces,
  RECENT_TAB_SPACE_LIMIT,
} from '../util';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';

function savedTabSpace(id: string, name: string, updatedAt: number) {
  return {
    id,
    name,
    tabIds: [],
    version: 10,
    createdAt: 1,
    updatedAt,
  };
}

beforeEach(async () => {
  await resetTestDb();
});

test('recents are the tabverses with the newest update, first', async () => {
  await db
    .table('SavedTabSpace')
    .bulkPut([
      savedTabSpace('old', 'Old', 1000),
      savedTabSpace('newest', 'Newest', 3000),
      savedTabSpace('middle', 'Middle', 2000),
    ]);

  const recents = await queryRecentSavedTabSpaces();
  expect(recents.map((t) => t.id)).toEqual(['newest', 'middle', 'old']);
  expect(recents[0].name).toEqual('Newest');
});

test('a tabverse opened just now floats to the top', async () => {
  // this is the whole point of using updatedAt: tabSpaceBootstrap saves the
  // tabverse it just opened, and the popup shows that as "recent"
  await db
    .table('SavedTabSpace')
    .bulkPut([savedTabSpace('a', 'A', 1000), savedTabSpace('b', 'B', 2000)]);
  expect((await queryRecentSavedTabSpaces())[0].id).toEqual('b');

  await db.table('SavedTabSpace').put(savedTabSpace('a', 'A', 3000));
  expect((await queryRecentSavedTabSpaces())[0].id).toEqual('a');
});

test('recents are capped, the rest are left out', async () => {
  const rows = Array.from({ length: RECENT_TAB_SPACE_LIMIT + 4 }, (_v, i) =>
    savedTabSpace(`ts-${i}`, `Tabverse ${i}`, 1000 + i),
  );
  await db.table('SavedTabSpace').bulkPut(rows);

  const recents = await queryRecentSavedTabSpaces();
  expect(recents.length).toEqual(RECENT_TAB_SPACE_LIMIT);
  // the newest survive, in order
  expect(recents[0].name).toEqual(`Tabverse ${RECENT_TAB_SPACE_LIMIT + 3}`);
  expect(await queryRecentSavedTabSpaces(2)).toHaveLength(2);
});

test('recents come with their tabs, for the row to count them', async () => {
  await db.table('SavedTabSpace').bulkPut([
    { ...savedTabSpace('ts-a', 'A', 2000), tabIds: ['t1', 't2'] },
    { ...savedTabSpace('ts-b', 'B', 1000), tabIds: ['t3'] },
  ]);
  await db.table('SavedTab').bulkPut(
    ['t1', 't2', 't3'].map((id) => ({
      id,
      tabSpaceId: id === 't3' ? 'ts-b' : 'ts-a',
      title: `tab ${id}`,
      url: `https://example.com/${id}`,
      favIconUrl: '',
      pinned: false,
      suspended: false,
      version: 10,
      createdAt: 1,
      updatedAt: 1,
    })),
  );

  const recents = await queryRecentSavedTabSpaces();
  expect(recents[0].tabs.size).toEqual(2);
  expect(recents[1].tabs.size).toEqual(1);
});

test('an empty database has no recents and no saved tabverses', async () => {
  expect(await queryRecentSavedTabSpaces()).toEqual([]);
  expect(await countSavedTabSpaces()).toEqual(0);
  await db.table('SavedTabSpace').put(savedTabSpace('ts-a', 'A', 1));
  expect(await countSavedTabSpaces()).toEqual(1);
});
