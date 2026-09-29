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
import {
  countSavedTabSpaces,
  loadTabSpacesByIds,
  queryRecentSavedTabSpaces,
} from '../../data/tabSpace/util';
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
        const count = await countSavedTabSpaces();
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
    currentTabSpace?.name || currentTabSpaceId || 'the current tabverse';

  const close = () => window.close();

  const openUrlInCurrentWindow = (url: string) => {
    openTabverseUrlInWindow(url, currentWindowId, openTabSpaces)
      .then(close)
      .catch((err) => {
        logger.error('popup could not open the tabverse', err);
        close();
      });
  };

  const createNewTabSpace = () => {
    if (currentTabSpaceId) {
      setPendingReplace({
        url: tabverseUrl(TabSpaceOp.New),
        title: 'Start a new tabverse in this window?',
        body: `This window already has a tabverse ("${currentTabSpaceName}"). It is saved automatically, so nothing is lost. Continuing closes it here and starts a new tabverse; the tabs in this window become part of it.`,
      });
      return;
    }
    openUrlInCurrentWindow(tabverseUrl(TabSpaceOp.New));
  };

  const openInThisWindow = (tabSpace: TabSpace) => {
    if (currentTabSpaceId) {
      setPendingReplace({
        url: tabverseUrl(TabSpaceOp.LoadSaved, tabSpace.id),
        title: 'Replace the tabverse in this window?',
        body: `This window already has a tabverse ("${currentTabSpaceName}"). It is saved automatically, so nothing is lost. Continuing closes it here and loads the ${tabSpace.tabs.size} tab(s) of "${tabSpace.name}" into this window.`,
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
      return <div className={classes.notice}>Loading…</div>;
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
      return (
        <div className={classes.notice}>
          No tabverse saved yet. Every window you keep with Tabverse becomes
          one, and shows up here afterwards.
        </div>
      );
    }
    return (
      <div className={classes.notice}>
        {isSearching
          ? 'Nothing found. Try fewer words, or a word from a tab title.'
          : 'Nothing recent. Open a tabverse in a window and it shows up here.'}
      </div>
    );
  };

  return (
    <div className={classes.container}>
      <div className={classes.header}>
        <span className={classes.headerTitle}>Tabverse</span>
        <span>{`${savedCount} saved`}</span>
      </div>
      <div className={classes.createContainer}>
        <Button
          className={classes.createButton}
          icon="plus"
          intent={Intent.PRIMARY}
          text="New tabverse"
          title={
            currentTabSpaceId
              ? 'Saves the current tabverse and starts a new one in this window'
              : 'Starts a new tabverse in this window'
          }
          onClick={createNewTabSpace}
        />
      </div>
      <div className={classes.searchContainer}>
        <InputGroup
          leftIcon="search"
          placeholder="search saved tabverses…"
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
            ? `${tabSpaces.length} result${tabSpaces.length === 1 ? '' : 's'}`
            : 'Recent'}
        </div>
        {renderList()}
      </div>
      {isSearching && loadStatus === LoadStatus.Done ? (
        <div className={classes.status}>
          {searchBackend === 'server'
            ? 'searched on the sync server'
            : 'searched on this device'}
          {unknownCount > 0
            ? ` · ${unknownCount} match${unknownCount === 1 ? '' : 'es'} not downloaded yet`
            : ''}
        </div>
      ) : (
        ''
      )}
      <Alert
        isOpen={pendingReplace !== null}
        canEscapeKeyCancel={true}
        canOutsideClickCancel={true}
        confirmButtonText="Replace"
        cancelButtonText="Cancel"
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
