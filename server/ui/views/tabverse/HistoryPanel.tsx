import React, { useState } from 'react';

import { calendarLabel } from '../../../../src/time';
import {
  groupHistoryBySite,
  matchHistoryEntries,
} from '../../../../src/data/closedTab/historyFilter';
import { HistoryToolbar } from '../../../../src/ui/history/HistoryToolbar';
import { usePageControl } from '../../../../src/ui/common/usePageControl';
import historyClasses from '../../../../src/ui/history/HistoryView.module.scss';
import type { ClosedTab } from '../../data/tabverseAdapter';

/**
 * How many closed tabs a page holds here.
 *
 * Ten, and the extension's own number: the console reuses `HistoryView`'s
 * stylesheet and `usePageControl`, so this list pages exactly as the extension's
 * History does and the two cannot drift.
 *
 * It could not stay unpaginated either. A tabverse keeps up to 999 closed tabs
 * (`adr/0007`) and the drawer handed every one of them to this panel, so the
 * worst case was a drawer with a thousand rows in it and no way to reach the
 * bottom of a tool whose whole job is to be read.
 */
const HISTORY_PAGE_LIMIT = 10;

/**
 * The rows: a flat paged list, or the same entries under one header per site.
 *
 * The extension's card, on the extension's own classes and through the
 * extension's own `historyFilter` - the box above it is the extension's
 * `HistoryToolbar`, which is the whole reason the two histories answer the same
 * question the same way.
 *
 * Exported for this file's tests, because there is no DOM in this repo
 * (`AGENTS.md`) and the switch cannot be pressed from a static render.
 */
export function HistoryList(props: { entries: ClosedTab[]; grouped: boolean }) {
  const [getCurrentPageItems, renderPageControl] = usePageControl<ClosedTab>(
    props.entries,
    HISTORY_PAGE_LIMIT,
  );

  const item = (closed: ClosedTab) => (
    <li key={closed.id}>
      <div className={historyClasses.listItemView}>
        <div className={historyClasses.favIcon}>
          {closed.favIconUrl ? (
            <img
              alt=""
              aria-hidden={true}
              src={closed.favIconUrl}
              width="32"
              height="32"
            />
          ) : null}
        </div>
        {/* a plain row here, where the extension makes the title a button
            that restores the tab */}
        <div className={historyClasses.label}>
          <div className={historyClasses.labelTitle}>
            {closed.title || closed.url || '(untitled)'}
          </div>
          <small className={historyClasses.labelUrl}>{closed.url}</small>
        </div>
        <small
          className={historyClasses.labelTime}
          title={new Date(closed.closedAt).toLocaleString()}
        >
          {calendarLabel(closed.closedAt)}
          {closed.timesClosed > 1 ? ` x${closed.timesClosed}` : ''}
        </small>
      </div>
    </li>
  );

  if (props.grouped) {
    // no pager for the same reason the extension's grouped view has none: a page
    // that ended in the middle of a site would print that site's header on both
    // pages
    return (
      <div className={historyClasses.groupedContainer}>
        {groupHistoryBySite(props.entries).map((group) => (
          <section key={group.site} className={historyClasses.groupSection}>
            <div className={historyClasses.groupHeader}>
              <span className={historyClasses.groupLabel}>{group.site}</span>
              <span className={historyClasses.groupCount}>
                {group.entries.length}
              </span>
            </div>
            <ul className={historyClasses.listContainer}>
              {group.entries.map(item)}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div>
      <ul className={historyClasses.listContainer}>
        {getCurrentPageItems().map(item)}
      </ul>
      {/* The extension's own page control, on the extension's own class - a
          console that drew its own would be the second one to drift. */}
      <div className={historyClasses.pageControlContainer}>
        {renderPageControl()}
      </div>
    </div>
  );
}

/**
 * The extension's history, read.
 *
 * Same rows, same stylesheet, same search box and same day grouping as the
 * extension's own tool: the icon, the title over the url, and on the right when
 * the tab was closed - `calendarLabel` is the extension's own wording
 * ("Today at 14:30"), reused rather than re-worded, and `x3` for a tab closed
 * more than once. What is gone: undo, save as bookmark, delete, and the title as
 * a button that reopens the tab. A tab closed on another machine cannot be
 * reopened by this one; the button would only be able to lie.
 *
 * What the box filters and what the switch groups is the extension's
 * `historyFilter`, called on the bundle's rows - so "github" here means exactly
 * what it means there, and the two cannot answer differently.
 */
export function HistoryPanel(props: { history: ClosedTab[] }) {
  const [searchText, setSearchText] = useState<string>('');
  const [grouped, setGrouped] = useState<boolean>(false);

  if (!props.history.length) {
    return (
      <div className={historyClasses.noticeContainer}>
        No closed tab recorded for this tabverse.
      </div>
    );
  }

  const matched = matchHistoryEntries(props.history, searchText);

  return (
    <div className={historyClasses.container}>
      <HistoryToolbar
        value={searchText}
        onChange={setSearchText}
        matchCount={matched.length}
        totalCount={props.history.length}
        grouped={grouped}
        onToggleGrouped={() => setGrouped(!grouped)}
      />
      {matched.length <= 0 ? (
        <div className={historyClasses.noticeContainer}>
          Nothing in the history matches "{searchText.trim()}".
        </div>
      ) : (
        <HistoryList entries={matched} grouped={grouped} />
      )}
    </div>
  );
}
