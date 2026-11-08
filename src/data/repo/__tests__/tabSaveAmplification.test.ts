/**
 * A save writes the tab rows whose **content** changed, and nothing else.
 *
 * `saveTabSpace` used to bulkPut every tab of the tabverse on every save, and
 * `convertToSavedBase` stamps all of them with a fresh `updatedAt`. Everything
 * downstream then treated that as an edit of every tab: the change feed queued
 * every row, the outbox did one read-modify-write per row (quadratic in the
 * size of the window), and the next sync pushed the whole tabverse to the
 * server. Opening a single tab in a window of a hundred did all of that.
 *
 * This test drives the real save and the real change feed, and counts what was
 * queued for sync - the number the network and the worker actually pay for.
 */
import { Outbox } from '../outbox';
import { RecordInput } from '../types';
import { SYNC_CONFIG_KEY } from '../syncConfig';
import { db } from '../../../storage/db';
import { MemoryStorageArea } from '../outbox';
import { resetTestDb } from '../../../dev/dbImplTest';
import { resetChangeFeedForTest, startChangeFeed } from '../changeFeed';
import { saveCurrentTabSpace } from '../../tabSpace/util';
import { findTabByChromeTabId } from '../../tabSpace/TabSpace';
import { $tabSpace, tabSpaceStoreApi } from '../../tabSpace/store';
import { setupMockChromeAndTabSpaceWithMonitoring } from '../../tabSpace/__tests__/common.test';

class RecordingOutbox extends Outbox {
  batches: RecordInput[][] = [];

  override enqueueMany(inputs: RecordInput[]): Promise<any> {
    this.batches.push(inputs.map((input) => ({ ...input })));
    return super.enqueueMany(inputs);
  }

  /** Every record queued so far, flattened. */
  queued(): RecordInput[] {
    return this.batches.flat();
  }

  reset(): void {
    this.batches = [];
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

beforeEach(async () => {
  await resetTestDb();
  resetChangeFeedForTest();
});

test('a second save with nothing changed queues no tab rows', async () => {
  const { mockChrome, w1 } = await setupMockChromeAndTabSpaceWithMonitoring();
  const storage = new MemoryStorageArea();
  await storage.set({
    [SYNC_CONFIG_KEY]: {
      baseUrl: 'https://sync.example.com',
      token: 'tok',
      enabled: true,
    },
  });
  const outbox = new RecordingOutbox(storage);
  await startChangeFeed({ storage, outbox, database: db as any });

  // the tabverse is born saved; this first save writes every row
  tabSpaceStoreApi.updateTabSpace({ id: 'ts-writes', name: 'Window' });
  await saveCurrentTabSpace();
  await settle();
  const firstSaveTabs = outbox.queued().filter((r) => r.entity === 'tab');
  expect(firstSaveTabs.length).toBeGreaterThan(1);

  // nothing about the tabs changed, so the second save must not queue them
  outbox.reset();
  await saveCurrentTabSpace();
  await settle();
  expect(outbox.queued().filter((r) => r.entity === 'tab')).toHaveLength(0);
  // the tabverse row itself is still written: it carries the save time
  expect(
    outbox.queued().filter((r) => r.entity === 'tabspace').length,
  ).toBeGreaterThan(0);

  // one tab's title changes: exactly that row is queued
  outbox.reset();
  const tab = $tabSpace.getState().tabs.first();
  expect(tab).toBeDefined();
  mockChrome.updateTab(tab!.chromeTabId, { title: 'a changed title' });
  // the update path is debounced by 500ms; wait past it, not on it
  await mockChrome.flushMessages(900);
  await saveCurrentTabSpace();
  await settle();
  const queuedTabs = outbox.queued().filter((r) => r.entity === 'tab');
  expect(queuedTabs).toHaveLength(1);
  expect(queuedTabs[0].id).toBe(tab!.id);
  expect(JSON.parse(queuedTabs[0].payload).title).toBe('a changed title');

  // and the live store agrees with what was written
  expect(
    findTabByChromeTabId(tab!.chromeTabId, $tabSpace.getState())?.title,
  ).toBe('a changed title');

  void w1;
  resetChangeFeedForTest();
});
