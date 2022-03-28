import { dbAuditor as bookmarkDbAuditor } from './data/bookmark/dbAuditor';
import { bootstrap as fullTextBootstrap, isDbEmpty } from './fullTextSearch';
import { logger } from './global';
import { monitorChromeTabChanges } from './background/session';
import { monitorFullTextSearchMsg } from './background/fullTextSearch/chromeMessage';
import { dbAuditor as noteDbAuditor } from './data/note/dbAuditor';
import { reIndexAll } from './background/fullTextSearch/reIndexAll';
import { startAutoExportToDropbox } from './dropbox';
import { dbAuditor as tabSpaceDbAuditor } from './data/tabSpace/dbAuditor';
import { dbAuditor as todoDbAuditor } from './data/todo/dbAuditor';
import { setDebugLogLevel, TabSpaceLogLevel } from './debug';
import {
  dbAuditAndClearance,
  registerDbAuditor,
} from './store/dbAuditorManager';

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
//dbAuditAndClearance();

logger.info('listen to idle state...');
chrome.idle.onStateChanged.addListener((newState: chrome.idle.IdleState) => {
  logger.info('chrome idle state change:', newState);
  if (newState === 'idle' || newState === 'locked') {
    logger.info(
      'chrome is now idle or locked, will then perform db audit and clearance.',
    );
    dbAuditAndClearance();
  }
});

logger.info('monitor chrome tab changes...');
// setupSessionSaver();
const BACKGROUND_DEBOUNCE_TIME = 2 * 1000;
monitorChromeTabChanges(BACKGROUND_DEBOUNCE_TIME);

logger.info('bootstrap full text search service...');
fullTextBootstrap();
logger.info('full text service is ready.');
monitorFullTextSearchMsg();
isDbEmpty().then((empty) => {
  if (empty) {
    reIndexAll();
  }
});

// TODO: temporary leave the dropbox auto backup feature behind, as currently
// there is no good way of dealing with local settings across tabs/background
// worker
// setup dropbox auto backup
// const BACKGROUND_AUTO_BACKUP_PERIOD_IN_MINUTES = 5;
// startAutoExportToDropbox(BACKGROUND_AUTO_BACKUP_PERIOD_IN_MINUTES);
