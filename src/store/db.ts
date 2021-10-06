import { isJestTest } from '../debug';
import { TabSpaceDatabase } from './TabSpaceDatabase';

export * from './TabSpaceDatabase';
export const db: TabSpaceDatabase = isJestTest()
  ? require('../dev/dbImplTest').dbImpl
  : require('./dbImpl').dbImpl;
