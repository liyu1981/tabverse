/**
 * The AI history: what this extension asked Chrome's built-in model, and what
 * came back (`src/ai/promptLog.ts`), as one view of the right side panel - the
 * same panel the server console opens in, next to it in the rail, because both
 * are about the tooling around a tabverse rather than about the tabverse.
 *
 * The log is written by the session layer, so it covers every feature that
 * talks to the model rather than one caller's view of it. Today that is the
 * name suggestion; when "ask this tabverse" lands (the gemma plan's increment
 * 2) its exchanges appear here too, without this view changing.
 *
 * The panel is deliberately plain: it is a record, not a chat - there is no
 * input here, because a history that can be continued is a different feature
 * and this one is about being able to see what was said.
 */
import { Button, Icon, Spinner } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React, { useCallback, useEffect, useState } from 'react';

import {
  type PromptLogEntry,
  clearPromptLog,
  loadPromptLog,
  subscribePromptLog,
} from '../../../ai/promptLog';
import { fromNow } from '../../../time';
import classes from './PromptHistoryPanel.module.scss';

export interface PromptHistoryListProps {
  /** null while the (fast, local) read is in flight. */
  entries: PromptLogEntry[] | null;
  onClear: () => void;
}

/** The view's body, presentational so its shapes can be checked statically. */
export function PromptHistoryList(props: PromptHistoryListProps) {
  const { entries, onClear } = props;

  if (entries === null) {
    return (
      <div className={classes.container}>
        <Spinner size={20} />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={classes.container}>
        <p className={classes.intro}>
          Nothing has been asked of the on-device model yet. The name
          suggestions you ask for appear here, so you can see what was sent and
          what came back.
        </p>
      </div>
    );
  }

  return (
    <div className={classes.container}>
      <div className={classes.headerRow}>
        <span className={classes.caption}>
          Kept on this device, newest first.
        </span>
        <Button minimal={true} small={true} icon="trash" onClick={onClear}>
          Clear
        </Button>
      </div>
      {entries.map((entry) => (
        <PromptHistoryEntry
          key={`${entry.at}-${entry.durationMs}`}
          entry={entry}
        />
      ))}
    </div>
  );
}

function PromptHistoryEntry(props: { entry: PromptLogEntry }) {
  const { entry } = props;
  const failed = entry.error !== null;
  return (
    <div className={classes.entry}>
      <div className={classes.entryHead}>
        <Icon icon={failed ? 'warning-sign' : 'chat'} size={14} />
        <span className={classes.when}>{fromNow(entry.at)}</span>
        <span className={classes.duration}>{entry.durationMs} ms</span>
      </div>
      <div className={classes.label}>asked</div>
      <pre className={classes.input}>{entry.input}</pre>
      <div className={classes.label}>{failed ? 'failed' : 'answered'}</div>
      <pre
        className={
          failed ? `${classes.output} ${classes.errorText}` : classes.output
        }
      >
        {failed ? entry.error : entry.output}
      </pre>
    </div>
  );
}

export function PromptHistoryPanel() {
  const [entries, setEntries] = useState<PromptLogEntry[] | null>(null);

  const reload = useCallback(() => {
    void loadPromptLog().then(setEntries);
  }, []);

  useEffect(() => {
    reload();
    return subscribePromptLog(reload);
  }, [reload]);

  const onClear = useCallback(() => {
    void clearPromptLog();
  }, []);

  return <PromptHistoryList entries={entries} onClear={onClear} />;
}
