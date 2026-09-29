import { EmptyQuery, Query } from '../Query';
import { LOCAL_SEARCH_LIMIT, searchLocalTabSpaceIds } from '../localSearch';
import { FIELD_ALL, TYPE_ALL } from '../Query';
import { SearchableField, SearchableType } from '../searchable';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { valueMatchesTerms } from '../searchable';

function tabSpace(id: string, name: string) {
  return {
    id,
    name,
    tabIds: [],
    version: 10,
    createdAt: 1,
    updatedAt: 1,
  };
}

function tab(id: string, tabSpaceId: string, title: string, url: string) {
  return {
    id,
    tabSpaceId,
    title,
    url,
    favIconUrl: '',
    pinned: false,
    suspended: false,
    version: 10,
    createdAt: 1,
    updatedAt: 1,
  };
}

// mirrors what the search box builds: a group without a scope is "anywhere",
// which is what the UI sends for the default scope
const query = (
  groups: { terms: string[]; type?: string; field?: string }[],
): Query =>
  new Query({
    andQueries: groups.map((g) => ({
      scope: {
        type: g.type ?? TYPE_ALL,
        field: g.field ?? FIELD_ALL,
      },
      terms: g.terms.map((t) => t.toLowerCase()),
    })),
  });

beforeEach(async () => {
  await resetTestDb();
  await db
    .table('SavedTabSpace')
    .bulkPut([
      tabSpace('ts-recipes', 'Weeknight recipes'),
      tabSpace('ts-java', 'Java notes'),
    ]);
  await db
    .table('SavedTab')
    .bulkPut([
      tab('t1', 'ts-recipes', 'Pasta basics', 'https://example.com/pasta'),
      tab('t2', 'ts-java', 'Virtual threads', 'https://example.com/jt'),
    ]);
  await db.table('SavedNote').bulkPut([
    {
      id: 'n1',
      tabSpaceId: 'ts-java',
      name: 'Concurrency',
      data: '<p>lock free queues</p>',
      version: 10,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  await db.table('SavedTodo').bulkPut([
    {
      id: 'x1',
      tabSpaceId: 'ts-recipes',
      content: 'buy semolina',
      completed: false,
      version: 10,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  await db.table('SavedBookmark').bulkPut([
    {
      id: 'b1',
      tabSpaceId: 'ts-java',
      name: 'Baeldung',
      url: 'https://example.com/baeldung',
      favIconUrl: '',
      version: 10,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  await db.table('SavedClosedTab').bulkPut([
    {
      id: 'c1',
      tabSpaceId: 'ts-recipes',
      title: 'Sourdough',
      url: 'https://example.com/bread',
      closedAt: 5,
      timesClosed: 1,
      version: 10,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
});

test('an empty query matches nothing', async () => {
  expect(await searchLocalTabSpaceIds(EmptyQuery)).toEqual([]);
  expect(await searchLocalTabSpaceIds(query([{ terms: [] }]))).toEqual([]);
});

test('a tabverse name matches, case insensitively', async () => {
  expect(await searchLocalTabSpaceIds(query([{ terms: ['recipes'] }]))).toEqual(
    ['ts-recipes'],
  );
  expect(await searchLocalTabSpaceIds(query([{ terms: ['JAVA'] }]))).toEqual([
    'ts-java',
  ]);
});

test('the whole tabverse is the unit: a tab match returns its tabverse', async () => {
  expect(
    await searchLocalTabSpaceIds(
      query([{ terms: ['pasta'], type: SearchableType.Tab }]),
    ),
  ).toEqual(['ts-recipes']);
  expect(
    await searchLocalTabSpaceIds(
      query([{ terms: ['example.com'], type: SearchableType.Tab }]),
    ).then((ids) => ids.sort()),
  ).toEqual(['ts-java', 'ts-recipes']);
});

test('every searchable entity is scanned when the scope is anywhere', async () => {
  const anywhere = (term: string) => query([{ terms: [term] }]);
  expect(await searchLocalTabSpaceIds(anywhere('pasta'))).toEqual([
    'ts-recipes',
  ]);
  expect(await searchLocalTabSpaceIds(anywhere('semolina'))).toEqual([
    'ts-recipes',
  ]);
  expect(await searchLocalTabSpaceIds(anywhere('sourdough'))).toEqual([
    'ts-recipes',
  ]);
  expect(await searchLocalTabSpaceIds(anywhere('baeldung'))).toEqual([
    'ts-java',
  ]);
  // note bodies are searched too, not just note names
  expect(await searchLocalTabSpaceIds(anywhere('lock free'))).toEqual([
    'ts-java',
  ]);
});

test('a field scope only looks at that field', async () => {
  expect(
    await searchLocalTabSpaceIds(
      query([
        {
          terms: ['pasta'],
          type: SearchableType.Tab,
          field: SearchableField.Title,
        },
      ]),
    ),
  ).toEqual(['ts-recipes']);
  // the same term only exists in the url
  expect(
    await searchLocalTabSpaceIds(
      query([
        {
          terms: ['pasta'],
          type: SearchableType.Tab,
          field: SearchableField.Url,
        },
      ]),
    ),
  ).toEqual(['ts-recipes']);
  // a title-scoped search does not see urls
  expect(
    await searchLocalTabSpaceIds(
      query([
        {
          terms: ['example.com'],
          type: SearchableType.Tab,
          field: SearchableField.Title,
        },
      ]),
    ),
  ).toEqual([]);
});

test('terms inside a group are ANDed, groups are ORed', async () => {
  expect(
    await searchLocalTabSpaceIds(
      query([{ terms: ['pasta', 'sourdough'], type: SearchableType.TabSpace }]),
    ),
  ).toEqual([]);
  // one row must hold every term of its group
  expect(
    await searchLocalTabSpaceIds(
      query([{ terms: ['pasta', 'basics'], type: SearchableType.Tab }]),
    ),
  ).toEqual(['ts-recipes']);
  // separate groups are ORed
  expect(
    await searchLocalTabSpaceIds(
      query([
        { terms: ['pasta'], type: SearchableType.Tab },
        { terms: ['virtual threads'], type: SearchableType.Tab },
      ]),
    ).then((ids) => ids.sort()),
  ).toEqual(['ts-java', 'ts-recipes']);
});

test('the result stops at the limit', async () => {
  const rows = Array.from({ length: 5 }, (_v, i) =>
    tabSpace(`bulk-${i}`, `bulk tabverse ${i}`),
  );
  await db.table('SavedTabSpace').bulkPut(rows);
  const all = await searchLocalTabSpaceIds(query([{ terms: ['bulk'] }]));
  expect(all.length).toBe(5);
  const capped = await searchLocalTabSpaceIds(query([{ terms: ['bulk'] }]), 2);
  expect(capped.length).toBe(2);
  expect(LOCAL_SEARCH_LIMIT).toBeGreaterThan(0);
});

test('an unknown scope type matches nothing instead of everything', async () => {
  expect(
    await searchLocalTabSpaceIds(query([{ terms: ['pasta'], type: 'nope' }])),
  ).toEqual([]);
});

test('valueMatchesTerms is a case insensitive substring test', () => {
  expect(valueMatchesTerms('Pasta Basics', ['pasta'])).toBe(true);
  expect(valueMatchesTerms('Pasta Basics', ['pasta', 'basics'])).toBe(true);
  expect(valueMatchesTerms('Pasta Basics', ['pasta', 'rice'])).toBe(false);
  expect(valueMatchesTerms(undefined, ['pasta'])).toBe(false);
  expect(valueMatchesTerms('pasta', [])).toBe(false);
});
