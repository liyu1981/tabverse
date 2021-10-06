import { clone } from 'lodash';
import { db } from './db';
import { logger } from '../global';
import { schemas } from './schema';

export async function dumpDb(): Promise<string> {
  const contents: string[] = [];
  const tabNames = Object.keys(schemas);
  for (let i = 0; i < tabNames.length; i++) {
    const tabName = tabNames[i];
    const records = await db.table(tabName).toArray();
    contents.push(JSON.stringify({ tabName, records }));
  }
  return `[${contents.join(',')}]`;
}

interface DbDumpEntry {
  tabName: string;
  records: any[];
}

export async function importDb(
  dbDump: DbDumpEntry[],
  progressFn: (
    tabName: string,
    recordDone: number,
    recordTotal: number,
  ) => void,
): Promise<void> {
  for (let i = 0; i < dbDump.length; i++) {
    const dbDumpEntry = dbDump[i];
    const dbTable = db.table(dbDumpEntry.tabName);
    if (dbTable) {
      for (let j = 0; j < dbDumpEntry.records.length; j++) {
        logger.log('now import record:', dbDumpEntry.records[j]);
        const record = clone(dbDumpEntry.records[j]);
        const oldSave = await dbTable.get(record.id);
        if (oldSave) {
          logger.log(`old save for id ${record.id} found, skip importing.`);
        } else {
          await dbTable.add(record);
        }
        progressFn(dbDumpEntry.tabName, j + 1, dbDumpEntry.records.length);
      }
    }
  }
}
