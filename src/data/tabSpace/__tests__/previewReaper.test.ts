/**
 * The reaper is the only thing that deletes from the preview table, and it runs
 * in the service worker - so the tests are about two things: that a row without
 * an open tab goes (including a tab that lives in *another* window, which the
 * version this replaced got wrong), and that deciding to drop an 80 kB
 * screenshot never costs 80 kB of reading.
 */
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { reapPreviews } from '../previewReaper';
import { persistPreview, TAB_PREVIEW_DB_TABLE_NAME } from '../tabPreviewStore';
import { MAX_STORED_PREVIEWS } from '../tabPreviewSchema';
import { setPreviewSessionIdForTest } from '../previewSession';

const rows = () => db.table(TAB_PREVIEW_DB_TABLE_NAME).toArray();
const ids = async () =>
  (await rows()).map((r) => Number(r.id)).sort((a, b) => a - b);
const preview = (n: number) => `data:image/jpeg;base64,AAAA${n}`;

/** Puts capturedAt far enough apart to make "oldest first" unambiguous. */
async function withAge(chromeTabId: number, capturedAt: number): Promise<void> {
  await db
    .table(TAB_PREVIEW_DB_TABLE_NAME)
    .update(String(chromeTabId), { capturedAt });
}

beforeEach(async () => {
  await resetTestDb();
  setPreviewSessionIdForTest('session-a');
});

afterEach(() => {
  setPreviewSessionIdForTest(null);
});

test('a row whose tab is not open goes, and one that is stays', async () => {
  await persistPreview(10, preview(1)); // still open
  await persistPreview(20, preview(2)); // closed while we were away

  const report = await reapPreviews({ liveTabIds: [10] });

  expect(report.scanned).toBe(2);
  expect(report.dropped.unowned).toBe(1);
  expect(report.total).toBe(1);
  expect(await ids()).toEqual([10]);
});

// The bug this replaced: the manager page used to reap against *its own
// window's* tabs, so opening a second tabverse deleted the first one's
// thumbnails (adr/0006 allows one manager page per window, more than one
// window).
test("another window's tabs are owners too", async () => {
  await persistPreview(10, preview(1));
  await persistPreview(11, preview(2));

  const report = await reapPreviews({ liveTabIds: [10, 11] });

  expect(report.total).toBe(0);
  expect(await ids()).toEqual([10, 11]);
});

test('everything an earlier browser run wrote goes, without asking about tabs', async () => {
  await persistPreview(10, preview(1));
  await persistPreview(20, preview(2));

  setPreviewSessionIdForTest('session-b');

  // no liveTabIds at all: the session rule alone is enough to sweep the run
  const report = await reapPreviews({ liveTabIds: [10, 20] });

  expect(report.dropped.staleSession).toBe(2);
  expect(report.dropped.unowned).toBe(0);
  expect(await rows()).toHaveLength(0);
});

test('a row written before sessions existed goes too', async () => {
  // an older build's row: no sessionId field at all, so it is not in the index
  await db.table(TAB_PREVIEW_DB_TABLE_NAME).put({
    id: '10',
    capturedAt: 1,
    preview: preview(1),
  });

  const report = await reapPreviews({ liveTabIds: [10] });

  expect(report.dropped.staleSession).toBe(1);
  expect(await rows()).toHaveLength(0);
});

test('the cap drops the oldest previews first', async () => {
  const total = MAX_STORED_PREVIEWS + 3;
  for (let i = 0; i < total; i += 1) {
    await persistPreview(i, preview(i));
    await withAge(i, 1000 + i);
  }
  const live = Array.from({ length: total }, (_, i) => i);

  const report = await reapPreviews({ liveTabIds: live });

  expect(report.dropped.overCap).toBe(3);
  const left = await ids();
  expect(left).toHaveLength(MAX_STORED_PREVIEWS);
  // the three oldest (0,1,2) went, the newest survived
  expect(left.slice(0, 3)).toEqual([3, 4, 5]);
});

test('the cap is measured after the other two rules', async () => {
  // 100 live tabs and 5 dead ones: the dead ones go first, and the cap then
  // has nothing left to do
  const total = MAX_STORED_PREVIEWS + 5;
  for (let i = 0; i < total; i += 1) {
    await persistPreview(i, preview(i));
    await withAge(i, 1000 + i);
  }
  const live = Array.from({ length: MAX_STORED_PREVIEWS }, (_, i) => i);

  const report = await reapPreviews({ liveTabIds: live });

  expect(report.dropped.unowned).toBe(5);
  expect(report.dropped.overCap).toBe(0);
  expect(await rows()).toHaveLength(MAX_STORED_PREVIEWS);
});

test('reaping an empty table does nothing and says so', async () => {
  const report = await reapPreviews({ liveTabIds: [1, 2, 3] });

  expect(report.scanned).toBe(0);
  expect(report.total).toBe(0);
});

test('the reap never reads a preview to decide', async () => {
  await persistPreview(10, preview(1));
  await persistPreview(20, preview(2));

  // Deciding to drop an 80 kB screenshot must never cost 80 kB of reading it.
  // The reaper works on primary keys and indexed fields only, so every one of
  // the payload-reading entry points is a bug if it is called - which is a
  // cheaper thing to assert than a payload that throws on access (IndexedDB
  // clones on write, so a throwing getter never reaches the store).
  const tableProto = Object.getPrototypeOf(db.table(TAB_PREVIEW_DB_TABLE_NAME));
  const readsPayload = ['get', 'bulkGet', 'toArray', 'each', 'filter'];
  const spies = readsPayload.map((method) =>
    vi.spyOn(tableProto as any, method),
  );

  const report = await reapPreviews({ liveTabIds: [10] });

  for (const spy of spies) {
    expect(
      spy,
      `the reaper called ${spy.getMockName()}, which materialises previews`,
    ).not.toHaveBeenCalled();
    spy.mockRestore();
  }
  // ...and it still did the job
  expect(report.dropped.unowned).toBe(1);
  expect(await ids()).toEqual([10]);
});

test('a sweep that cannot answer is not an error', async () => {
  // A cache sweep that throws would take the worker's alarm with it, and the
  // next run would be five minutes away. Losing a few megabytes is not worth an
  // error path here, so a failing table is swallowed and reported as "nothing
  // dropped".
  const spy = vi.spyOn(db, 'table').mockReturnValue({
    toCollection: () => ({
      primaryKeys: () => Promise.reject(new Error('table is gone')),
    }),
  } as any);

  try {
    const report = await reapPreviews({ liveTabIds: [1] });
    expect(report.scanned).toBe(0);
    expect(report.total).toBe(0);
  } finally {
    spy.mockRestore();
  }
});
