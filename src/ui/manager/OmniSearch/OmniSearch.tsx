import { InputGroup, Spinner } from '@blueprintjs/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

import { logger } from '../../../global';
import { ServerApiClient, ServerApiError } from '../../../data/repo/serverApi';
import { SyncConfig, loadSyncConfig } from '../../../data/repo/syncConfig';
import { SearchHit } from '../../../data/repo/types';
import { OmniTabverseCard } from './OmniTabverseCard';
import { loadSearchCache, saveSearchCache } from './omniSearchCache';
import {
  collectTabverses,
  omniTabs,
  rankTabverses,
} from './omniSearchGrouping';
import classes from './OmniSearch.module.scss';

/** The server caps a search at 200 hits; asking for more is a no-op. */
const OMNI_SEARCH_LIMIT = 200;
const DEBOUNCE_MS = 300;

/**
 * The omni search: full text over the whole synced account, using the server's
 * index (adr/0008). The sidebar only offers it once this device is paired, so
 * the "not paired" branch is reached only by a stale link.
 *
 * Results are catalogued by tabverse: Overview ranks by how much matched in
 * each, and each kind tab (Tabs, History, Notes, ...) by how much of that kind
 * matched. The tabs are a vertical rail on the left; each tabverse is a card
 * like the saved-tabverse list's, whose matched records are grouped into their
 * own tabs inside it.
 */
export function OmniSearch() {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [ready, setReady] = useState(false);
  // The last search is restored from localStorage, then refreshed below, so
  // switching back to this view shows results immediately.
  const [cached] = useState(() => loadSearchCache());
  const [query, setQuery] = useState(cached?.query ?? '');
  const [hits, setHits] = useState<SearchHit[]>(cached?.hits ?? []);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const [settled, setSettled] = useState(cached?.query ?? '');
  const [activeKind, setActiveKind] = useState('overview');

  useEffect(() => {
    loadSyncConfig()
      .then((cfg) => {
        setConfig(cfg);
        setReady(true);
      })
      .catch(() => {
        setConfig(null);
        setReady(true);
      });
  }, []);

  const runSearch = useCallback(async (text: string, cfg: SyncConfig) => {
    const q = text.trim();
    if (!q) {
      setHits([]);
      setProblem('');
      setSettled('');
      return;
    }
    setLoading(true);
    try {
      const api = new ServerApiClient({
        baseUrl: cfg.baseUrl,
        token: cfg.token,
      });
      const result = await api.search(q, { limit: OMNI_SEARCH_LIMIT });
      setHits(result.hits || []);
      setProblem('');
      setSettled(q);
      saveSearchCache(q, result.hits || []);
    } catch (err) {
      logger.log('omni search failed:', err);
      setHits([]);
      setProblem(
        err instanceof ServerApiError
          ? `${err.message} (${err.code})`
          : 'search failed',
      );
      setSettled(q);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !config?.enabled) return undefined;
    const handle = window.setTimeout(() => {
      void runSearch(query, config);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, config, ready, runSearch]);

  const tabverses = useMemo(() => collectTabverses(hits), [hits]);
  const tabs = useMemo(() => omniTabs(tabverses), [tabverses]);
  // A new search can drop the tab that was open; fall back to Overview.
  const active = tabs.some((tab) => tab.key === activeKind)
    ? activeKind
    : 'overview';
  const ranked = rankTabverses(tabverses, active);

  if (!ready) {
    return (
      <div className={classes.container}>
        <Spinner size={24} />
      </div>
    );
  }

  if (!config?.enabled) {
    return (
      <div className={classes.container}>
        <div className={classes.empty}>
          Pair this device with a server to search all of your tabverses.
        </div>
      </div>
    );
  }

  const q = query.trim();
  const terms = q.split(/\s+/).filter(Boolean);
  return (
    <div className={classes.container}>
      <div className={classes.searchBar}>
        <InputGroup
          className={classes.input}
          type="search"
          large={true}
          leftIcon="search"
          placeholder="search tabs, history, notes, todos, bookmarks"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {loading ? <Spinner size={16} /> : null}
      </div>

      <div className={classes.status}>
        {q
          ? settled === q
            ? `${hits.length} hit${hits.length === 1 ? '' : 's'} in ${
                tabverses.length
              } tabverse${tabverses.length === 1 ? '' : 's'} for "${q}"`
            : `searching for "${q}"`
          : 'Type to search your synced tabverses'}
      </div>

      {!q ? (
        <div className={classes.empty}>
          Search across tabs, history, notes, todos and bookmarks.
        </div>
      ) : problem ? (
        <div className={classes.problem}>{problem}</div>
      ) : settled === q && hits.length === 0 ? (
        <div className={classes.empty}>Nothing matched.</div>
      ) : (
        <div className={classes.layout}>
          <nav className={classes.kinds} aria-label="Search result kinds">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={clsx(
                  classes.kind,
                  tab.key === active && classes.kindActive,
                )}
                onClick={() => setActiveKind(tab.key)}
              >
                <span>{tab.label}</span>
                <span className={classes.kindCount}>{tab.count}</span>
              </button>
            ))}
          </nav>
          <div className={classes.results}>
            {ranked.map((tabverse) => (
              <OmniTabverseCard
                key={`${tabverse.id}/${active}`}
                tabverse={tabverse}
                outerKind={active}
                terms={terms}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
