import { t } from '../../../i18n';
import { $allBookmark, bookmarkStoreApi } from '../../../data/bookmark/store';
import { $tabSpace, $tabSpacePreviewCache } from '../../../data/tabSpace/store';
import {
  Button,
  ButtonGroup,
  EditableText,
  Menu,
  MenuItem,
  Popover,
  Tooltip,
} from '@blueprintjs/core';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { findTabById } from '../../../data/tabSpace/TabSpace';
import { groupOfTab } from '../../../data/tabSpace/tabGroup';
import {
  newEmptyBookmark,
  setFavIconUrl,
  setName,
  setUrl,
} from '../../../data/bookmark/Bookmark';

import { CapabilityWarning } from './CapabilityWarning';
import { DedupAdvisorNotice } from './DedupAdvisorNotice';
import { SuggestNameButton } from './SuggestNameButton';
import { ActiveTabSearch } from './ActiveTabSearch';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { List } from 'immutable';
import { MoveToExistTabSpaceDialog } from '../../dialog/MoveToExistTabSpace';
import { SaveIndicator } from './SaveIndicator';
import { GroupTabs, SplitBlock, TabGroupBlock } from './TabGroupBlock';
import { Tab } from '../../../data/tabSpace/Tab';
import { TabCard } from './TabCard';
import { TabContentButton } from './TabContentButton';
import classes from './TabSpaceListView.module.scss';
import { getPreview } from '../../../data/tabSpace/TabPreviewCache';
import { hydratePreview } from '../../../data/tabSpace/tabPreviewStore';
import { logger } from '../../../global';
import { saveAndCloseTabSpace } from '../../../data/tabSpace/closeTabSpace';
import { saveCurrentBookmarks } from '../../../data/bookmark/util';
import { exportTabVerse } from '../../../data/tabSpace/exportTabSpace';
import {
  tabverseEntries,
  tabverseTabs,
} from '../../../data/tabSpace/tabEntries';
import {
  activeTabFilterTerms,
  matchActiveTabs,
} from '../../../data/tabSpace/activeTabFilter';
import { convertTabToMarkdown } from '../../../data/tabSpace/pageMarkdown';
import { extractTabText } from '../../../data/tabSpace/tabText';
import { markdownToPlainText } from '../../../data/note/markdownText';
import { focusLiveTabUtil } from '../../../data/tabSpace/chromeUtil';
import {
  getWhitelistedUrls,
  loadWhitelist,
  subscribeWhitelist,
  toggleWhitelisted,
} from '../../../data/tabSpace/suspendWhitelist';
import { updateTabSpaceName } from '../../../data/tabSpace/chromeTab';
import { type NameTab } from '../../../ai/naming';
import { useStore } from 'effector-react';
import clsx from 'clsx';

enum SelectedTabTool {
  MoveToExistTabverse = 'Move to Exist Tabverse',
}

/**
 * How many tabs one filter pass may read the *page content* of. A tab whose
 * title or url already matches is not read at all, so this is the budget for
 * the remaining "maybe it is in the body" candidates - and each one costs a
 * script injection, a full-page clone and a worker (`pageMarkdown.ts`). Twenty
 * keeps one keystroke from turning a two-hundred-tab window into two hundred
 * concurrent conversions; the next pass (the next tab event) continues where
 * this one stopped.
 */
const MAX_PAGE_TEXT_EXTRACTIONS_PER_PASS = 20;

interface SelectedTabToolControlProps {
  className: string;
  onClick: (currentTool: SelectedTabTool) => void | Promise<void>;
}

