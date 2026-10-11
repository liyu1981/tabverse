import { Button, Card } from '@blueprintjs/core';
import React, { useState } from 'react';
import clsx from 'clsx';

import { logger } from '../../../global';
import { restoreSavedTabSpaceUtil } from '../../../data/tabSpace/chromeUtil';
import { formatDateTime, fromNow } from '../../../time';
import {
  TabverseMatches,
  hitsForTabverse,
  kindsInTabverse,
  matchCount,
} from './omniSearchGrouping';
import { highlightTerms, parseSnippet, type TextPart } from './omniSearchText';
import classes from './OmniSearch.module.scss';

const KIND_LABEL: Record<string, string> = {
  tabspace: 'Tabverses',
  tab: 'Tabs',
  closedtab: 'History',
  note: 'Notes',
  todo: 'Todos',
  bookmark: 'Bookmarks',
  session: 'Sessions',
};

function labelOf(kind: string): string {
  return KIND_LABEL[kind] || kind;
}

function Highlighted(props: { parts: TextPart[] }) {
  return (
    <>
      {props.parts.map((part, index) =>
        part.match ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * One matched tabverse, styled like the saved-tabverse cards: an info column on
 * the left (name, dates, size, the open action) and the matched records on the
 * right. Inside an Overview card the records are grouped into their own tabs by
 * kind; in a kind tab there is only one kind, so the inner strip is hidden.
 */
export function OmniTabverseCard(props: {
  tabverse: TabverseMatches;
  outerKind: string;
  terms: string[];
}) {
  const { tabverse, outerKind, terms } = props;
  const subKinds =
    outerKind === 'overview' ? kindsInTabverse(tabverse) : [outerKind];
  const [active, setActive] = useState(subKinds[0] ?? 'overview');
  const hits =
    outerKind === 'overview'
      ? tabverse.hitsByKind[active] || []
      : hitsForTabverse(tabverse, outerKind);

  const open = () => {
    restoreSavedTabSpaceUtil(tabverse.id).catch((err) =>
      logger.error('could not open the tabverse', err),
    );
  };

  const matches = matchCount(tabverse, outerKind);
  return (
    <Card className={classes.tabverseCard}>
      <div className={classes.tabverseBody}>
        <div className={classes.tabverseInfo}>
          <h2 className={classes.tabverseName}>
            {tabverse.title || '(no tabverse)'}
          </h2>
          <div className={classes.tabverseMeta}>
            {matches} match{matches === 1 ? '' : 'es'}
            {tabverse.tabs
              ? ` · ${tabverse.tabs} tab${tabverse.tabs === 1 ? '' : 's'}`
              : ''}
          </div>
          {tabverse.createdAt ? (
            <div className={classes.timeInfo}>
              Created <b>{fromNow(tabverse.createdAt)}</b> at
              <br />
              {formatDateTime(tabverse.createdAt)}
            </div>
          ) : null}
          {tabverse.updatedAt ? (
            <div className={classes.timeInfo}>
              Saved <b>{fromNow(tabverse.updatedAt)}</b> at
              <br />
              {formatDateTime(tabverse.updatedAt)}
            </div>
          ) : null}
          <Button small={true} minimal={true} icon="arrow-right" onClick={open}>
            Open in new window
          </Button>
        </div>
        <div className={classes.tabverseItems}>
          {subKinds.length > 1 ? (
            <div className={classes.itemTabs}>
              {subKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={clsx(
                    classes.itemTab,
                    kind === active && classes.itemTabActive,
                  )}
                  onClick={() => setActive(kind)}
                >
                  {labelOf(kind)}
                  <span className={classes.itemTabCount}>
                    {tabverse.byKind[kind] || 0}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className={classes.hits}>
            {hits.map((hit) => (
              <div key={`${hit.entity}/${hit.id}`} className={classes.hit}>
                <div className={classes.hitHead}>
                  <span className={classes.hitEntity}>{hit.entity}</span>
                  <span className={classes.hitScore}>
                    {hit.score.toFixed(2)}
                  </span>
                </div>
                <div className={classes.hitTitle} title={hit.title || hit.id}>
                  <Highlighted
                    parts={highlightTerms(hit.title || hit.id, terms)}
                  />
                </div>
                {hit.url ? (
                  <a
                    className={classes.hitUrl}
                    href={hit.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={hit.url}
                  >
                    <Highlighted parts={highlightTerms(hit.url, terms)} />
                  </a>
                ) : null}
                {hit.snippet ? (
                  <pre className={classes.hitSnippet}>
                    <Highlighted parts={parseSnippet(hit.snippet)} />
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
