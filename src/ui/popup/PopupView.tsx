import { Alert, Button, Classes, InputGroup, Intent } from '@blueprintjs/core';
import {
  ANY_SCOPE,
  Query,
  SearchBackend,
  searchSavedTabSpaces,
} from '../../data/search';
import { LoadStatus, TabSpaceOp, logger } from '../../global';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SavedTabSpaceRow } from './SavedTabSpaceRow';
import { TabSpace } from '../../data/tabSpace/TabSpace';
import { querySavedTabSpaceCount } from '../../data/tabSpace/store';
import {
  loadTabSpacesByIds,
  queryRecentSavedTabSpaces,
} from '../../data/tabSpace/util';
import { importTabverseFile } from '../../data/tabSpace/importTabSpace';
import {
  OpenTabSpace,
  openTabSpaceOfWindow,
  openTabverseUrlInWindow,
  queryOpenTabSpaces,
  switchToOpenTabSpace,
  windowCountOfTabSpace,
} from '../../data/tabSpace/openTabverses';
import {
  restoreSavedTabSpaceUtil,
  tabverseUrl,
} from '../../data/tabSpace/chromeUtil';
import { randomSidebarColor } from '../../data/tabSpace/sidebarColor';
import { loadSidebarRandomOnCreate } from '../../data/tabSpace/sidebarColorSettings';
import { t } from '../../i18n';
import classes from './PopupView.module.scss';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * The plain search box maps to one AND-group with the "anywhere" scope, so
 * "pasta basics" looks for both words together, anywhere - the same thing the
 * scoped tag input builds, without the per-term scope picker that does not fit
 * in 420px.
 */
function buildQuery(text: string): Query {
  const terms = text
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  if (terms.length <= 0) {
    return new Query({ andQueries: [] });
  }
  return new Query({ andQueries: [] }).addAndQuery(terms, ANY_SCOPE);
}

/** What the user is about to do to the window the popup was opened from. */
interface PendingReplace {
  url: string;
  title: string;
  body: string;
}

