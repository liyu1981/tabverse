import { getNewId } from '../data/common';
import { tokenize } from './tokenizer';
import {
  FullTextSearchDatabase,
  INDEX_TABLE_NAME,
} from './FullTextSearchDatabase';
import { IFullTextSearchIndexRecord } from './FullTextSearchDatabase';
import { removeStopWords } from './stopWords';
import { SearchableField } from '../background/fullTextSearch/addToIndex';

export interface IFullTextSearchAddToIndexParam {
  owner: string;
  ultimateOwner: string;
  content: string;
  field: string;
  type: string;
}

export interface IFullTextSearchRemoveFromIndexParam {
  owner: string;
  type?: string;
  field?: string;
}

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
