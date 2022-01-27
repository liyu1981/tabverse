import { SavedChromeSessionCollection } from './SavedChromeSessionCollection';
import { strict as assert } from 'assert';
import { exposeDebugData } from '../../debug';

export interface AllChromeSessionData {
  savedChromeSessionCollection: Readonly<SavedChromeSessionCollection>;
}

let allChromeSessionData: AllChromeSessionData | null = null;

export function getAllChromeSessionData(): AllChromeSessionData {
  assert(
    allChromeSessionData !== null,
    'call bootstrap to init allChromeSessionData!',
  );
  return allChromeSessionData;
}

export function bootstrap() {
  allChromeSessionData = {
    savedChromeSessionCollection: new SavedChromeSessionCollection(),
  };

  exposeDebugData('chromeSession', { getAllChromeSessionData });
}