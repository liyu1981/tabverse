/**
 * The thumbnail store is the only place base64 images land in IndexedDB, so
 * the tests care about three things: the round trip, that previews of tabs
 * which no longer exist do not pile up forever, and that the cap is enforced
 * oldest-first.
 */
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import {
  forgetPreview,
  loadPreviews,
  persistPreview,
  pruneStalePreviews,
  MAX_STORED_PREVIEWS,
  TAB_PREVIEW_DB_TABLE_NAME,
} from '../tabPreviewStore';

const rows = () => db.table(TAB_PREVIEW_DB_TABLE_NAME).toArray();
const preview = (n: number) => `data:image/jpeg;base64,AAAA${n}`;

beforeEach(async () => {
  await resetTestDb();
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

test('forgetting a preview drops the row', async () => {
  await persistPreview(10, preview(1));
  await forgetPreview(10);

  expect(await rows()).toHaveLength(0);
  expect((await loadPreviews([10])).has(10)).toBe(false);
});

test('previews of tabs that are gone are pruned', async () => {
  await persistPreview(10, preview(1)); // still open
  await persistPreview(20, preview(2)); // closed while we were away
  await persistPreview(30, preview(3)); // closed while we were away

  const pruned = await pruneStalePreviews([10]);

  expect(pruned).toBe(2);
  const left = await rows();
  expect(left).toHaveLength(1);
  expect(left[0].id).toBe('10');
});

test('the cap drops the oldest previews first', async () => {
  // MAX_STORED_PREVIEWS + 3 live tabs, written oldest first
  const total = MAX_STORED_PREVIEWS + 3;
  for (let i = 0; i < total; i += 1) {
    await persistPreview(i, preview(i));
    // capturedAt has millisecond resolution, so make the order unambiguous
    await db
      .table(TAB_PREVIEW_DB_TABLE_NAME)
      .update(String(i), { capturedAt: 1000 + i });
  }
  const live = Array.from({ length: total }, (_, i) => i);

  const pruned = await pruneStalePreviews(live);

  expect(pruned).toBe(3);
  const left = (await rows()).map((r) => Number(r.id)).sort((a, b) => a - b);
  expect(left).toHaveLength(MAX_STORED_PREVIEWS);
  // the three oldest (0,1,2) went, the newest survived
  expect(left.slice(0, 3)).toEqual([3, 4, 5]);
});

test('pruning an all-stale table clears it', async () => {
  await persistPreview(10, preview(1));
  await persistPreview(20, preview(2));

  expect(await pruneStalePreviews([])).toBe(2);
  expect(await rows()).toHaveLength(0);
});

test('loading nothing is not an error', async () => {
  expect((await loadPreviews([])).size).toBe(0);
});
