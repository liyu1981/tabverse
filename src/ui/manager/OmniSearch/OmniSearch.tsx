import { Button, InputGroup, Spinner } from '@blueprintjs/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

import { logger } from '../../../global';
import { ServerApiClient, ServerApiError } from '../../../data/repo/serverApi';
import { SyncConfig, loadSyncConfig } from '../../../data/repo/syncConfig';
import { SearchHit } from '../../../data/repo/types';
import { restoreSavedTabSpaceUtil } from '../../../data/tabSpace/chromeUtil';
import {
  collectTabverses,
  hitsForTabverse,
  matchCount,
  omniTabs,
  rankTabverses,
} from './omniSearchGrouping';
import classes from './OmniSearch.module.scss';

/** The server caps a search at 200 hits; asking for more is a no-op. */
export const OMNI_SEARCH_LIMIT = 200;
const DEBOUNCE_MS = 300;

/**
 * The omni search: full text over the whole synced account, using the server's
 * index (adr/0008). The sidebar only offers it once this device is paired, so
 * the "not paired" branch is reached only by a stale link.
 *
 * Results are catalogued by tabverse: Overview ranks by how much matched in
 * each, and each kind tab (Tabs, History, Notes, ...) by how much of that kind
 * matched. Inside a tabverse the matched records are listed. The one action
 * opens the tabverse in a new window, the same restore path the saved-tabverse
 * list uses, so a hit for a tabverse this device has never downloaded works.
 */
export function OmniSearch() {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const [settled, setSettled] = useState('');
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

  const openTabverse = (id: string) => {
    restoreSavedTabSpaceUtil(id).catch((err) =>
      logger.error('could not open the tabverse', err),
    );
  };

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
  return (
    <div className={classes.container}>
      <div className={classes.searchBar}>
        <InputGroup
          className={classes.input}
          type="search"
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
        <>
          <div className={classes.tabs}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={clsx(
                  classes.tab,
                  tab.key === active && classes.tabActive,
                )}
                onClick={() => setActiveKind(tab.key)}
              >
                {tab.label}
                <span className={classes.tabCount}>{tab.count}</span>
              </button>
            ))}
          </div>
          <div className={classes.results}>
            {ranked.map((tabverse) => (
              <section key={tabverse.id} className={classes.tabverse}>
                <div className={classes.tabverseHead}>
                  <span className={classes.tabverseName}>
                    {tabverse.title || '(no tabverse)'}
                  </span>
                  <span className={classes.tabverseCount}>
                    {matchCount(tabverse, active)} match
                    {matchCount(tabverse, active) === 1 ? '' : 'es'}
                  </span>
                  {tabverse.id ? (
                    <Button
                      small={true}
                      minimal={true}
                      icon="arrow-right"
                      onClick={() => openTabverse(tabverse.id)}
                    >
                      Open in new window
                    </Button>
                  ) : null}
                </div>
                {hitsForTabverse(tabverse, active).map((hit) => (
                  <div key={`${hit.entity}/${hit.id}`} className={classes.hit}>
                    <div className={classes.hitHead}>
                      <span className={classes.hitEntity}>{hit.entity}</span>
                      <span className={classes.hitScore}>
                        {hit.score.toFixed(2)}
                      </span>
                    </div>
                    <div className={classes.hitTitle}>
                      {hit.title || hit.id}
                    </div>
                    {hit.url ? (
                      <a
                        className={classes.hitUrl}
                        href={hit.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {hit.url}
                      </a>
                    ) : null}
                    {hit.snippet ? (
                      <pre className={classes.hitSnippet}>{hit.snippet}</pre>
                    ) : null}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
