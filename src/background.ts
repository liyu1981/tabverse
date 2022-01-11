import { dbAuditAndClearance, registerDbAuditor } from './store/store';
import {
  monitorChromeTabChanges,
  dbAuditor as sessionSaverDbAuditor,
} from './data/chromeSession/sessionSaver';

import { dbAuditor as bookmarkDbAuditor } from './data/bookmark/bookmarkDbAuditor';
import { logger } from './global';
import { dbAuditor as noteDbAuditor } from './data/note/noteDbAuditor';
import { startAutoExportToDropbox } from './dropbox';
import { dbAuditor as tabSpaceDbAuditor } from './data/tabSpace/tabSpaceDbAuditor';
import { dbAuditor as todoDbAuditor } from './data/todo/todoDbAuditor';

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ active: true }, (tabs) => {
    tabs[0] && chrome.tabs.reload(tabs[0].id);
  });
});

logger.info('Tabverse background job start!');

registerDbAuditor(tabSpaceDbAuditor);
registerDbAuditor(todoDbAuditor);
registerDbAuditor(noteDbAuditor);
registerDbAuditor(bookmarkDbAuditor);
registerDbAuditor(sessionSaverDbAuditor);
//dbAuditAndClearance();

chrome.idle.onStateChanged.addListener((newState: chrome.idle.IdleState) => {
  logger.info('chrome idle state change:', newState);
  if (newState === 'idle' || newState === 'locked') {
    logger.info(
      'chrome is now idle or locked, will then perform db audit and clearance.',
    );
    dbAuditAndClearance();
  }
});

// setupSessionSaver();
const BACKGROUND_DEBOUNCE_TIME = 2 * 1000;
monitorChromeTabChanges(BACKGROUND_DEBOUNCE_TIME);

// TODO: temporary leave the dropbox auto backup feature behind, as currently
// there is no good way of dealing with local settings across tabs/background
// worker
// setup dropbox auto backup
// const BACKGROUND_AUTO_BACKUP_PERIOD_IN_MINUTES = 5;
// startAutoExportToDropbox(BACKGROUND_AUTO_BACKUP_PERIOD_IN_MINUTES);
