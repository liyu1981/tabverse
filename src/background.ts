import { dbAuditor as bookmarkDbAuditor } from './data/bookmark/dbAuditor';
import { dbAuditor as closedTabDbAuditor } from './data/closedTab/dbAuditor';
import { logger } from './global';
import { dbAuditor as noteDbAuditor } from './data/note/dbAuditor';
import { dbAuditor as tabSpaceDbAuditor } from './data/tabSpace/dbAuditor';
import { dbAuditor as todoDbAuditor } from './data/todo/dbAuditor';
import { setDebugLogLevel, TabSpaceLogLevel } from './debug';
import {
  dbAuditAndClearance,
  registerDbAuditor,
} from './storage/dbAuditorManager';
import { startBackgroundSync } from './data/repo/backgroundSync';
import { forgetPreview } from './data/tabSpace/tabPreviewStore';
import { describeReap, reapPreviews } from './data/tabSpace/previewReaper';
import {
  currentPreviewSessionId,
  isPreviewSessionSwept,
  markPreviewSessionSwept,
} from './data/tabSpace/previewSession';

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

// Tab previews (src/data/tabSpace/previewReaper). The table is a cache of
// thumbnails keyed by chrome tab id, so it is only ever worth keeping while
// those tabs are open; this worker owns every delete of it - on a five minute
// alarm, once per browser run, and the moment a tab goes away - so that no page
// ever spends its own heap sweeping it.
logger.info('start tab preview reaper...');
startPreviewReaper();

const PREVIEW_REAP_ALARM = 'tabverse_preview_reap';

function startPreviewReaper(): void {
  // Every delete of the table, from here on. Chrome wakes a service worker for
  // these events, and the tab events carry the id whose row is now unowned.
  chrome.tabs.onRemoved.addListener((chromeTabId: number) => {
    void forgetPreview(chromeTabId);
  });
  chrome.tabs.onDetached.addListener((chromeTabId: number) => {
    void forgetPreview(chromeTabId);
  });

  // Created only when it is missing: `create` on every worker start would push
  // the period out each time the worker woke up. Independent of the sweep below,
  // so neither can be skipped by the other failing.
  void chrome.alarms
    .get(PREVIEW_REAP_ALARM)
    .then(async (existing) => {
      if (!existing) {
        await chrome.alarms.create(PREVIEW_REAP_ALARM, {
          periodInMinutes: 5,
        });
        logger.info('tab preview reap alarm created (every 5 minutes)');
      }
    })
    .catch((err) =>
      logger.error('could not start the preview reap alarm', err),
    );

  void sweepPreviewsOncePerSession().catch((err) =>
    logger.error('the preview sweep failed', err),
  );

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== PREVIEW_REAP_ALARM) {
      return;
    }
    void reapPreviews().then((report) => {
      const line = describeReap(report);
      if (line) {
        logger.info(line);
      }
    });
  });
}

/**
 * The sweep that matters most: everything an earlier browser run wrote is
 * unowned, and it is the run that stops a previous run's thumbnail from being
 * shown on a chrome tab id that has since been recycled. Guarded by the session
 * id in chrome.storage.session, so the worker being torn down and woken again
 * (every idle timeout, every message) does not repeat it.
 */
async function sweepPreviewsOncePerSession(): Promise<void> {
  const sessionId = await currentPreviewSessionId();
  if (await isPreviewSessionSwept(sessionId)) {
    return;
  }
  const report = await reapPreviews();
  await markPreviewSessionSwept(sessionId);
  const line = describeReap(report);
  if (line) {
    logger.info(line);
  }
}
