import { describe, expect, test } from 'vitest';

import {
  addedFor,
  buildDiff,
  changeStats,
  recompose,
  type DiffChangeBlock,
} from '../diff';
import { wordDiff } from '../diffWords';

describe('buildDiff', () => {
  test('identical text is one context block and no changes', () => {
    const diff = buildDiff('one\ntwo', 'one\ntwo');
    expect(diff.changeCount).toBe(0);
    expect(diff.blocks).toEqual([{ kind: 'context', lines: ['one', 'two'] }]);
  });

  test('a changed line is a change block, with context around it', () => {
    const diff = buildDiff('a\nold\nc', 'a\nnew\nc');
    expect(diff.changeCount).toBe(1);
    expect(diff.blocks[0]).toEqual({ kind: 'context', lines: ['a'] });
    expect(diff.blocks[1]).toEqual({
      kind: 'change',
      id: 'c0',
      removed: ['old'],
      added: ['new'],
    });
    expect(diff.blocks[2]).toEqual({ kind: 'context', lines: ['c'] });
  });

  test('pure additions and removals', () => {
    const added = buildDiff('a\nc', 'a\nb\nc');
    expect(added.blocks[1]).toEqual({
      kind: 'change',
      id: 'c0',
      removed: [],
      added: ['b'],
    });
    const removed = buildDiff('a\nb\nc', 'a\nc');
    expect(removed.blocks[1]).toEqual({
      kind: 'change',
      id: 'c0',
      removed: ['b'],
      added: [],
    });
  });
});

describe('recompose', () => {
  test('kept changes become the after text', () => {
    const diff = buildDiff('a\nold\nc', 'a\nnew\nc');
    expect(recompose(diff.blocks, new Set())).toBe('a\nnew\nc');
  });

  test('a reverted block goes back to the before text', () => {
    const diff = buildDiff('a\nold\nc', 'a\nnew\nc');
    expect(recompose(diff.blocks, new Set(['c0']))).toBe('a\nold\nc');
  });

  test('an edited block uses the edit', () => {
    const diff = buildDiff('a\nold\nc', 'a\nnew\nc');
    expect(
      recompose(diff.blocks, new Set(), new Map([['c0', ['edited']]])),
    ).toBe('a\nedited\nc');
  });

  test('a trailing newline survives the round trip', () => {
    const before = 'a\nb\n';
    const diff = buildDiff(before, 'a\nc\n');
    expect(recompose(diff.blocks, new Set())).toBe('a\nc\n');
    expect(recompose(diff.blocks, new Set(['c0']))).toBe(before);
  });
});

describe('changeStats and addedFor', () => {
  test('counts kept, reverted and lines', () => {
    const diff = buildDiff('a\nold1\nb\nold2', 'a\nnew1\nb\nnew2');
    // the two changed lines are separated by context, so two blocks
    expect(diff.changeCount).toBe(2);
    const stats = changeStats(diff.blocks, new Set());
    expect(stats).toEqual({
      kept: 2,
      reverted: 0,
      total: 2,
      addedLines: 2,
      removedLines: 2,
    });
    const reverted = changeStats(diff.blocks, new Set(['c0']));
    expect(reverted.kept).toBe(1);
    expect(reverted.reverted).toBe(1);
  });

  test('addedFor prefers the edit', () => {
    const block: DiffChangeBlock = {
      kind: 'change',
      id: 'c0',
      removed: [],
      added: ['x'],
    };
    expect(addedFor(block)).toEqual(['x']);
    expect(addedFor(block, new Map([['c0', ['y']]]))).toEqual(['y']);
  });
});

describe('wordDiff', () => {
  test('marks only the changed words', () => {
    const pair = wordDiff('the old line', 'the new line');
    expect(pair).not.toBeNull();
    expect(pair?.left.map((s) => s.text).join('')).toBe('the old line');
    expect(pair?.right.map((s) => s.text).join('')).toBe('the new line');
    expect(pair?.left.some((s) => s.changed)).toBe(true);
    expect(pair?.right.some((s) => s.changed)).toBe(true);
  });

  test('identical or huge lines are not diffed', () => {
    expect(wordDiff('same', 'same')).toBeNull();
    const long = 'x'.repeat(2001);
    expect(wordDiff(long, `${long}y`)).toBeNull();
  });
});
