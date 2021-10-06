import { TABSPACE_DB_VERSION, logger } from '../global';

import Dexie from 'dexie';
import { dbUpgrade } from './upgrade';
import { schemas } from './schema';

export class TabSpaceDatabase extends Dexie {
  schemas: { [key: string]: string };

  constructor(tag?: string) {
    super(tag ? `TabSpaceDB-${tag}` : 'TabSpaceDB');

    this.schemas = schemas;
    logger.log(
      `registered TabSpaceDB schemas v${TABSPACE_DB_VERSION} are:`,
      this.schemas,
    );

    this.version(TABSPACE_DB_VERSION).stores(this.schemas).upgrade(dbUpgrade);
  }
}
