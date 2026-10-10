/**
 * The session cache (plan doc/tabverse-gemma-nano-plan.md section 7,
 * "ai/__tests__/session.test.ts").
 *
 * The rows this pins, in the plan's words: factory called once across two
 * requests; a rejecting factory -> error, never an unhandled throw; destroy
 * on pagehide; and from the decisions table, D4 (a downloadable model starts
 * downloading on create, and its progress reaches availability) and D9
 * (failure clears the cache, so the next call is a fresh session).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  getAiAvailability,
  resetAiAvailabilityForTest,
  setAiAvailabilityForTest,
} from '../availability';
import {
  AiUnavailableError,
  destroyAiSessions,
  ensureAiSession,
  evictAiSession,
  resetAiSessionsForTest,
  setAiSessionFactoryForTest,
} from '../session';
import { MemoryStorageArea } from '../../data/repo/outbox';
import { loadPromptLog, setPromptLogStorageForTest } from '../promptLog';

type GlobalWithAi = typeof globalThis & {
  window?: unknown;
  LanguageModel?: unknown;
  ai?: unknown;
};

const g = globalThis as GlobalWithAi;

/** Let queued microtasks (the fire-and-forget destroy chains) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeSession = () => {
  const prompt = vi.fn(async () => 'A name\nB name\nC name');
  const destroy = vi.fn();
  return { session: { prompt, destroy }, prompt, destroy };
};

beforeEach(() => {
  resetAiSessionsForTest();
  resetAiAvailabilityForTest();
  // every exchange is recorded; keep that in memory so a test never touches
  // (or needs) chrome.storage.local
  setPromptLogStorageForTest(new MemoryStorageArea());
  delete g.window;
  delete g.LanguageModel;
  delete g.ai;
});

afterEach(() => {
  resetAiSessionsForTest();
  resetAiAvailabilityForTest();
  setPromptLogStorageForTest(null);
  delete g.window;
  delete g.LanguageModel;
  delete g.ai;
});

describe('prompt logging', () => {
  test('a successful exchange is recorded, with its system prompt and timing', async () => {
    setAiSessionFactoryForTest(async () => ({
      prompt: async () => 'the answer',
    }));
    const session = await ensureAiSession('a system prompt');
    const answer = await session.prompt('the question');
    expect(answer).toBe('the answer');

    // the write is fire-and-forget on purpose (a log entry must never delay or
    // break the answer), so let it land before reading it back
    await flush();
    const log = await loadPromptLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      systemPrompt: 'a system prompt',
      input: 'the question',
      output: 'the answer',
      error: null,
    });
    expect(log[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test('a failed exchange is recorded too, and the error still reaches the caller', async () => {
    setAiSessionFactoryForTest(async () => ({
      prompt: async () => {
        throw new Error('model went away');
      },
    }));
    const session = await ensureAiSession('a system prompt');
    await expect(session.prompt('the question')).rejects.toThrow(
      'model went away',
    );

    const log = await loadPromptLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      input: 'the question',
      output: null,
      error: 'model went away',
    });
  });
});
describe('ensureAiSession', () => {
  test('factory called once across two requests', async () => {
    const { session } = fakeSession();
    const factory = vi.fn(async () => session);
    setAiSessionFactoryForTest(factory);

    const first = await ensureAiSession('system prompt');
    const second = await ensureAiSession('system prompt');
    expect(factory).toHaveBeenCalledTimes(1);
    // the same cached session is handed back, and it answers through to the
    // factory's own (the logger wraps it, so identity is not the contract)
    expect(first).toBe(second);
    await expect(first.prompt('x')).resolves.toContain('A name');
  });

  test('different system prompts are different sessions', async () => {
    const a = fakeSession();
    const b = fakeSession();
    const factory = vi
      .fn()
      .mockResolvedValueOnce(a.session)
      .mockResolvedValueOnce(b.session);
    setAiSessionFactoryForTest(factory);

    await ensureAiSession('naming');
    await ensureAiSession('questioning');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(1, 'naming');
    expect(factory).toHaveBeenNthCalledWith(2, 'questioning');
  });

  test('a rejecting factory -> error, and the next call retries fresh', async () => {
    const { session } = fakeSession();
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('model crashed'))
      .mockResolvedValueOnce(session);
    setAiSessionFactoryForTest(factory);

    // never an unhandled throw: the rejection reaches the caller, who the
    // UI contract says always catches (D9)
    await expect(ensureAiSession('p')).rejects.toThrow('model crashed');
    expect(getAiAvailability().state).toBe('error');

    // the cache entry went with the failure: fresh factory call
    const recovered = await ensureAiSession('p');
    expect(factory).toHaveBeenCalledTimes(2);
    await expect(recovered.prompt('x')).resolves.toContain('A name');
  });

  test('AiUnavailableError is absent, not error - retry cannot conjure an API', async () => {
    setAiSessionFactoryForTest(async () => {
      throw new AiUnavailableError('no API here');
    });
    await expect(ensureAiSession('p')).rejects.toThrow('no API here');
    expect(getAiAvailability().state).toBe('absent');
  });

  test('evict drops the cache and destroys what existed', async () => {
    const { session, destroy } = fakeSession();
    setAiSessionFactoryForTest(async () => session);
    await ensureAiSession('p');
    evictAiSession('p');
    // destruction of a resolved session happens on a microtask
    await flush();
    expect(destroy).toHaveBeenCalledTimes(1);

    // next call is a fresh session, not the evicted one
    const factory = vi.fn(async () => fakeSession().session);
    setAiSessionFactoryForTest(factory);
    await ensureAiSession('p');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('destroyAiSessions', () => {
  test('destroys every cached session and empties the cache', async () => {
    const one = fakeSession();
    const two = fakeSession();
    setAiSessionFactoryForTest(async () => one.session);
    await ensureAiSession('a');
    setAiSessionFactoryForTest(async () => two.session);
    await ensureAiSession('b');

    destroyAiSessions();
    await flush();
    expect(one.destroy).toHaveBeenCalledTimes(1);
    expect(two.destroy).toHaveBeenCalledTimes(1);

    // the cache is empty: a later call creates again
    const factory = vi.fn(async () => fakeSession().session);
    setAiSessionFactoryForTest(factory);
    await ensureAiSession('a');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test('a session that never resolved does not wedge the destroy', async () => {
    const { session, destroy } = fakeSession();
    setAiSessionFactoryForTest(async () => session);
    const pending = ensureAiSession('slow');
    destroyAiSessions(); // before it resolves
    await pending;
    await flush();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('pagehide binds once and calls destroy', async () => {
    const listeners: Record<string, () => void> = {};
    g.window = {
      addEventListener: (type: string, handler: () => void) => {
        listeners[type] = handler;
      },
      // the shape only has to answer `typeof window` and one
      // addEventListener call; lib.dom's Window is not what is under test
    } as unknown as Window & typeof globalThis;
    const { session, destroy } = fakeSession();
    setAiSessionFactoryForTest(async () => session);
    await ensureAiSession('p');
    await ensureAiSession('p'); // second call must not re-bind
    expect(Object.keys(listeners)).toEqual(['pagehide']);

    listeners.pagehide();
    await flush();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('no window (node tests): binding is skipped, nothing throws', async () => {
    const { session } = fakeSession();
    setAiSessionFactoryForTest(async () => session);
    const resolved = await ensureAiSession('p');
    await expect(resolved.prompt('x')).resolves.toContain('A name');
  });
});

describe('default factory against a fake API', () => {
  test('downloadable starts the download and reports progress (D4)', async () => {
    setAiAvailabilityForTest({ state: 'downloadable', progress: null });
    let monitorCb:
      | ((event: { loaded: number; total: number }) => void)
      | undefined;
    g.LanguageModel = {
      availability: async () => 'downloadable',
      create: vi.fn(async (options: { monitor?: (m: unknown) => void }) => {
        options.monitor?.({
          addEventListener: (
            type: string,
            handler: (event: { loaded: number; total: number }) => void,
          ) => {
            if (type === 'downloadprogress') {
              monitorCb = handler;
            }
          },
        });
        // the model would finish here; report progress first
        monitorCb?.({ loaded: 50, total: 200 });
        return {
          prompt: async () => 'name',
          inputQuota: 900,
        };
      }),
    };

    const session = await ensureAiSession('naming');
    expect(getAiAvailability().state).toBe('ready');
    expect(session.inputQuota).toBe(900);
    // progress flowed through availability while downloading
    expect(monitorCb).toBeDefined();
  });

  test('no API at all -> AiUnavailableError and absent', async () => {
    await expect(ensureAiSession('p')).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(getAiAvailability().state).toBe('absent');
  });

  test('a ready model creates without touching the downloading state', async () => {
    setAiAvailabilityForTest({ state: 'ready', progress: null });
    const states: string[] = [];
    g.LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => {
          states.push(getAiAvailability().state);
          return 'ok';
        },
      }),
    };
    const session = await ensureAiSession('p');
    await session.prompt('x');
    expect(states).toEqual(['ready']);
  });
});
