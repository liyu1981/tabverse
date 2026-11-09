/**
 * What one click on the History panel's bin costs the sync layer.
 *
 * The History tool saves the whole list on every close and every delete, and
 * `convertToSavedClosedTab` re-stamps every row it writes. Before this, a save
 * therefore looked like an edit of *all* the rows in the tabverse - up to 999
 * of them - so forgetting one page queued the whole history for the server (and
 * the next sync pushed it, several hundred kilobytes for one click, with the
 * worker pulling and re-writing the echo). That is the churn that made the
 * History panel heavy after a few deletes.
 *
 * A save now writes (and queues) only the rows whose content changed. This test
 * drives the real store, save and change feed and counts what was queued.
 */
import { Outbox, MemoryStorageArea } from '../outbox';
import { RecordInput } from '../types';
import { SYNC_CONFIG_KEY } from '../syncConfig';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { resetChangeFeedForTest, startChangeFeed } from '../changeFeed';
import { tabSpaceStoreApi } from '../../tabSpace/store';
import { TabCore } from '../../tabSpace/Tab';
import { CLOSED_TAB_DB_TABLE_NAME, ClosedTab } from '../../closedTab/ClosedTab';
import {
  deleteClosedTab,
  loadClosedTabsByTabSpaceId,
  recordClosedTab,
  saveAllClosedTabs,
} from '../../closedTab/util';
import { $allClosedTab } from '../../closedTab/store';

const TABSPACE_ID = 'history-churn';

class RecordingOutbox extends Outbox {
  batches: RecordInput[][] = [];

  override enqueueMany(inputs: RecordInput[]): Promise<any> {
    this.batches.push(inputs.map((input) => ({ ...input })));
    return super.enqueueMany(inputs);
  }

  queued(): RecordInput[] {
    return this.batches.flat();
  }

  reset(): void {
    this.batches = [];
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

function aTab(url: string): TabCore {
  return {
    version: 11,
    id: `chrome-less-${url}`,
    createdAt: 1,
    updatedAt: 1,
    tabSpaceId: TABSPACE_ID,
    title: url,
    url,
    favIconUrl: '',
    pinned: false,
    suspended: false,
  };
}

async function rowsInDb(): Promise<ClosedTab[]> {
  return db.table<ClosedTab>(CLOSED_TAB_DB_TABLE_NAME).toArray();
}

beforeEach(async () => {
  await resetTestDb();
  resetChangeFeedForTest();
  tabSpaceStoreApi.updateTabSpace({ id: TABSPACE_ID });
});

test('deleting one page queues one tombstone, not the whole history', async () => {
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

  // five pages, then a save that writes all of them for the first time
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  for (let i = 0; i < 5; i++) {
    recordClosedTab(aTab(`https://page${i}.example.com`), 1000 + i);
  }
  await saveAllClosedTabs();
  await settle();
  expect(outbox.queued().filter((r) => r.entity === 'closedtab')).toHaveLength(
    5,
  );

  // forgetting one page must cost one delete, and nothing for its neighbours
  outbox.reset();
  const doomed = $allClosedTab.getState().closedTabs.first();
  deleteClosedTab(doomed);
  await saveAllClosedTabs();
  await settle();

  const queued = outbox.queued().filter((r) => r.entity === 'closedtab');
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ id: doomed.id, deleted: true });
  expect((await rowsInDb()).some((row) => row.id === doomed.id)).toBe(false);
  expect((await rowsInDb()).length).toEqual(4);

  resetChangeFeedForTest();
});
