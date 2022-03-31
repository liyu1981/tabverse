import { logger } from '../global';
import { BackgroundMsg, sendChromeMessage } from '../message/message';

const dbAuditors = [];

export type DbAuditor = (logs: string[]) => Promise<void>;

export const getLogger = (logs: string[]) => (msg: string) => {
  logger.info(msg);
  logs.push(msg);
};

export function registerDbAuditor(dbAuditor: DbAuditor): void {
  dbAuditors.push(dbAuditor);
}

export async function dbAuditAndClearance() {
  const logs: string[] = [];
  await Promise.all(dbAuditors.map((dbAuditor: DbAuditor) => dbAuditor(logs)));
  sendChromeMessage({
    type: BackgroundMsg.AuditComplete,
    payload: logs,
  });
}
