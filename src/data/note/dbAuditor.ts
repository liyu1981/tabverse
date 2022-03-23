import { Note, NOTE_DB_TABLE_NAME } from './Note';

import { db } from '../../store/db';
import { getLogger } from '../../store/store';
import { map } from 'lodash';
import { ALLNOTE_DB_TABLE_NAME } from './AllNote';

export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('note dbAuditor start to process...');
  const notesData = await db.table<Note>(NOTE_DB_TABLE_NAME).toArray();
  const audit = async (noteData: Note) => {
    const c = await db
      .table(ALLNOTE_DB_TABLE_NAME)
      .where('noteIds')
      .anyOf(noteData.id)
      .count();
    if (c > 0) {
      // found one, valid
    } else {
      logger(`note ${noteData.id} is an orphan, need to be purged.`);
      await db.table(NOTE_DB_TABLE_NAME).delete(noteData.id);
      logger(`note ${noteData.id} purged.`);
    }
  };
  await Promise.all(map(notesData, (noteData) => audit(noteData)));
  logger('note dbAuditor finished processing.');
}
