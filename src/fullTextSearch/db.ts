import { logger } from '../global';
import {
  FullTextSearchDatabase,
  INDEX_TABLE_NAME,
} from './FullTextSearchDatabase';

let _db: FullTextSearchDatabase | null = null;

export function bootstrap() {
  _db = new FullTextSearchDatabase();
  logger.log('bootstrap full text search, done.');
}

export function getDb(): FullTextSearchDatabase | null {
  return _db;
}

export async function isDbEmpty(): Promise<boolean> {
  const count = await getDb().table(INDEX_TABLE_NAME).count();
  return count <= 0;
}
