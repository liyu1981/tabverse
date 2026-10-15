import { Button, Dialog, DialogBody } from '@blueprintjs/core';
import React, { useCallback, useMemo, useState } from 'react';

import {
  addedFor,
  buildDiff,
  changeStats,
  recompose,
  type ChangeEdits,
  type DiffBlock,
} from '../../data/note/diff';
import { wordDiff, type WordDiffPair } from '../../data/note/diffWords';
import classes from './NoteReviewDialog.module.scss';

/**
 * The before/after review of a proposed note edit.
 *
 * `setContent` does not write to the editor; it stages a proposal, and this is
 * where the person accepts it, edits it line by line, or rejects it whole. The
 * goal is that a model's answer never lands in a note without being read: the
 * diff is the whole document, the changed lines are the only ones that move, and
 * the result is what the editor is given back.
 *
 * The model is sifpress's: a line diff (`data/note/diff.ts`) into context and
 * change blocks, a per-block revert, an inline edit per added line, and
 * `recompose` to rebuild the markdown those choices add up to. Framework-free
 * diff, Blueprint dialog - no other dependency.
 */

export interface NoteReviewDialogProps {
  before: string;
  after: string;
  onClose: (result: string) => void;
}

type ChangeType = 'added' | 'removed' | 'changed';

interface LineRow {
  kind: 'line';
  key: string;
  leftNo: number | null;
  leftText: string;
  rightNo: number | null;
  rightText: string;
  changeId?: string;
  changeType?: ChangeType;
  /** Index into the block's added lines, for an inline edit. */
  rightIndex?: number;
  showToggle?: boolean;
  segments?: WordDiffPair;
}

interface CollapsedRow {
  kind: 'collapsed';
  key: string;
  contextId: string;
  hidden: number;
}

type Row = LineRow | CollapsedRow;

/** How many context lines to keep on each side of a long unchanged run. */
const CONTEXT_LINES = 3;

function buildRows(
  blocks: DiffBlock[],
  expanded: ReadonlySet<string>,
  edits: ChangeEdits,
): Row[] {
  const rows: Row[] = [];
  let leftNo = 1;
  let rightNo = 1;
  let contextIndex = 0;

  for (const block of blocks) {
    if (block.kind === 'context') {
      const contextId = `ctx${contextIndex++}`;
      const { lines } = block;
      const hidden = lines.length - CONTEXT_LINES * 2;
      if (hidden > 0 && !expanded.has(contextId)) {
        for (let i = 0; i < CONTEXT_LINES; i++) {
          rows.push(contextRow(leftNo++, rightNo++, lines[i]));
        }
        rows.push({ kind: 'collapsed', key: contextId, contextId, hidden });
        for (let i = lines.length - CONTEXT_LINES; i < lines.length; i++) {
          rows.push(contextRow(leftNo++, rightNo++, lines[i]));
        }
      } else {
        for (const line of lines) {
          rows.push(contextRow(leftNo++, rightNo++, line));
        }
      }
      continue;
    }

    const added = addedFor(block, edits);
    const count = Math.max(block.removed.length, added.length);
    const changeType: ChangeType =
      block.removed.length > 0 && added.length > 0
        ? 'changed'
        : block.removed.length > 0
          ? 'removed'
          : 'added';

    for (let i = 0; i < count; i++) {
      const hasLeft = i < block.removed.length;
      const hasRight = i < added.length;
      rows.push({
        kind: 'line',
        key: `${block.id}-${i}`,
        leftNo: hasLeft ? leftNo++ : null,
        leftText: hasLeft ? block.removed[i] : '',
        rightNo: hasRight ? rightNo++ : null,
        rightText: hasRight ? added[i] : '',
        changeId: block.id,
        changeType,
        rightIndex: hasRight ? i : undefined,
        showToggle: i === 0,
        segments:
          hasLeft && hasRight
            ? (wordDiff(block.removed[i], added[i]) ?? undefined)
            : undefined,
      });
    }
  }

  return rows;
}

function contextRow(leftNo: number, rightNo: number, text: string): LineRow {
  return {
    kind: 'line',
    key: `ctx-${leftNo}`,
    leftNo,
    rightNo,
    leftText: text,
    rightText: text,
  };
}

