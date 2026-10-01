/**
 * The thumbnail store is the only place base64 images land in IndexedDB, so
 * the tests care about the round trip, that a preview belongs to the browser
 * run that captured it, and that losing the table is a state the product can
 * be in (it is a cache, see data/tabSpace/previewReaper).
 */
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import {
  forgetPreview,
  loadPreviews,
  persistPreview,
  TAB_PREVIEW_DB_TABLE_NAME,
} from '../tabPreviewStore';
import {
  currentPreviewSessionId,
  setPreviewSessionIdForTest,
} from '../previewSession';

const rows = () => db.table(TAB_PREVIEW_DB_TABLE_NAME).toArray();
const preview = (n: number) => `data:image/jpeg;base64,AAAA${n}`;

beforeEach(async () => {
  await resetTestDb();
  setPreviewSessionIdForTest('session-a');
});

afterEach(() => {
  setPreviewSessionIdForTest(null);
});

test('a stored preview comes back for its tab only', async () => {
  await persistPreview(10, preview(1));
  await persistPreview(20, preview(2));

  const loaded = await loadPreviews([10, 20, 30]);

  expect(loaded.get(10)).toBe(preview(1));
  expect(loaded.get(20)).toBe(preview(2));
  expect(loaded.has(30)).toBe(false);
  expect(await rows()).toHaveLength(2);
});

test('re-capturing a tab replaces its preview instead of adding a row', async () => {
  await persistPreview(10, preview(1));
  await persistPreview(10, preview(2));

  expect(await rows()).toHaveLength(1);
  expect((await loadPreviews([10])).get(10)).toBe(preview(2));
});

test('a stored row says which browser run wrote it', async () => {
  await persistPreview(10, preview(1));

  expect((await rows())[0].sessionId).toBe(await currentPreviewSessionId());
});

test('forgetting a preview drops the row', async () => {
  await persistPreview(10, preview(1));
  await forgetPreview(10);

  expect(await rows()).toHaveLength(0);
  expect((await loadPreviews([10])).has(10)).toBe(false);
});

// The reason the session id exists at all: a chrome tab id is recycled between
// browser runs, so a row from the previous run whose id is live *now* would be
// shown on a completely different page. The page must never load one, whether
// or not the worker's reap has run yet.
test('a preview from an earlier browser run is not loaded onto a live tab id', async () => {
  await persistPreview(10, preview(1));

  // the browser restarts: the id is live again, the screenshot is history
  setPreviewSessionIdForTest('session-b');

  expect((await loadPreviews([10])).size).toBe(0);
  // the row is still there for the reaper to drop - this layer does not delete
  expect(await rows()).toHaveLength(1);
});

test('losing the whole table is a supported state', async () => {
  await persistPreview(10, preview(1));
  await persistPreview(20, preview(2));

  // the cache can be emptied at any time - by the reaper, by a schema change,
  // by a profile that was cleaned - and nothing may depend on it
  await db.table(TAB_PREVIEW_DB_TABLE_NAME).clear();

  expect((await loadPreviews([10, 20])).size).toBe(0);
  await expect(persistPreview(10, preview(3))).resolves.toBeUndefined();
  expect((await loadPreviews([10])).get(10)).toBe(preview(3));
});

test('loading nothing is not an error', async () => {
  expect((await loadPreviews([])).size).toBe(0);
});
