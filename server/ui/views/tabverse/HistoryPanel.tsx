import React from 'react';

import { calendarLabel } from '../../../../src/time';
import historyClasses from '../../../../src/ui/history/HistoryView.module.scss';
import type { ClosedTab } from '../../data/tabverseAdapter';
import classes from './tabverse.module.scss';

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
  if (!props.history.length) {
    return (
      <div className={historyClasses.noticeContainer}>
        No closed tab recorded for this tabverse.
      </div>
    );
  }

  return (
    <div className={historyClasses.container}>
      <ul className={historyClasses.listContainer}>
        {props.history.map((closed) => (
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
    </div>
  );
}
