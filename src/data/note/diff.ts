import { diffArrays } from 'diff';

/**
 * The line diff behind the note review dialog.
 *
 * A note editor change (a model's answer, an import) is shown as a before/after
 * the person accepts, edits or rejects - the same shape sifpress uses. This is
 * the whole model: a body is split into lines and diffed as arrays of lines
 * (rather than newline-joined strings) so trailing newlines survive and
 * `recompose` can rebuild the result losslessly.
 *
 * Pure and framework-free on purpose: the dialog is the only caller, and this
 * is the part worth testing without one.
 */

interface DiffContextBlock {
  kind: 'context';
  lines: string[];
}

export interface DiffChangeBlock {
  kind: 'change';
  id: string;
  removed: string[];
  added: string[];
}

export type DiffBlock = DiffContextBlock | DiffChangeBlock;

/**
 * Per-change overrides produced by inline editing. Keyed by a change block's
 * id; the value replaces the block's `added` lines (same length).
 */
export type ChangeEdits = ReadonlyMap<string, readonly string[]>;

export interface DiffResult {
  blocks: DiffBlock[];
  changeCount: number;
  addedLines: number;
  removedLines: number;
}

function splitLines(value: string): string[] {
  return value.split('\n');
}

export function buildDiff(before: string, after: string): DiffResult {
  const changes = diffArrays(splitLines(before), splitLines(after));
  const blocks: DiffBlock[] = [];
  let changeIndex = 0;
  let addedLines = 0;
  let removedLines = 0;

  for (let i = 0; i < changes.length; ) {
    const change = changes[i];

    if (!change.added && !change.removed) {
      blocks.push({ kind: 'context', lines: change.value });
      i += 1;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      if (changes[i].removed) {
        removed.push(...changes[i].value);
      } else {
        added.push(...changes[i].value);
      }
      i += 1;
    }

    if (removed.length === 0 && added.length === 0) {
      continue;
    }

    blocks.push({ kind: 'change', id: `c${changeIndex++}`, removed, added });
    addedLines += added.length;
    removedLines += removed.length;
  }

  return { blocks, changeCount: changeIndex, addedLines, removedLines };
}

/** The added lines for a block, honouring any inline edits. */
export function addedFor(
  block: DiffChangeBlock,
  edits?: ChangeEdits,
): readonly string[] {
  return edits?.get(block.id) ?? block.added;
}

/** Rebuild content from the baseline, substituting reverted/edited changes. */
export function recompose(
  blocks: DiffBlock[],
  reverted: ReadonlySet<string>,
  edits?: ChangeEdits,
): string {
  const out: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'context') {
      out.push(...block.lines);
    } else {
      out.push(
        ...(reverted.has(block.id) ? block.removed : addedFor(block, edits)),
      );
    }
  }

  return out.join('\n');
}

export interface ChangeStats {
  kept: number;
  reverted: number;
  total: number;
  addedLines: number;
  removedLines: number;
}

export function changeStats(
  blocks: DiffBlock[],
  reverted: ReadonlySet<string>,
): ChangeStats {
  let kept = 0;
  let addedLines = 0;
  let removedLines = 0;
  let total = 0;

  for (const block of blocks) {
    if (block.kind !== 'change') {
      continue;
    }

    total += 1;

    if (reverted.has(block.id)) {
      continue;
    }

    kept += 1;
    addedLines += block.added.length;
    removedLines += block.removed.length;
  }

  return { kept, reverted: total - kept, total, addedLines, removedLines };
}
