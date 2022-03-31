import { StorageManager } from './storage';
import { strict as assert } from 'assert';
import { $tabSpaceStorage } from '../data/tabSpace/store';
import { $todoStorage } from '../data/todo/store';
import { $noteStorage } from '../data/note/store';
import { $bookmarkStorage } from '../data/bookmark/store';

let storageManager: StorageManager = null;

export function getStorageManager(): StorageManager {
  assert(storageManager, 'call bootstrap to init savedStoreManager!');
  return storageManager;
}

export function bootstrap() {
  storageManager = new StorageManager();
  storageManager.addStorage('tabverse', $tabSpaceStorage);
  storageManager.addStorage('todo', $todoStorage);
  storageManager.addStorage('note', $noteStorage);
  storageManager.addStorage('bookmark', $bookmarkStorage);
}
