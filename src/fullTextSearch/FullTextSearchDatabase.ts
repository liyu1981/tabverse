import { logger } from '../global';

import Dexie from 'dexie';
import { DB_NAME, TABSPACE_FULLTEXT_DB_VERSION } from './common';

export const schemas = {};

export const INDEX_TABLE_NAME = 'index';
schemas[INDEX_TABLE_NAME] =
  'id, owner, type, field, *terms, [owner+type], [owner+type+field]';

export interface IFullTextSearchIndexRecord {
  id: string;
  owner: string;
  ultimateOwner: string;
  type: string;
  field: string;
  terms: string[];
}

async function dbUpgrade7() {}

export class FullTextSearchDatabase extends Dexie {
  schemas: { [tableName: string]: string };

  constructor() {
    super(DB_NAME);

    this.schemas = schemas;
    logger.log(
      `registered FullTextSearchDatabase schemas v${TABSPACE_FULLTEXT_DB_VERSION} are:`,
      this.schemas,
    );

    this.version(TABSPACE_FULLTEXT_DB_VERSION)
      .stores(this.schemas)
      .upgrade(dbUpgrade7);
  }
}