export function PopupView() {
  const [text, setText] = useState<string>('');
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(LoadStatus.Loading);
  const [tabSpaces, setTabSpaces] = useState<TabSpace[]>([]);
  const [currentTabSpace, setCurrentTabSpace] = useState<TabSpace | null>(null);
  const [savedCount, setSavedCount] = useState<number>(0);
  const [searchBackend, setSearchBackend] = useState<SearchBackend | null>(
    null,
  );
  const [unknownCount, setUnknownCount] = useState<number>(0);
  const [openTabSpaces, setOpenTabSpaces] = useState<OpenTabSpace[]>([]);
  const [currentWindowId, setCurrentWindowId] = useState<number>(-1);
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(
    null,
  );
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  // bumped by the Enter key, which wants the search to happen now
  const [searchNonce, setSearchNonce] = useState<number>(0);

  // a slow search must not overwrite the result of a newer one
  const requestSeq = useRef<number>(0);
  // the first load and every Enter run right away; typing is debounced
  const isFirstRun = useRef<boolean>(true);
  const lastSearchNonce = useRef<number>(-1);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const currentWindow = await chrome.windows.getCurrent();
        if (!cancelled && currentWindow?.id !== undefined) {
          setCurrentWindowId(currentWindow.id);
        }
        const open = await queryOpenTabSpaces();
        const count = await querySavedTabSpaceCount();
        if (!cancelled) {
          setOpenTabSpaces(open);
          setSavedCount(count);
        }
      } catch (err) {
        // the "open in N windows" badges and the replace warning are
        // refinements; a popup that cannot read them is still useful
        logger.error('popup could not read the browser state', err);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTabSpaceId = useMemo(
    () => openTabSpaceOfWindow(openTabSpaces, currentWindowId)?.tabSpaceId,
    [openTabSpaces, currentWindowId],
  );

  useEffect(() => {
    const run = async () => {
      requestSeq.current += 1;
      const seq = requestSeq.current;
      setLoadStatus(LoadStatus.Loading);
      const query = buildQuery(text);
      let rows: TabSpace[] = [];
      let backend: SearchBackend | null = null;
      let unknown = 0;
      try {
        if (query.isEmpty()) {
          rows = await queryRecentSavedTabSpaces();
        } else {
          const result = await searchSavedTabSpaces(query);
          rows = result.tabSpaces;
          backend = result.backend;
          unknown = result.unknownTabSpaceIds.length;
        }
      } catch (err) {
        logger.error('popup search failed', err);
        rows = [];
      }
      const current = currentTabSpaceId
        ? await loadTabSpacesByIds([currentTabSpaceId])
        : [];
      if (seq !== requestSeq.current) {
        return;
      }
      setTabSpaces(rows);
      setCurrentTabSpace(current[0] ?? null);
      setSearchBackend(backend);
      setUnknownCount(unknown);
      setLoadStatus(LoadStatus.Done);
    };

    const entered = searchNonce !== lastSearchNonce.current;
    lastSearchNonce.current = searchNonce;
    if (isFirstRun.current || entered) {
      isFirstRun.current = false;
      void run();
      return undefined;
    }
    const timer = setTimeout(() => void run(), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, searchNonce, currentTabSpaceId]);

  const currentTabSpaceName =
    currentTabSpace?.name ||
    currentTabSpaceId ||
    t('popupCurrentTabverseFallback');

  const close = () => window.close();

  const openUrlInCurrentWindow = (url: string) => {
    openTabverseUrlInWindow(url, currentWindowId, openTabSpaces)
      .then(close)
      .catch((err) => {
        logger.error('popup could not open the tabverse', err);
        close();
      });
  };

  const createNewTabSpace = async () => {
    // The colour is rolled here, where the tabverse is created: the opener is
    // the only place that knows this is a *new* tabverse (the id is in every
    // url), and the colour rides in the url so a reload keeps it.
    const random = await loadSidebarRandomOnCreate();
    const color = random ? randomSidebarColor() : undefined;
    const url = tabverseUrl(TabSpaceOp.New, undefined, color);
    if (currentTabSpaceId) {
      setPendingReplace({
        url,
        title: t('popupReplaceNewTitle'),
        body: t('popupReplaceNewBody', [currentTabSpaceName]),
      });
      return;
    }
    openUrlInCurrentWindow(url);
  };

  // An import is a new, independent tabverse: every id in the file is reminted,
  // so it never collides with what is already here. It lands in the saved list
  // (as the newest row), it does not open.
  const onImportFile = async (file: File) => {
    try {
      const result = await importTabverseFile(file);
      setImportStatus(t('popupImportedOk', [result.name]));
      setText('');
      setSearchNonce((nonce) => nonce + 1);
    } catch (err) {
      logger.error('popup could not import the tabverse', err);
      setImportStatus(t('popupImportFailed'));
    }
  };

  const openInThisWindow = (tabSpace: TabSpace) => {
    if (currentTabSpaceId) {
      setPendingReplace({
        url: tabverseUrl(TabSpaceOp.LoadSaved, tabSpace.id),
        title: t('popupAddToWindowTitle'),
        body: t('popupAddToWindowBody', [
          currentTabSpaceName,
          tabSpace.name,
          String(tabSpace.tabs.size),
        ]),
      });
      return;
    }
    openUrlInCurrentWindow(tabverseUrl(TabSpaceOp.LoadSaved, tabSpace.id));
  };

  const openInNewWindow = (tabSpace: TabSpace) => {
    restoreSavedTabSpaceUtil(tabSpace.id);
    close();
  };

  const switchToOpen = (tabSpace: TabSpace) => {
    const open = openTabSpaces.find(
      (candidate) => candidate.tabSpaceId === tabSpace.id,
    );
    if (!open) {
      return;
    }
    switchToOpenTabSpace(open)
      .then(close)
      .catch((err) => {
        logger.error('popup could not switch window', err);
        close();
      });
  };

  // the copy in this window is shown first, and not repeated in the list below
  const listedTabSpaces = tabSpaces.filter(
    (tabSpace) => tabSpace.id !== currentTabSpaceId,
  );
  const isSearching = text.trim().length > 0;
  const nothingSaved = savedCount <= 0;

  const renderRow = (tabSpace: TabSpace, isCurrentWindow: boolean) => (
    <SavedTabSpaceRow
      key={tabSpace.id}
      tabSpace={tabSpace}
      openWindowCount={windowCountOfTabSpace(openTabSpaces, tabSpace.id)}
      isCurrentWindow={isCurrentWindow}
      openInNewWindow={openInNewWindow}
      openInThisWindow={openInThisWindow}
      switchToOpen={switchToOpen}
    />
  );

  const renderList = () => {
    if (loadStatus === LoadStatus.Loading) {
      return <div className={classes.notice}>{t('popupLoading')}</div>;
    }
    if (currentTabSpace || listedTabSpaces.length > 0) {
      return (
        <>
          {currentTabSpace ? renderRow(currentTabSpace, true) : ''}
          {listedTabSpaces.map((tabSpace) => renderRow(tabSpace, false))}
        </>
      );
    }
    if (nothingSaved) {
      return <div className={classes.notice}>{t('popupNothingSaved')}</div>;
    }
    return (
      <div className={classes.notice}>
        {isSearching ? t('popupNothingFound') : t('popupNothingRecent')}
      </div>
    );
  };

  return (
    <div className={classes.container}>
      <div className={classes.header}>
        <span className={classes.headerTitle}>{t('extName')}</span>
        <span>{t('popupSavedCount', [String(savedCount)])}</span>
      </div>
      <div className={classes.createContainer}>
        <Button
          className={`tv-primary-button ${classes.createButton}`}
          icon="plus"
          text={t('popupNewTabverse')}
          title={
            currentTabSpaceId
              ? t('popupNewTabverseTitleWhenOpen')
              : t('popupNewTabverseTitle')
          }
          onClick={() => {
            void createNewTabSpace();
          }}
        />
        <Button
          icon="import"
          text={t('popupImport')}
          title={t('popupImportTitle')}
          onClick={() => importInputRef.current?.click()}
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".tabverse,application/json"
          className={classes.importInput}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            // clearing the value lets the same file be chosen twice in a row
            event.currentTarget.value = '';
            if (file) void onImportFile(file);
          }}
        />
      </div>
      {importStatus ? (
        <div className={classes.notice}>{importStatus}</div>
      ) : null}
      <div className={classes.searchContainer}>
        <InputGroup
          leftIcon="search"
          placeholder={t('popupSearchPlaceholder')}
          disabled={nothingSaved}
          value={text}
          onValueChange={setText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              // skip the debounce; the nonce makes the effect re-run even when
              // the text did not change
              setSearchNonce((nonce) => nonce + 1);
            }
          }}
        />
      </div>
      <div className={classes.listContainer}>
        <div className={classes.listHeading}>
          {isSearching
            ? t(tabSpaces.length === 1 ? 'popupResultOne' : 'popupResultMany', [
                String(tabSpaces.length),
              ])
            : t('popupRecent')}
        </div>
        {renderList()}
      </div>
      {isSearching && loadStatus === LoadStatus.Done ? (
        <div className={classes.status}>
          {searchBackend === 'server'
            ? t('popupSearchedOnServer')
            : t('popupSearchedOnDevice')}
          {unknownCount > 0
            ? ` · ${t(
                unknownCount === 1
                  ? 'popupNotDownloadedOne'
                  : 'popupNotDownloadedMany',
                [String(unknownCount)],
              )}`
            : ''}
        </div>
      ) : (
        ''
      )}
      <Alert
        isOpen={pendingReplace !== null}
        canEscapeKeyCancel={true}
        canOutsideClickCancel={true}
        confirmButtonText={t('popupConfirmReplace')}
        cancelButtonText={t('popupCancel')}
        intent={Intent.WARNING}
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => {
          const pending = pendingReplace;
          setPendingReplace(null);
          if (pending) {
            openUrlInCurrentWindow(pending.url);
          }
        }}
      >
        <h4 className={Classes.DIALOG_HEADER}>{pendingReplace?.title}</h4>
        {pendingReplace?.body}
      </Alert>
    </div>
  );
}
