/**
 * The duplicate-tab advisor's notice (adr/0033).
 *
 * It sits above the tab list beside `CapabilityWarning`, and for the same
 * reason: it says one thing about the window and expands in place rather than
 * floating over the tabs it is talking about. It is advisor-only - the only
 * button that closes anything is "Remove duplicates", and it asks the worker
 * rather than touching a tab.
 *
 * The shell is presentational so its states can be checked by what they render
 * (ADR 0018): collapsed, expanded, protected-only, busy, and the post-apply
 * undo line. The container wires the effector store and the messages.
 */
import { Button, Callout, Icon, Intent, Tag } from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';

import type { DedupReport, DuplicateGroup } from '../../../data/tabSpace/dedup';
import {
  alwaysIgnoreDedupUrl,
  applyDedupReport,
  ignoreDedupReport,
  requestDedupReport,
  undoDedupReport,
} from '../../../data/tabSpace/dedupMessages';
import { $dedupReport } from '../../../data/tabSpace/dedupStore';
import classes from './DedupAdvisorNotice.module.scss';

export interface DedupAdvisorNoticeProps {
  report: DedupReport;
  /** A message is in flight; the buttons are disabled. */
  busy?: boolean;
  /** The tests render the detail without a click. */
  defaultExpanded?: boolean;
  onApply: (fingerprint: string) => void;
  onIgnore: (fingerprint: string) => void;
  onAlwaysIgnore: (key: string) => void;
}

export interface DedupUndoNoticeProps {
  busy?: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function GroupRow(props: {
  group: DuplicateGroup;
  busy: boolean;
  onAlwaysIgnore: (key: string) => void;
}) {
  const { group } = props;
  return (
    <div className={classes.group}>
      <div className={classes.groupMain}>
        <div className={classes.groupUrl} title={group.url}>
          {shortUrl(group.url)}
        </div>
        {group.closers.length > 0 ? (
          <div className={classes.groupNote}>
            keeping “{group.keeper.title || 'untitled'}”{' · closing '}
            {group.closers.length}
          </div>
        ) : (
          <div className={classes.groupProtected}>
            <Icon icon="lock" size={11} /> {group.protectedReason}
          </div>
        )}
      </div>
      <Button
        small={true}
        minimal={true}
        disabled={props.busy}
        title="Never offer this URL again"
        onClick={() => props.onAlwaysIgnore(group.key)}
      >
        Always ignore
      </Button>
    </div>
  );
}

/**
 * The notice itself. Null-rendering is the container's job; this always draws a
 * report.
 */
export function DedupAdvisorNoticeShell(props: DedupAdvisorNoticeProps) {
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
  const { report } = props;
  const closers = report.groups.reduce(
    (sum, group) => sum + group.closers.length,
    0,
  );

  return (
    <div className={classes.container}>
      <Callout
        intent={Intent.WARNING}
        icon="duplicate"
        className={classes.callout}
      >
        <div className={classes.header}>
          <span className={classes.summary}>
            {closers > 0
              ? `${closers} duplicate tab${closers === 1 ? '' : 's'} found`
              : 'Duplicate tabs found'}
            <Tag minimal={true} className={classes.windowTag}>
              this window
            </Tag>
          </span>
          <div className={classes.headerActions}>
            {closers > 0 ? (
              <Button
                small={true}
                className="tv-primary-button"
                loading={props.busy}
                onClick={() => props.onApply(report.fingerprint)}
              >
                Remove duplicates
              </Button>
            ) : null}
            <Button
              small={true}
              minimal={true}
              onClick={() => setExpanded((was) => !was)}
              aria-expanded={expanded}
              title={expanded ? 'Hide the details' : 'Review the duplicates'}
            >
              {expanded ? 'Hide' : 'Review'}
            </Button>
            <Button
              small={true}
              minimal={true}
              disabled={props.busy}
              onClick={() => props.onIgnore(report.fingerprint)}
            >
              Ignore
            </Button>
          </div>
        </div>
        {expanded ? (
          <div className={classes.list}>
            {report.groups.map((group) => (
              <GroupRow
                key={`${group.windowId}:${group.key}`}
                group={group}
                busy={props.busy === true}
                onAlwaysIgnore={props.onAlwaysIgnore}
              />
            ))}
          </div>
        ) : null}
      </Callout>
    </div>
  );
}

/** The line after an apply, so the removal is undoable. */
export function DedupUndoNotice(props: DedupUndoNoticeProps) {
  return (
    <div className={classes.container}>
      <Callout icon="tick" className={classes.callout}>
        <div className={classes.header}>
          <span className={classes.summary}>Duplicate tabs removed.</span>
          <div className={classes.headerActions}>
            <Button
              small={true}
              minimal={true}
              disabled={props.busy}
              onClick={props.onUndo}
            >
              Undo
            </Button>
            <Button small={true} minimal={true} onClick={props.onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </Callout>
    </div>
  );
}

/**
 * The container the tab list mounts: it asks the worker for the report on
 * mount (the "returned to the extension" refresh), draws it, and turns the
 * buttons into messages. Nothing here reads tabs.
 */
export function DedupAdvisorNotice() {
  const report = useUnit($dedupReport);
  const [busy, setBusy] = useState(false);
  const [recentlyApplied, setRecentlyApplied] = useState(false);

  useEffect(() => {
    void requestDedupReport();
  }, []);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
    } finally {
      setBusy(false);
    }
  };

  const apply = (fingerprint: string) =>
    void run(async () => {
      await applyDedupReport(fingerprint);
      setRecentlyApplied(true);
    });
  const ignore = (fingerprint: string) =>
    void run(async () => {
      await ignoreDedupReport(fingerprint);
      setRecentlyApplied(false);
    });
  const alwaysIgnore = (key: string) =>
    void run(async () => {
      await alwaysIgnoreDedupUrl(key);
    });
  const undo = () =>
    void run(async () => {
      await undoDedupReport();
      setRecentlyApplied(false);
    });

  if (!report) {
    return recentlyApplied ? (
      <DedupUndoNotice
        busy={busy}
        onUndo={undo}
        onDismiss={() => setRecentlyApplied(false)}
      />
    ) : null;
  }
  return (
    <DedupAdvisorNoticeShell
      report={report}
      busy={busy}
      onApply={apply}
      onIgnore={ignore}
      onAlwaysIgnore={alwaysIgnore}
    />
  );
}
