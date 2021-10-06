import { SavedStoreManager } from './store';
import { strict as assert } from 'assert';

let savedStoreManager = null;

export function getSavedStoreManager(): SavedStoreManager {
  assert(savedStoreManager, 'call bootstrap to init savedStoreManager!');
  return savedStoreManager;
}

export function bootstrap() {
  savedStoreManager = new SavedStoreManager();
}
