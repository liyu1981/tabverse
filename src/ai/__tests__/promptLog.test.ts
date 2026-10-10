/**
 * The local prompt log (src/ai/promptLog.ts).
 *
 * What this pins: entries are newest first, the log is capped so it cannot grow
 * without bound, clearing empties it, subscribers hear about both - and, the
 * rule the module exists to keep, a broken or full store costs nothing but the
 * log entry (recording must never be able to break the AI call it describes).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  MemoryStorageArea,
  type StorageAreaLike,
} from '../../data/repo/outbox';
import {
  PROMPT_LOG_KEY,
  PROMPT_LOG_LIMIT,
  type PromptLogEntry,
  appendPromptLog,
  clearPromptLog,
  loadPromptLog,
  setPromptLogStorageForTest,
  subscribePromptLog,
} from '../promptLog';

const entry = (at: number, input = `question ${at}`): PromptLogEntry => ({
  at,
  systemPrompt: 'a system prompt',
  input,
  output: `answer ${at}`,
  error: null,
  durationMs: 5,
});

let storage: MemoryStorageArea;

beforeEach(() => {
  storage = new MemoryStorageArea();
  setPromptLogStorageForTest(storage);
});

afterEach(() => {
  setPromptLogStorageForTest(null);
});

describe('appendPromptLog', () => {
  test('keeps the newest first', async () => {
    await appendPromptLog(entry(1));
    await appendPromptLog(entry(2));
    const log = await loadPromptLog();
    expect(log.map((e) => e.at)).toEqual([2, 1]);
  });

  test('caps the log, dropping the oldest', async () => {
    for (let i = 0; i < PROMPT_LOG_LIMIT + 5; i++) {
      await appendPromptLog(entry(i));
    }
    const log = await loadPromptLog();
    expect(log).toHaveLength(PROMPT_LOG_LIMIT);
    // the newest survived, the five oldest did not
    expect(log[0].at).toBe(PROMPT_LOG_LIMIT + 4);
    expect(log[log.length - 1].at).toBe(5);
  });

  test('overlapping calls do not lose an entry', async () => {
    // no await between them: the read-modify-write has to be serialized
    const writes = [entry(1), entry(2), entry(3)].map((e) =>
      appendPromptLog(e),
    );
    await Promise.all(writes);
    expect(await loadPromptLog()).toHaveLength(3);
  });

  test('a failing store does not reject the caller', async () => {
    const broken: StorageAreaLike = {
      get: async () => {
        throw new Error('quota');
      },
      set: async () => {
        throw new Error('quota');
      },
      remove: async () => {
        throw new Error('quota');
      },
    };
    setPromptLogStorageForTest(broken);
    await expect(appendPromptLog(entry(1))).resolves.toBeUndefined();
    expect(await loadPromptLog()).toEqual([]);
  });
});

describe('loadPromptLog', () => {
  test('nothing stored reads as nothing, not as an error', async () => {
    expect(await loadPromptLog()).toEqual([]);
  });

  test('a value that is not a log reads as nothing', async () => {
    await storage.set({ [PROMPT_LOG_KEY]: 42 });
    expect(await loadPromptLog()).toEqual([]);
    await storage.set({ [PROMPT_LOG_KEY]: [{ nonsense: true }] });
    expect(await loadPromptLog()).toEqual([]);
  });
});

describe('clearPromptLog', () => {
  test('empties the log', async () => {
    await appendPromptLog(entry(1));
    await clearPromptLog();
    expect(await loadPromptLog()).toEqual([]);
  });
});

describe('subscribePromptLog', () => {
  test('hears about an append and a clear', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePromptLog(listener);
    await appendPromptLog(entry(1));
    expect(listener).toHaveBeenCalledTimes(1);
    await clearPromptLog();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await appendPromptLog(entry(2));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
