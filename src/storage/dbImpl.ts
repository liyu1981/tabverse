import * as DexieObservable from 'dexie-observable';

import { TabSpaceDBMsg, sendPubSubMessage } from '../message/message';

import Dexie from 'dexie';
import { IDatabaseChange } from 'dexie-observable/api';
import { TabSpaceDatabase } from './TabSpaceDatabase';
import { logger } from '../global';

// trick to force Dexie Observable to be loaded. As with sort imports,
// dexie-observable will be imported before Dexie, but as without any usage,
// typescript will try to not include it in the final bundle. So below we do the
// meaningless assignment Dexie.Observable = DexieOBservable just to cheat
// typescript so it will bundle this for us
// @ts-ignore
Dexie.Observable = DexieObservable;
// we can double check whether Observable is loaded by printing the addons
logger.log('loaded Dexie addons: ', Dexie.addons);

export const dbImpl = new TabSpaceDatabase();

dbImpl.on('changes', (changes: IDatabaseChange[]) => {
  sendPubSubMessage(TabSpaceDBMsg.Changed, changes);
});
