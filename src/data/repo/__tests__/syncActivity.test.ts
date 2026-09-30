import {
  endSyncActivity,
  isSyncing,
  subscribeSyncActivity,
  withSyncActivity,
} from '../syncActivity';

/** pubsub-js delivers on the next macrotask unless a message is published sync. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sync activity notice', () => {
  let notifications: boolean[] = [];
  let unsubscribe: () => void = () => {};

  beforeEach(() => {
    notifications = [];
    unsubscribe = subscribeSyncActivity((syncing) =>
      notifications.push(syncing),
    );
  });

  afterEach(() => {
    unsubscribe();
    // a failed expectation must not leak a running sync into the next test
    while (isSyncing()) {
      endSyncActivity();
    }
  });

  it('is idle before anything syncs', () => {
    expect(isSyncing()).toBe(false);
    expect(notifications).toEqual([false]);
  });

  it('publishes start and end around a sync cycle', async () => {
    const order: string[] = [];
    const work = withSyncActivity(async () => {
      order.push('inside');
      return 42;
    });
    order.push(`just started: ${isSyncing()}`);

    expect(await work).toBe(42);
    order.push(`finished: ${isSyncing()}`);
    await flush();

    expect(order).toEqual(['inside', 'just started: true', 'finished: false']);
    expect(notifications).toEqual([false, true, false]);
  });

  it('publishes the end even when the cycle throws', async () => {
    await expect(
      withSyncActivity(async () => {
        throw new Error('server unreachable');
      }),
    ).rejects.toThrow('server unreachable');
    await flush();

    expect(isSyncing()).toBe(false);
    expect(notifications).toEqual([false, true, false]);
  });

  it('stays busy until the outermost nested sync ends', async () => {
    let releaseOuter = () => {};
    const outerGate = new Promise<void>((resolve) => {
      releaseOuter = resolve;
    });

    // an upload running inside a sync cycle, and the cycle itself
    const outer = withSyncActivity(async () => {
      await outerGate;
    });
    const inner = withSyncActivity(async () => {
      /* nothing */
    });
    await inner;
    await flush();

    expect(isSyncing()).toBe(true);
    expect(notifications).toEqual([false, true]);

    releaseOuter();
    await outer;
    await flush();

    expect(isSyncing()).toBe(false);
    expect(notifications).toEqual([false, true, false]);
  });

  it('stops notifying after the listener unsubscribes', async () => {
    unsubscribe();
    notifications = [];
    await withSyncActivity(async () => {
      /* nothing */
    });
    await flush();

    expect(notifications).toEqual([]);
  });
});
