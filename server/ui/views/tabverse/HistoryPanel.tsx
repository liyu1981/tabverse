import React from 'react';

import { calendarLabel } from '../../../../src/time';
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
 * The extension's history, read.
 *
 * Same rows, same stylesheet: the icon, the title over the url, and on the right
 * when the tab was closed - `calendarLabel` is the extension's own wording
 * ("Today at 14:30"), reused rather than re-worded, and `x3` for a tab closed
 * more than once. What is gone: undo, save as bookmark, delete, and the title as
 * a button that reopens the tab. A tab closed on another machine cannot be
 * reopened by this one; the button would only be able to lie.
 */
export function HistoryPanel(props: { history: ClosedTab[] }) {
  const [getCurrentPageItems, renderPageControl] = usePageControl<ClosedTab>(
    props.history,
    HISTORY_PAGE_LIMIT,
  );

  if (!props.history.length) {
    return (
      <div className={historyClasses.noticeContainer}>
        No closed tab recorded for this tabverse.
      </div>
    );
  }

  const shown = getCurrentPageItems();

  return (
    <div className={historyClasses.container}>
      <ul className={historyClasses.listContainer}>
        {shown.map((closed) => (
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
        ))}
      </ul>
      {/* The extension's own page control, on the extension's own class - a
          console that drew its own would be the second one to drift. */}
      <div className={historyClasses.pageControlContainer}>
        {renderPageControl()}
      </div>
    </div>
  );
}
