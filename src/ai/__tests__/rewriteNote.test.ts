import { describe, expect, test, vi } from 'vitest';

import {
  DEFAULT_NOTE_INSTRUCTION,
  DEFAULT_NOTE_REWRITE_BUDGET_CHARS,
  MAX_NOTE_REWRITE_CHARS,
  NOTE_REWRITE_RESPONSE_SCHEMA,
  buildNoteRewritePrompt,
  noteRewriteBudgetFor,
  parseNoteRewrite,
  rewriteNote,
} from '../rewriteNote';
import type { AiSession } from '../session';

function fakeSession(
  reply: string,
  inputQuota?: number,
): AiSession & { prompt: ReturnType<typeof vi.fn> } {
  const prompt = vi.fn(async () => reply);
  return { prompt, inputQuota } as AiSession & {
    prompt: ReturnType<typeof vi.fn>;
  };
}

describe('buildNoteRewritePrompt', () => {
  test('opens with the instruction, then the note', () => {
    const prompt = buildNoteRewritePrompt(
      'make it shorter',
      '# Note\n\nbody',
      1000,
    );
    expect(prompt).toBe(
      'Instruction: make it shorter\n\nCurrent Note Content:\n# Note\n\nbody',
    );
  });

  test('an empty instruction falls back to the default', () => {
    const prompt = buildNoteRewritePrompt('   ', 'body', 1000);
    expect(prompt).toContain(`Instruction: ${DEFAULT_NOTE_INSTRUCTION}`);
  });

  test('an empty note is still a request', () => {
    const prompt = buildNoteRewritePrompt('write an intro', '', 1000);
    expect(prompt).toBe(
      'Instruction: write an intro\n\nCurrent Note Content:\n',
    );
  });

  test('the instruction is collapsed to one line', () => {
    const prompt = buildNoteRewritePrompt('one\ntwo\tthree', 'body', 1000);
    expect(prompt).toContain('Instruction: one two three');
  });

  test('never exceeds the budget', () => {
    const prompt = buildNoteRewritePrompt('x', 'y'.repeat(5000), 200);
    expect(prompt.length).toBeLessThanOrEqual(200);
  });

  test('a budget too small for the header yields nothing', () => {
    expect(buildNoteRewritePrompt('x', 'body', 5)).toBe('');
    expect(buildNoteRewritePrompt('x', 'body', 0)).toBe('');
  });
});

describe('parseNoteRewrite', () => {
  test('takes the content field of a JSON reply', () => {
    expect(parseNoteRewrite('{"content":"# Title\\n\\nbody"}')).toBe(
      '# Title\n\nbody',
    );
  });

  test('a JSON reply wrapped in a fence still parses', () => {
    expect(parseNoteRewrite('```json\n{"content":"# Title"}\n```')).toBe(
      '# Title',
    );
  });

  test('a markdown reply is still accepted, trimmed and collapsed', () => {
    expect(parseNoteRewrite('  # Title  \n\n\n\nbody  ')).toBe(
      '# Title\n\nbody',
    );
  });

  test('unwraps a fence around the whole document', () => {
    expect(parseNoteRewrite('```markdown\n# Title\n\nbody\n```')).toBe(
      '# Title\n\nbody',
    );
    expect(parseNoteRewrite('```\n# Title\n```')).toBe('# Title');
  });

  test('keeps fences that are inside the document', () => {
    const withCode = '# Title\n\n```\nconst a = 1;\n```\n\nmore';
    expect(parseNoteRewrite(withCode)).toBe(withCode);
  });

  test('strips control characters but keeps newlines', () => {
    expect(parseNoteRewrite('a\u0000b\nc')).toBe('a b\nc');
  });

  test('an empty reply is empty', () => {
    expect(parseNoteRewrite('')).toBe('');
    expect(parseNoteRewrite('   \n  ')).toBe('');
  });

  test('caps a very long reply', () => {
    expect(
      parseNoteRewrite('x'.repeat(MAX_NOTE_REWRITE_CHARS + 500)).length,
    ).toBe(MAX_NOTE_REWRITE_CHARS);
  });
});

describe('noteRewriteBudgetFor', () => {
  test('falls back to the constant without a quota', () => {
    expect(noteRewriteBudgetFor(fakeSession(''))).toBe(
      DEFAULT_NOTE_REWRITE_BUDGET_CHARS,
    );
  });

  test('a small quota lowers the budget, a large one never raises it', () => {
    expect(noteRewriteBudgetFor(fakeSession('', 100))).toBe(350);
    expect(noteRewriteBudgetFor(fakeSession('', 1_000_000))).toBe(
      DEFAULT_NOTE_REWRITE_BUDGET_CHARS,
    );
  });
});

describe('rewriteNote', () => {
  test('prompts the model with the JSON constraint and parses the note', async () => {
    const session = fakeSession('{"content":"# New\\n\\nrevised body"}');
    await expect(rewriteNote(session, 'tighten it', 'old body')).resolves.toBe(
      '# New\n\nrevised body',
    );
    expect(session.prompt).toHaveBeenCalledTimes(1);
    expect(session.prompt.mock.calls[0][0]).toContain('tighten it');
    expect(session.prompt.mock.calls[0][0]).toContain('old body');
    expect(session.prompt.mock.calls[0][1]).toEqual({
      responseConstraint: NOTE_REWRITE_RESPONSE_SCHEMA,
    });
  });

  test('a non-JSON reply does not throw', async () => {
    const session = fakeSession('Okay, here is the note:\n\n# New');
    await expect(rewriteNote(session, 'x', 'y')).resolves.toContain('# New');
  });
});
