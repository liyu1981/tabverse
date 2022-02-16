import {
  FullTextSearchDatabase,
  INDEX_TABLE_NAME,
} from './FullTextSearchDatabase';
import { logger, typeGuard } from '../global';

import { IFullTextSearchIndexRecord } from './FullTextSearchDatabase';
import { SearchableField } from '../background/fullTextSearch/addToIndex';
import { getNewId } from '../data/common';
import { removeStopWords } from './stopWords';
import { tokenize } from './tokenizer';

export interface IFullTextSearchAddToIndexParam {
  owner: string;
  ultimateOwner: string;
  content: string;
  field: string;
  type: string;
}

export interface IFullTextSearchRemoveFromIndexByOwnerParam {
  owner: string;
  type?: string;
  field?: string;
}

export interface IFullTextSearchRemoveFromIndexByUltimateOwnerParam {
  ultimateOwner: string;
}

export type IFullTextSearchRemoveFromIndexParam =
  | IFullTextSearchRemoveFromIndexByOwnerParam
  | IFullTextSearchRemoveFromIndexByUltimateOwnerParam;

export async function addToIndex(
  db: FullTextSearchDatabase,
  param: IFullTextSearchAddToIndexParam,
) {
  const { terms: rawTerms, lang } = await tokenize(param.content);
  let terms = rawTerms;

  if (param.field === SearchableField.Title && lang === 'en') {
    terms = removeStopWords(terms, lang);
  }

  if (param.field === SearchableField.Url) {
    terms = removeStopWords(terms, 'url');
  }

  const existingRecord = await db
    .table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME)
    .where('[owner+type+field]')
    .equals([param.owner, param.type, param.field])
    .first();

  if (existingRecord !== undefined) {
    await db
      .table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME)
      .update(existingRecord.id, { terms });
  } else {
    await db.table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME).put({
      id: getNewId(),
      owner: param.owner,
      ultimateOwner: param.ultimateOwner,
      type: param.type,
      field: param.field,
      terms,
    });
  }
}

export async function removeFromIndex(
  db: FullTextSearchDatabase,
  param: IFullTextSearchRemoveFromIndexParam,
) {
  if (typeGuard<IFullTextSearchRemoveFromIndexByOwnerParam>(param)) {
    return removeFromIndexByOwner(db, param);
  } else if (
    typeGuard<IFullTextSearchRemoveFromIndexByUltimateOwnerParam>(param)
  ) {
    removeFromIndexByUltimateOwner(db, param);
  } else {
    logger.error(`Param is wrong, skip. ${param}`);
  }
}

async function removeFromIndexByOwner(
  db: FullTextSearchDatabase,
  param: IFullTextSearchRemoveFromIndexByOwnerParam,
) {
  let indexToUse = '';
  let valueToSearch = [param.owner];

  if ('type' in param) {
    indexToUse = '[owner+type]';
    valueToSearch = [param.owner, param.type];
  }

  if ('type' in param && 'field' in param) {
    indexToUse = '[owner+type+field]';
    valueToSearch = [param.owner, param.type, param.field];
  }

  const existingRecords = await db
    .table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME)
    .where(indexToUse)
    .equals(valueToSearch)
    .toArray();
  if (existingRecords.length > 0) {
    await db
      .table(INDEX_TABLE_NAME)
      .bulkDelete(existingRecords.map((record) => record.id));
  }
}

async function removeFromIndexByUltimateOwner(
  db: FullTextSearchDatabase,
  param: IFullTextSearchRemoveFromIndexByUltimateOwnerParam,
) {
  const existingRecords = await db
    .table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME)
    .where('ultimateOwner')
    .equals(param.ultimateOwner)
    .toArray();
  if (existingRecords.length > 0) {
    await db
      .table(INDEX_TABLE_NAME)
      .bulkDelete(existingRecords.map((record) => record.id));
  }
}
