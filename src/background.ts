import { dbAuditor as bookmarkDbAuditor } from './data/bookmark/dbAuditor';
import { dbAuditor as closedTabDbAuditor } from './data/closedTab/dbAuditor';
import { bootstrap as fullTextBootstrap, isDbEmpty } from './fullTextSearch';
import { logger } from './global';
import { monitorFullTextSearchMsg } from './background/fullTextSearch/chromeMessage';
import { dbAuditor as noteDbAuditor } from './data/note/dbAuditor';
import { reIndexAll } from './background/fullTextSearch/reIndexAll';
import { dbAuditor as tabSpaceDbAuditor } from './data/tabSpace/dbAuditor';
import { dbAuditor as todoDbAuditor } from './data/todo/dbAuditor';
import { setDebugLogLevel, TabSpaceLogLevel } from './debug';
import {
  dbAuditAndClearance,
  registerDbAuditor,
} from './storage/dbAuditorManager';
import { startBackgroundSync } from './data/repo/backgroundSync';

setDebugLogLevel(TabSpaceLogLevel.LOG);

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ active: true }, (tabs) => {
    tabs[0] && chrome.tabs.reload(tabs[0].id);
  });
});

logger.info('Tabverse background job start!');

logger.info('register db auditors...');
registerDbAuditor(tabSpaceDbAuditor);
registerDbAuditor(todoDbAuditor);
registerDbAuditor(noteDbAuditor);
registerDbAuditor(bookmarkDbAuditor);
registerDbAuditor(closedTabDbAuditor);
//dbAuditAndClearance();

logger.info('listen to idle state...');
chrome.idle.onStateChanged.addListener(
  (newState: `${chrome.idle.IdleState}`) => {
    logger.info('chrome idle state change:', newState);
    if (newState === 'idle' || newState === 'locked') {
      logger.info(
        'chrome is now idle or locked, will then perform db audit and clearance.',
      );
      dbAuditAndClearance();
    }
  },
);

// Server sync (server <-> local). No-op when the device has not been paired,
// which keeps local-only usage intact.
logger.info('start server sync runtime...');
void startBackgroundSync();

logger.info('bootstrap full text search service...');
fullTextBootstrap();
logger.info('full text service is ready.');
monitorFullTextSearchMsg();
isDbEmpty().then((empty) => {
  if (empty) {
    reIndexAll();
  }
});
