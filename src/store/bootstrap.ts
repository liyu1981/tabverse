import { StorageManager } from './storage';
import { strict as assert } from 'assert';

let storageManager = null;

export function getStorageManager(): StorageManager {
  assert(storageManager, 'call bootstrap to init savedStoreManager!');
  return storageManager;
}

export function bootstrap() {
  storageManager = new StorageManager();
}
