import {
  $serverSyncConfigured,
  refreshServerSyncConfigured,
  startServerSyncConfiguredWatch,
} from '../syncStatus';
import { clearSyncConfig, memoryStorage, saveSyncConfig } from '../syncConfig';

const config = (over: Partial<Parameters<typeof saveSyncConfig>[0]> = {}) => ({
  baseUrl: 'http://localhost:8223',
  token: 'tok',
  userId: 'usr_1',
  deviceId: 'dev_1',
  enabled: true,
  ...over,
});

test('no stored config means not configured', async () => {
  const storage = memoryStorage();
  expect(await refreshServerSyncConfigured(storage)).toBe(false);
  expect($serverSyncConfigured.getState()).toBe(false);
});

test('a paired config publishes true, disabling it publishes false', async () => {
  const storage = memoryStorage();
  await saveSyncConfig(config(), storage);
  expect(await refreshServerSyncConfigured(storage)).toBe(true);
  expect($serverSyncConfigured.getState()).toBe(true);

  // pairing stored but sync explicitly turned off is not "configured"
  await saveSyncConfig(config({ enabled: false }), storage);
  expect(await refreshServerSyncConfigured(storage)).toBe(false);
  expect($serverSyncConfigured.getState()).toBe(false);

  await clearSyncConfig(storage);
  expect(await refreshServerSyncConfigured(storage)).toBe(false);
});

test('the watch refreshes on an external config change and unsubscribes', async () => {
  const storage = memoryStorage();
  let notify: () => void = () => undefined;
  let unsubscribed = false;
  const stop = startServerSyncConfiguredWatch({
    storage,
    subscribe: (listener) => {
      notify = listener;
      return () => {
        unsubscribed = true;
      };
    },
  });

  // initial read
  await Promise.resolve();
  expect($serverSyncConfigured.getState()).toBe(false);

  // another context pairs the device
  await saveSyncConfig(config(), storage);
  notify();
  await Promise.resolve();
  await Promise.resolve();
  expect($serverSyncConfigured.getState()).toBe(true);

  stop();
  expect(unsubscribed).toBe(true);

  // after unsubscribing, changes no longer propagate
  await clearSyncConfig(storage);
  notify();
  await Promise.resolve();
  expect($serverSyncConfigured.getState()).toBe(true);
});
