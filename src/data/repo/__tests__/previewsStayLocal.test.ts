/**
 * Tab thumbnails are pictures of the user's screen: they must never reach the
 * sync server. The preview table gets write hooks like every other table, so
 * the thing that keeps them local is that it has no sync entity - this pins
 * that down, and shows the feed still works for a real table in the same run.
 */
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { MemoryStorageArea, Outbox } from '../outbox';
import { TAB_PREVIEW_DB_TABLE_NAME } from '../../tabSpace/tabPreviewStore';
import {
  handleChanges,
  resetChangeFeedForTest,
  startChangeFeed,
} from '../changeFeed';
import { entityForTable } from '../dbBridge';
import { SYNC_CONFIG_KEY } from '../syncConfig';

test('the preview table has no sync entity, so the feed ignores it', () => {
  expect(entityForTable(TAB_PREVIEW_DB_TABLE_NAME)).toBeNull();
});

test('writing a preview does not queue anything, a real table still does', async () => {
  await resetTestDb();
  resetChangeFeedForTest();
  const storage = new MemoryStorageArea();
  await storage.set({
    [SYNC_CONFIG_KEY]: {
      baseUrl: 'http://localhost:8223',
      token: 'tok',
      enabled: true,
    },
  });
  const outbox = new Outbox(storage);
  await startChangeFeed({ storage, outbox, database: db as any });

  await db
    .table(TAB_PREVIEW_DB_TABLE_NAME)
    .put({ id: '10', capturedAt: 1, preview: 'data:image/jpeg;base64,AAA' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(await outbox.size()).toBe(0);

  // the feed itself is alive: a real table still queues
  await db.table('SavedNote').put({ id: 'n1', updatedAt: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await handleChanges(
    [
      {
        table: 'SavedNote',
        type: 1,
        key: 'n1',
        obj: { id: 'n1', updatedAt: 1 },
      },
    ],
    outbox,
    storage,
  );
  expect(await outbox.size()).toBe(1);
});
