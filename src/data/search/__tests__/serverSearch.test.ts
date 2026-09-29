import { FIELD_ALL, Query, TYPE_ALL } from '../Query';
import { ServerApiClient } from '../../repo/serverApi';
import { SearchableField, SearchableType } from '../searchable';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { searchServerTabSpaceIds } from '../serverSearch';

interface RecordedRequest {
  url: string;
}

/** A fetch stub that answers every /search with the hits it was given. */
function fetchReturning(hitsPerCall: any[][]) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchFn = async (url: string) => {
    requests.push({ url });
    const hits = hitsPerCall[call] ?? [];
    call += 1;
    return {
      status: 200,
      json: async () => ({ query: 'q', hits }),
    };
  };
  return { fetchFn, requests };
}

const api = (fetchFn: any) =>
  new ServerApiClient({ baseUrl: 'http://server', token: 'tok', fetchFn });

const hit = (entity: string, id: string, tabspace_id: string) => ({
  entity,
  id,
  score: 1,
  tabspace_id,
});

const query = (
  groups: { terms: string[]; type?: string; field?: string }[],
): Query =>
  new Query({
    andQueries: groups.map((g) => ({
      scope: { type: g.type ?? TYPE_ALL, field: g.field ?? FIELD_ALL },
      terms: g.terms,
    })),
  });

beforeEach(async () => {
  await resetTestDb();
  await db.table('SavedTab').bulkPut([
    {
      id: 't1',
      tabSpaceId: 'ts-1',
      title: 'Pasta basics',
      url: 'https://example.com/pasta',
      favIconUrl: '',
      pinned: false,
      suspended: false,
      version: 10,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
});

test('a hit becomes the tabverse it belongs to', async () => {
  const { fetchFn, requests } = fetchReturning([
    [hit('tab', 't1', 'ts-1'), hit('tabspace', 'ts-2', 'ts-2')],
  ]);
  const ids = await searchServerTabSpaceIds(
    api(fetchFn),
    query([{ terms: ['pasta'] }]),
  );
  expect(ids).toEqual(['ts-1', 'ts-2']);
  expect(requests[0].url).toContain('q=pasta');
  // no entity filter for an unscoped group: the server searches everything
  expect(requests[0].url).not.toContain('entity=');
  expect(requests[0].url).toContain('limit=200');
});

test('a tabspace hit from a server without tabspace_id is its own id', async () => {
  const { fetchFn } = fetchReturning([
    [{ entity: 'tabspace', id: 'ts-legacy', score: 1 }],
  ]);
  const ids = await searchServerTabSpaceIds(
    api(fetchFn),
    query([{ terms: ['recipes'] }]),
  );
  expect(ids).toEqual(['ts-legacy']);
});

test('a hit for a non-tabspace record without tabspace_id is dropped', async () => {
  const { fetchFn } = fetchReturning([[{ entity: 'tab', id: 't9', score: 1 }]]);
  const ids = await searchServerTabSpaceIds(
    api(fetchFn),
    query([{ terms: ['pasta'] }]),
  );
  expect(ids).toEqual([]);
});

test('a typed group is sent as an entity filter', async () => {
  const { fetchFn, requests } = fetchReturning([[hit('tab', 't1', 'ts-1')]]);
  await searchServerTabSpaceIds(
    api(fetchFn),
    query([{ terms: ['pasta'], type: SearchableType.Tab }]),
  );
  expect(requests[0].url).toContain('entity=tab');
});

test('each group is one request and the results are unioned in order', async () => {
  const { fetchFn, requests } = fetchReturning([
    [hit('tab', 't1', 'ts-1')],
    [hit('tab', 't2', 'ts-2'), hit('tab', 't1', 'ts-1')],
  ]);
  const ids = await searchServerTabSpaceIds(
    api(fetchFn),
    query([
      { terms: ['pasta'], type: SearchableType.Tab },
      { terms: ['virtual'], type: SearchableType.Tab },
    ]),
  );
  expect(requests.length).toBe(2);
  expect(ids).toEqual(['ts-1', 'ts-2']);
});

test('a field scoped group is verified against the local row', async () => {
  // the server matched on the title, so a url-scoped group must drop it even
  // though the term is in that row somewhere
  const { fetchFn } = fetchReturning([[hit('tab', 't1', 'ts-1')]]);
  const byUrl = await searchServerTabSpaceIds(
    api(fetchFn),
    query([
      {
        terms: ['basics'],
        type: SearchableType.Tab,
        field: SearchableField.Url,
      },
    ]),
  );
  expect(byUrl).toEqual([]);

  const { fetchFn: fetchFn2 } = fetchReturning([[hit('tab', 't1', 'ts-1')]]);
  const byTitle = await searchServerTabSpaceIds(
    api(fetchFn2),
    query([
      {
        terms: ['basics'],
        type: SearchableType.Tab,
        field: SearchableField.Title,
      },
    ]),
  );
  expect(byTitle).toEqual(['ts-1']);
});

test('a field scoped group drops hits whose row is not local', async () => {
  const { fetchFn } = fetchReturning([[hit('tab', 'not-mine', 'ts-9')]]);
  const ids = await searchServerTabSpaceIds(
    api(fetchFn),
    query([
      {
        terms: ['pasta'],
        type: SearchableType.Tab,
        field: SearchableField.Url,
      },
    ]),
  );
  expect(ids).toEqual([]);
});

test('a server error is not swallowed into "no results"', async () => {
  const fetchFn = async () => {
    throw new Error('network down');
  };
  await expect(
    searchServerTabSpaceIds(api(fetchFn), query([{ terms: ['pasta'] }])),
  ).rejects.toThrow();
});