function SelectedTabToolControl(props: SelectedTabToolControlProps) {
  const [currentTool, setCurrentTool] = useState<SelectedTabTool>(
    SelectedTabTool.MoveToExistTabverse,
  );

  const content = (
    <Menu>
      {Object.keys(SelectedTabTool).map((key) => {
        const text = SelectedTabTool[key];
        return (
          <MenuItem
            key={key}
            text={text}
            onClick={() => setCurrentTool(text as SelectedTabTool)}
          ></MenuItem>
        );
      })}
    </Menu>
  );
  return (
    <ButtonGroup className={props.className}>
      <Button onClick={() => props.onClick(currentTool)}>{currentTool}</Button>
      <Popover placement="bottom-end" content={content}>
        <Button icon="symbol-triangle-down"></Button>
      </Popover>
    </ButtonGroup>
  );
}

export function TabSpaceListView() {
  const tabSpace = useStore($tabSpace);
  const tabPreviewCache = useStore($tabSpacePreviewCache);
  const allBookmark = useStore($allBookmark);

  // The tabverse's never-suspend list, device-local (data/tabSpace/
  // suspendWhitelist). The store returns a stable set until the whitelist
  // changes, so this re-renders exactly when it should.
  useEffect(() => {
    void loadWhitelist();
  }, []);
  const whitelistedUrls = useSyncExternalStore(
    subscribeWhitelist,
    () => getWhitelistedUrls(tabSpace.id),
    () => getWhitelistedUrls(tabSpace.id),
  );

  const isBookmarked = (url: string): boolean => {
    return (
      allBookmark.bookmarks.findIndex((bookmark) => bookmark.url === url) >= 0
    );
  };

  const [title, setTitle] = useState(tabSpace.name);
  const [selectedTabs, setSelectedTabs] = useState<List<Tab>>(List());
  const [isMoveToExistTabSpaceDialogOpen, setIsMoveToExistTabSpaceDialogOpen] =
    useState(false);
  const [isClosing, setIsClosing] = useState(false);
  // the filter box over the live tabs; empty means the whole list, unchanged
  const [filterText, setFilterText] = useState<string>('');
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // in-memory cache of extracted page text, keyed by chrome tab id. Session
  // only: nothing here is synced or persisted (see the page-content search plan).
  // It is pruned to the tabs that are still open (below): a chrome tab id is
  // recycled, and a tab that is gone must not leave its 12 kB of page text in
  // the heap for the rest of the page's life.
  const [tabTextByChromeTabId, setTabTextByChromeTabId] = useState<
    Record<number, string | null>
  >({});
  const tabTextRef = useRef(tabTextByChromeTabId);
  useEffect(() => {
    tabTextRef.current = tabTextByChromeTabId;
  }, [tabTextByChromeTabId]);
  // What the extraction loop compares against: the filter as it is *now*, not
  // as it was when the effect started, so a tab whose title or url already
  // matches is not read from the page.
  const filterTextRef = useRef(filterText);
  filterTextRef.current = filterText;
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isFiltering = filterText.trim().length > 0;

  // the window's own order, flattened: the box ranks matches, so it cannot
  // hand them back nested in the group and split blocks they came from
  const orderedTabs = useMemo(() => tabverseTabs(tabSpace), [tabSpace]);
  const matched = useMemo(
    () => matchActiveTabs(orderedTabs, filterText, tabTextByChromeTabId),
    [orderedTabs, filterText, tabTextByChromeTabId],
  );
  const matchedTabs = useMemo(() => matched.map((m) => m.tab), [matched]);
  const matchFieldByTabId = useMemo(
    () => Object.fromEntries(matched.map((m) => [m.tab.id, m.field])),
    [matched],
  );

  // Extract page text lazily while the filter is active, so a query can match
  // the rendered content of the tabs that are on screen. Suspended and
  // unreadable tabs simply end up with no entry.
  //
  // Three limits, all of them about the memory and CPU a single filter pass can
  // cost when a window holds hundreds of tabs:
  //
  //  - a tab whose title or url already matches is skipped: the answer is
  //    already "this one", and reading its page would only add a weaker
  //    "content" badge;
  //  - at most `MAX_PAGE_TEXT_EXTRACTIONS_PER_PASS` tabs are read per pass, so
  //    one keystroke cannot start a hundred script injections and workers;
  //  - the reads are sequential, not concurrent: each conversion clones a page
  //    and runs Readability in a worker, and a hundred of those at once is the
  //    memory spike this loop used to cause (one worker per tab, created in the
  //    same tick).
  const pendingTextExtractions = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!isFiltering) {
      pendingTextExtractions.current.clear();
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      let budget = MAX_PAGE_TEXT_EXTRACTIONS_PER_PASS;
      for (const tab of orderedTabs) {
        if (cancelled || budget <= 0) {
          break;
        }
        if (tab.suspended || tab.chromeTabId <= 0) {
          continue;
        }
        if (Object.hasOwn(tabTextRef.current, tab.chromeTabId)) {
          continue;
        }
        if (pendingTextExtractions.current.has(tab.chromeTabId)) {
          continue;
        }
        if (matchActiveTabs([tab], filterTextRef.current).length > 0) {
          continue;
        }
        const chromeTabId = tab.chromeTabId;
        budget -= 1;
        pendingTextExtractions.current.add(chromeTabId);
        let text: string | null = null;
        try {
          const article = await convertTabToMarkdown(chromeTabId);
          if (article?.markdown) {
            text = markdownToPlainText(article.markdown);
          }
          if (!text) {
            text = await extractTabText(chromeTabId);
          }
        } catch {
          text = null;
        }
        pendingTextExtractions.current.delete(chromeTabId);
        if (cancelled) {
          break;
        }
        setTabTextByChromeTabId((prev) => ({
          ...prev,
          [chromeTabId]: text ? text.slice(0, 12000) : null,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isFiltering, orderedTabs]);

  const onActiveMatchChange = useCallback((tab: Tab | null) => {
    setActiveTabId(tab ? tab.id : null);
  }, []);

  // What the name suggester may read: titles and hosts of this tabverse's
  // tabs, nothing else (plan D5). Recomputed on tab change so a tab opened
  // a moment ago is in the next offer.
  const nameTabs = useMemo<NameTab[]>(
    () =>
      tabSpace.tabs
        .toArray()
        .map((tab) => ({ title: tab.title, url: tab.url })),
    [tabSpace.tabs],
  );

  // Applying a suggestion is exactly what typing the name does (plan D7):
  // local title state first, so the EditableText redraws, then the store
  // save that syncs it. No second write path.
  const applySuggestedName = useCallback((name: string) => {
    setTitle(name);
    updateTabSpaceName(name);
  }, []);

  // `/` focuses the box from anywhere on the page, unless the user is already
  // typing somewhere - in the note editor or a text field `/` is just a slash
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // a tab can be closed while the box is filtering over the list, and its page
  // text would otherwise stay in the heap for the rest of the page's life
  useEffect(() => {
    if (activeTabId && !tabSpace.tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(null);
    }
    const liveChromeTabIds = new Set(
      tabSpace.tabs.map((tab) => tab.chromeTabId).toArray(),
    );
    setTabTextByChromeTabId((prev) => {
      const kept = Object.entries(prev).filter(([id]) =>
        liveChromeTabIds.has(Number(id)),
      );
      if (kept.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(kept);
    });
  }, [activeTabId, tabSpace.tabs]);

  // A hovered row asks for its stored thumbnail. The in-memory cache is a
  // bounded window now (TabPreviewCache), so a picture that fell out of it is
  // read back from the preview table when it is actually wanted - not at
  // bootstrap, where it used to cost a read (and a base64 string) per tab.
  const onNeedPreview = useCallback((chromeTabId: number) => {
    void hydratePreview(chromeTabId);
  }, []);

  // The tabverse itself is saved on every tab event, so this button is not
  // about saving it: it flushes whatever is still pending (a note typed a
  // moment ago, say) and then closes the tabverse tab. The window's other tabs
  // stay open as ordinary Chrome tabs.
  const saveAndClose = async () => {
    if (isClosing) {
      return;
    }
    setIsClosing(true);
    try {
      await saveAndCloseTabSpace();
    } catch (err) {
      logger.error('could not save and close the tabverse', err);
      setIsClosing(false);
    }
  };

  // The export is a snapshot: it flushes pending edits, then hands the browser
  // one .tabverse file holding the tabverse and its notes, todos, bookmarks
  // and history. It does not touch the tabverse itself.
  const exportCurrentTabverse = async () => {
    try {
      await exportTabVerse(tabSpace.id, tabSpace.name);
    } catch (err) {
      logger.error('could not export the tabverse', err);
    }
  };

  useEffect(() => {
    setSelectedTabs((lastSelectedTabs) => {
      return lastSelectedTabs
        .filter((tab) => tabSpace.tabs.findIndex((t) => t.id === tab.id) >= 0)
        .toList();
    });
  }, [tabSpace.tabs]);

  const tabGroupOf = (tab: Tab) => groupOfTab(tabSpace.tabGroups, tab.id);

  const tabCard = (tab: Tab) => (
    <div
      key={tab.id}
      className={clsx(
        tabGroupOf(tab) ? classes.tabInGroup : '',
        isFiltering && tab.id === activeTabId ? classes.tabIsActiveMatch : '',
      )}
    >
      <ErrorBoundary>
        <TabCard
          tab={tab}
          matchField={isFiltering ? matchFieldByTabId[tab.id] : undefined}
          filterTerms={
            isFiltering ? activeTabFilterTerms(filterText) : undefined
          }
          pageText={
            isFiltering
              ? (tabTextByChromeTabId[tab.chromeTabId] ?? null)
              : undefined
          }
          needPreview={true}
          onNeedPreview={onNeedPreview}
          needSelector={true}
          tabPreview={getPreview(tab.chromeTabId, tabPreviewCache)}
          isBookmarked={isBookmarked(tab.url)}
          isWhitelisted={whitelistedUrls.has(tab.url)}
          onToggleWhitelist={(tab: Tab) => {
            void toggleWhitelisted(tabSpace.id, tab.url);
          }}
          actions={<TabContentButton tab={tab} tabSpaceId={tabSpace.id} />}
          onBookmark={(tab: Tab) => {
            bookmarkStoreApi.addBookmark(
              setFavIconUrl(
                tab.favIconUrl,
                setName(tab.title, setUrl(tab.url, newEmptyBookmark())),
              ),
            );
            saveCurrentBookmarks();
          }}
          onSelect={(tabId, selected) => {
            if (selected) {
              setSelectedTabs((lastSelected) =>
                lastSelected.push(findTabById(tabId, tabSpace)),
              );
            } else {
              setSelectedTabs((lastSelected) =>
                lastSelected.filter((tab) => tab.id !== tabId).toList(),
              );
            }
          }}
        />
      </ErrorBoundary>
    </div>
  );

  // Groups, split pairs and plain tabs come from the shared entry builder, so
  // this list and the saved tabverse list describe a tabverse the same way
  const tabEntries: React.ReactNode[] = [];
  if (isFiltering) {
    // a ranked, flat result list: the blocks exist to show the window's shape,
    // and a best-match-first answer to "which one is it" does not have one
    for (const tab of matchedTabs) {
      tabEntries.push(tabCard(tab));
    }
  } else {
    for (const entry of tabverseEntries(tabSpace)) {
      if (entry.kind === 'tab') {
        tabEntries.push(tabCard(entry.tab));
      } else if (entry.kind === 'split') {
        const [first, second] = entry.tabs as [Tab, Tab];
        tabEntries.push(
          <SplitBlock
            key={`split-${first.splitViewId}`}
            splitViewId={first.splitViewId}
          >
            {tabCard(first)}
            {tabCard(second)}
          </SplitBlock>,
        );
      } else if (entry.tabs.length > 0) {
        tabEntries.push(
          <TabGroupBlock
            key={`group-${entry.group.id}`}
            group={entry.group}
            tabCount={entry.tabs.length}
          >
            <div className={classes.tabInGroup}>
              <GroupTabs tabs={entry.tabs} card={tabCard} />
            </div>
          </TabGroupBlock>,
        );
      }
    }
  }

  const tabSpaceTitleView = (
    <div className={classes.titleContainer}>
      <div className={classes.titleMain}>
        <h1 className={classes.titleH1}>
          <EditableText
            className={classes.editableTextFullwidth}
            alwaysRenderInput={true}
            maxLength={256}
            value={title}
            selectAllOnFocus={false}
            onChange={(value) => setTitle(value)}
            onConfirm={() => updateTabSpaceName(title)}
          />
        </h1>
      </div>
      <div className={classes.titleButtons}>
        <SuggestNameButton
          tabs={nameTabs}
          tabSpaceId={tabSpace.id}
          title={title}
          onApply={applySuggestedName}
        />
        <Tooltip content={t('tabListSaveClose')} placement="bottom">
          <Button
            className="tv-icon-button"
            aria-label={t('tabListSaveCloseAria')}
            icon="floppy-disk"
            minimal={true}
            loading={isClosing}
            onClick={() => void saveAndClose()}
          />
        </Tooltip>
        <Tooltip content={t('tabListExport')} placement="bottom">
          <Button
            className="tv-icon-button"
            aria-label={t('tabListExportAria')}
            icon="export"
            minimal={true}
            onClick={() => void exportCurrentTabverse()}
          />
        </Tooltip>
      </div>
    </div>
  );

  const tabSpaceToolbarView = (
    <div className={classes.toolbarContainer}>
      <div className={classes.toolbarLeftContainer}>
        <div>
          <span>{t('tabListWorkingOn', [String(tabSpace.tabs.size)])}</span>
        </div>
      </div>
      {selectedTabs.size > 0 ? (
        <div className={classes.toolbarMiddleContainer}>
          <span className={classes.selectedTabsToolbarInfo}>
            {t(
              selectedTabs.size > 1
                ? 'tabListSelectedMany'
                : 'tabListSelectedOne',
              [String(selectedTabs.size)],
            )}
          </span>
          <SelectedTabToolControl
            className={classes.selectedTabsToolbarToolControl}
            onClick={(currentTool) => {
              if (currentTool === SelectedTabTool.MoveToExistTabverse) {
                setIsMoveToExistTabSpaceDialogOpen(true);
              }
            }}
          />
        </div>
      ) : null}
      <div className={classes.toolbarRightContainer}>
        <SaveIndicator />
      </div>
    </div>
  );

  const tabSpaceHeaderView = (
    <div className={classes.stickyOn}>
      <div className={classes.header}>
        {tabSpaceTitleView}
        <ActiveTabSearch
          value={filterText}
          onChange={setFilterText}
          matches={matchedTabs}
          totalCount={orderedTabs.length}
          inputRef={searchInputRef}
          onActivate={(tab: Tab) => void focusLiveTabUtil(tab)}
          onActiveMatchChange={onActiveMatchChange}
        />
        {tabSpaceToolbarView}
      </div>
    </div>
  );

  return (
    <div className={classes.container}>
      {tabSpaceHeaderView}
      <CapabilityWarning />
      <DedupAdvisorNotice />
      <div className={classes.tabEntriesContainer}>{tabEntries}</div>
      {isFiltering && matchedTabs.length <= 0 ? (
        <div className={classes.noMatchNotice}>
          {`No tab of "${tabSpace.name || 'this tabverse'}" matches.`}
        </div>
      ) : null}
      <div className={classes.bottomPlaceholder}></div>
      <MoveToExistTabSpaceDialog
        tabsForMoving={selectedTabs.toArray()}
        isOpen={isMoveToExistTabSpaceDialogOpen}
        onClose={() => setIsMoveToExistTabSpaceDialogOpen(false)}
      />
    </div>
  );
}
