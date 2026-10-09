/**
 * The availability state machine (plan doc/tabverse-gemma-nano-plan.md
 * section 7, "ai/__tests__/availability.test.ts").
 *
 * The rows this pins: state transitions checking -> absent/downloadable/
 * ready/error; retry from error (the one state a probe does not cache);
 * the test-reset hook; both API shapes (the current LanguageModel global and
 * the legacy ai.languageModel one) normalized onto the same states; and the
 * session layer's download transitions (downloading with progress, ready)
 * reaching subscribers.
 *
 * The fake API is installed on globalThis the way chromeMock installs
 * chrome: detection reads the global inside a function, so the test controls
 * what "this browser has" without a browser.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  getAiAvailability,
  noteAiDownloading,
  noteAiReady,
  probeAiAvailability,
  resetAiAvailabilityForTest,
  setAiAvailabilityForTest,
  subscribeAiAvailability,
} from '../availability';

type GlobalWithAi = typeof globalThis & {
  LanguageModel?: unknown;
  ai?: unknown;
};

const g = globalThis as GlobalWithAi;

beforeEach(() => {
  resetAiAvailabilityForTest();
  delete g.LanguageModel;
  delete g.ai;
});

afterEach(() => {
  resetAiAvailabilityForTest();
  delete g.LanguageModel;
  delete g.ai;
});

describe('probeAiAvailability', () => {
  test('no API surface is absent, not an error', async () => {
    const result = await probeAiAvailability();
    expect(result.state).toBe('absent');
    expect(getAiAvailability().state).toBe('absent');
  });

  test('the current LanguageModel shape maps its four answers', async () => {
    const answers: [string, string][] = [
      ['available', 'ready'],
      ['downloadable', 'downloadable'],
      ['downloading', 'downloading'],
      ['unavailable', 'absent'],
    ];
    for (const [answer, expected] of answers) {
      resetAiAvailabilityForTest();
      g.LanguageModel = {
        create: vi.fn(),
        availability: vi.fn(async () => answer),
      };
      const result = await probeAiAvailability();
      expect(result.state).toBe(expected);
    }
  });

  test('the legacy ai.languageModel shape maps its vocabulary too', async () => {
    const answers: [string, string][] = [
      ['yes', 'ready'],
      ['after-download', 'downloadable'],
      ['no', 'absent'],
    ];
    for (const [answer, expected] of answers) {
      resetAiAvailabilityForTest();
      g.ai = {
        languageModel: {
          create: vi.fn(),
          capabilities: vi.fn(async () => ({ available: answer })),
        },
      };
      const result = await probeAiAvailability();
      expect(result.state).toBe(expected);
    }
  });

  test('an unknown vocabulary word is downloadable, not a dead control', async () => {
    g.LanguageModel = {
      create: vi.fn(),
      availability: vi.fn(async () => 'something-new'),
    };
    const result = await probeAiAvailability();
    expect(result.state).toBe('downloadable');
  });

  test('a throwing probe is error, and error is retried on the next call', async () => {
    g.LanguageModel = {
      create: vi.fn(),
      availability: vi
        .fn()
        .mockRejectedValueOnce(new Error('model process gone'))
        .mockResolvedValueOnce('available'),
    };
    const first = await probeAiAvailability();
    expect(first.state).toBe('error');
    // error is the one state that does not settle: the next probe re-asks
    const second = await probeAiAvailability();
    expect(second.state).toBe('ready');
  });

  test('a settled answer is cached and not re-asked', async () => {
    const availability = vi.fn(async () => 'available');
    g.LanguageModel = { create: vi.fn(), availability };
    await probeAiAvailability();
    await probeAiAvailability();
    expect(availability).toHaveBeenCalledTimes(1);
  });

  test('concurrent probes share one in-flight call', async () => {
    let resolve!: (value: string) => void;
    const availability = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    g.LanguageModel = { create: vi.fn(), availability };
    const [a, b] = [probeAiAvailability(), probeAiAvailability()];
    resolve('available');
    const [ra, rb] = await Promise.all([a, b]);
    expect(availability).toHaveBeenCalledTimes(1);
    expect(ra.state).toBe('ready');
    expect(rb.state).toBe('ready');
  });
});

describe('download transitions and subscribers', () => {
  test('subscribers are notified and unsubscribe works', async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAiAvailability(() => {
      seen.push(getAiAvailability().state);
    });
    noteAiDownloading(0.5);
    noteAiReady();
    unsubscribe();
    noteAiDownloading(0.1); // after unsubscribe: no notification
    expect(seen).toEqual(['downloading', 'ready']);
  });

  test('downloading carries its progress, ready carries none', () => {
    noteAiDownloading(0.25);
    expect(getAiAvailability()).toEqual({
      state: 'downloading',
      progress: 0.25,
    });
    noteAiReady();
    expect(getAiAvailability()).toEqual({ state: 'ready', progress: null });
  });

  test('an unchanged state does not notify (keeps useSyncExternalStore quiet)', () => {
    noteAiReady();
    const listener = vi.fn();
    subscribeAiAvailability(listener);
    noteAiReady(); // same state, same progress: no event
    expect(listener).not.toHaveBeenCalled();
  });

  test('setAiAvailabilityForTest lands directly, reset returns to checking', () => {
    setAiAvailabilityForTest({ state: 'ready', progress: null });
    expect(getAiAvailability().state).toBe('ready');
    resetAiAvailabilityForTest();
    expect(getAiAvailability().state).toBe('checking');
  });

  test('after reset the probe runs again (the cache went with it)', async () => {
    g.LanguageModel = {
      create: vi.fn(),
      availability: vi.fn(async () => 'available'),
    };
    await probeAiAvailability();
    resetAiAvailabilityForTest();
    await probeAiAvailability();
    const availability = (g.LanguageModel as { availability: unknown })
      .availability as ReturnType<typeof vi.fn>;
    expect(availability).toHaveBeenCalledTimes(2);
  });
});