function Segments(props: {
  pair: WordDiffPair | undefined;
  side: 'left' | 'right';
}) {
  if (!props.pair) {
    return null;
  }
  return (
    <>
      {props.pair[props.side].map((segment, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a word-diff segment has no id
          key={index}
          className={segment.changed ? classes.changedWord : undefined}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

export function NoteReviewDialog(props: NoteReviewDialogProps) {
  const { before, after, onClose } = props;
  return (
    <Dialog
      isOpen={true}
      onClose={() => undefined}
      title="Review changes"
      icon="comparison"
      className={classes.dialog}
      canEscapeKeyClose={false}
      canOutsideClickClose={false}
      isCloseButtonShown={false}
    >
      <DialogBody className={classes.dialogBody}>
        <NoteReviewBody before={before} after={after} onClose={onClose} />
      </DialogBody>
    </Dialog>
  );
}

/**
 * The dialog's contents, without the portal around them.
 *
 * Blueprint's `Dialog` renders through a portal, so `renderToStaticMarkup`
 * shows nothing of it (the same note `SettingsDialog` carries). The body is a
 * separate component so this - the diff, the toggles, the buttons - can be
 * checked statically.
 */
export function NoteReviewBody(props: NoteReviewDialogProps) {
  const { before, after, onClose } = props;
  const diff = useMemo(() => buildDiff(before, after), [before, after]);
  const [reverted, setReverted] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [edits, setEdits] = useState<ChangeEdits>(
    () => new Map<string, string[]>(),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const effective = useMemo(
    () => recompose(diff.blocks, reverted, edits),
    [diff.blocks, reverted, edits],
  );
  const stats = useMemo(
    () => changeStats(diff.blocks, reverted),
    [diff.blocks, reverted],
  );
  const rows = useMemo(
    () => buildRows(diff.blocks, expanded, edits),
    [diff.blocks, expanded, edits],
  );

  const toggle = useCallback((id: string) => {
    setReverted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const edit = useCallback(
    (blockId: string, lineIndex: number, text: string) => {
      setEdits((prev) => {
        const block = diff.blocks.find(
          (candidate): candidate is Extract<DiffBlock, { kind: 'change' }> =>
            candidate.kind === 'change' && candidate.id === blockId,
        );
        if (block === undefined) {
          return prev;
        }
        const base = (prev.get(blockId) ?? block.added).slice();
        base[lineIndex] = text;
        const next = new Map(prev);
        next.set(blockId, base);
        return next;
      });
    },
    [diff.blocks],
  );

  const expand = useCallback((contextId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(contextId);
      return next;
    });
  }, []);

  const hasChanges = diff.changeCount > 0;

  return (
    <div className={classes.body}>
      <div className={classes.summary}>
        {hasChanges ? (
          <>
            <span>
              {stats.total} change{stats.total === 1 ? '' : 's'}
            </span>
            <span className={classes.added}>+{stats.addedLines}</span>
            <span className={classes.removed}>−{stats.removedLines}</span>
            {stats.reverted > 0 ? (
              <span className="muted">{stats.reverted} reverted</span>
            ) : null}
          </>
        ) : (
          <span className="muted">No changes</span>
        )}
      </div>

      <div className={classes.columns}>
        <span className={classes.columnHead}>Before</span>
        <span className={classes.columnHead}>
          After - edit a line, or revert a change
        </span>
      </div>

      <div className={classes.scroll}>
        {hasChanges ? (
          <div className={classes.rows}>
            {rows.map((row) =>
              row.kind === 'collapsed' ? (
                <div key={row.key} className={classes.collapsedRow}>
                  <Button
                    small={true}
                    minimal={true}
                    onClick={() => expand(row.contextId)}
                  >
                    {row.hidden} unchanged line{row.hidden === 1 ? '' : 's'}
                  </Button>
                </div>
              ) : (
                <LineView
                  key={row.key}
                  row={row}
                  reverted={row.changeId ? reverted.has(row.changeId) : false}
                  onToggle={toggle}
                  onEdit={edit}
                />
              ),
            )}
          </div>
        ) : (
          <div className={classes.empty}>No changes</div>
        )}
      </div>

      <div className={classes.footer}>
        <span className="muted small">
          Applying replaces the note body; nothing is saved to the server here.
        </span>
        <div className={classes.footerActions}>
          <Button onClick={() => onClose(before)}>Reject all</Button>
          <Button
            intent="primary"
            onClick={() => onClose(effective)}
            disabled={!hasChanges}
          >
            Apply {stats.kept} change{stats.kept === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LineView(props: {
  row: LineRow;
  reverted: boolean;
  onToggle: (id: string) => void;
  onEdit: (blockId: string, lineIndex: number, text: string) => void;
}) {
  const { row, reverted, onToggle, onEdit } = props;
  const changeClass = row.changeType
    ? reverted
      ? classes.rowReverted
      : classes[`row${capitalize(row.changeType)}`]
    : '';

  return (
    <div className={`${classes.row} ${changeClass}`}>
      <div className={`${classes.cell} ${classes.before}`}>
        <span className={classes.lineNo}>{row.leftNo ?? ''}</span>
        <span className={classes.lineText}>
          <Segments pair={row.segments} side="left" />
          {row.segments ? null : row.leftText}
        </span>
      </div>
      <div className={`${classes.cell} ${classes.after}`}>
        <span className={classes.lineNo}>{row.rightNo ?? ''}</span>
        {row.changeId && row.rightIndex !== undefined && !reverted ? (
          <textarea
            className={classes.lineEdit}
            value={row.rightText}
            rows={1}
            spellCheck={false}
            aria-label="Edit added line"
            onChange={(event) =>
              onEdit(
                row.changeId as string,
                row.rightIndex as number,
                event.currentTarget.value,
              )
            }
          />
        ) : (
          <span className={classes.lineText}>
            <Segments pair={row.segments} side="right" />
            {row.segments ? null : row.rightText}
          </span>
        )}
        {row.showToggle && row.changeId ? (
          <Button
            small={true}
            minimal={true}
            className={classes.toggle}
            icon={reverted ? 'undo' : 'cross'}
            title={reverted ? 'Keep this change' : 'Revert this change'}
            aria-label={reverted ? 'Keep this change' : 'Revert this change'}
            onClick={() => onToggle(row.changeId as string)}
          />
        ) : null}
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
