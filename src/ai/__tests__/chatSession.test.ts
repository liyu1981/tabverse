/**
 * The chat's streaming session (`src/ai/chatSession.ts`).
 *
 * This drives the real `createChatSession` against a fake `LanguageModel`
 * global, because the part worth pinning is the wrapper in between: how a
 * cumulative stream becomes deltas, what a build without `promptStreaming`
 * does, that the seeded history and system prompt reach `create`, and that the
 * context usage is read across both API namings.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { getAiAvailability, resetAiAvailabilityForTest } from '../availability';
import {
  ContextOverflowError,
  createChatSession,
  isContextOverflowError,
  setChatSessionFactoryForTest,
} from '../chatSession';

type GlobalWithAi = typeof globalThis & {
  LanguageModel?: unknown;
  ai?: unknown;
};
const g = globalThis as GlobalWithAi;

function streamOf(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

interface FakeRawOptions {
  chunks?: string[];
  streaming?: boolean;
  usage?: { used: number; total: number };
}

function installFakeModel(options: FakeRawOptions) {
  const calls = {
    create: [] as Array<Record<string, unknown>>,
    destroy: 0,
    inputs: [] as string[],
  };
  const raw = {
    prompt: async () => options.chunks?.join('') ?? '',
    destroy: () => {
      calls.destroy += 1;
    },
    ...(options.usage
      ? { contextUsage: options.usage.used, contextWindow: options.usage.total }
      : {}),
    ...(options.streaming === false
      ? {}
      : {
          promptStreaming: (input: string) => {
            calls.inputs.push(input);
            return streamOf(options.chunks ?? []);
          },
        }),
  };
  g.LanguageModel = {
    create: async (createOptions: Record<string, unknown>) => {
      calls.create.push(createOptions);
      return raw;
    },
  };
  return calls;
}

beforeEach(() => {
  setChatSessionFactoryForTest(null);
  resetAiAvailabilityForTest();
  delete g.LanguageModel;
  delete g.ai;
});

afterEach(() => {
  setChatSessionFactoryForTest(null);
  resetAiAvailabilityForTest();
  delete g.LanguageModel;
  delete g.ai;
});

describe('a cumulative stream', () => {
  test('is turned into deltas, and the whole reply is the result', async () => {
    installFakeModel({ chunks: ['Hello', 'Hello wor', 'Hello world'] });
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    const deltas: string[] = [];
    const result = await session.send('hi', {
      onDelta: (delta) => deltas.push(delta),
    });
    expect(deltas).toEqual(['Hello', ' wor', 'ld']);
    expect(result.text).toBe('Hello world');
  });
});

describe('a stream that sends deltas', () => {
  test('is detected and appended rather than replaced', async () => {
    installFakeModel({ chunks: ['Hello', ' wor', 'ld'] });
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    const deltas: string[] = [];
    const result = await session.send('hi', {
      onDelta: (delta) => deltas.push(delta),
    });
    expect(deltas).toEqual(['Hello', ' wor', 'ld']);
    expect(result.text).toBe('Hello world');
  });
});

describe('a build with no streaming', () => {
  test('falls back to one prompt, handed over whole', async () => {
    installFakeModel({ chunks: ['one answer'], streaming: false });
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    const deltas: string[] = [];
    const result = await session.send('hi', {
      onDelta: (delta) => deltas.push(delta),
    });
    expect(deltas).toEqual(['one answer']);
    expect(result.text).toBe('one answer');
  });
});

describe('the session is created the way the chat needs', () => {
  test('the system prompt and the seeded history reach create', async () => {
    const calls = installFakeModel({ chunks: ['ok'] });
    const history = [
      { role: 'user' as const, content: 'earlier' },
      { role: 'assistant' as const, content: 'answer' },
    ];
    await createChatSession({ systemPrompt: 'the system prompt', history });
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].systemPrompt).toBe('the system prompt');
    expect(calls.create[0].initialPrompts).toEqual(history);
  });
});

describe('stats', () => {
  test('the context usage is read, and an estimate is given for the output', async () => {
    installFakeModel({ chunks: ['12345678'], usage: { used: 40, total: 100 } });
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    const result = await session.send('hi');
    expect(result.outputTokens).toBe(2);
    // the fake answers instantly, so the rate is 0ms-denominated; it only has
    // to be a real number, never NaN or negative
    expect(Number.isFinite(result.tokensPerSecond)).toBe(true);
    expect(result.tokensPerSecond).toBeGreaterThanOrEqual(0);
    expect(result.usage).toEqual({ used: 40, total: 100 });
    expect(session.usage()).toEqual({ used: 40, total: 100 });
  });

  test('a build that reports nothing reads as null, not as zero', async () => {
    installFakeModel({ chunks: ['an answer'] });
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    const result = await session.send('hi');
    expect(result.usage).toEqual({ used: null, total: null });
  });

  test('the older inputUsage / inputQuota naming is read too', async () => {
    // the fake reports the modern pair; this drives the fallback directly
    installFakeModel({ chunks: ['ok'] });
    // re-install with the legacy names on the same fake
    (g.LanguageModel as { create: unknown }).create = async () => ({
      prompt: async () => 'ok',
      promptStreaming: () => streamOf(['ok']),
      inputUsage: 7,
      inputQuota: 20,
    });
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    const result = await session.send('hi');
    expect(result.usage).toEqual({ used: 7, total: 20 });
  });
});

describe('the availability state follows the download', () => {
  test('a successful create reports the model ready', async () => {
    installFakeModel({ chunks: ['ok'] });
    await createChatSession({ systemPrompt: 'sys', history: [] });
    expect(getAiAvailability().state).toBe('ready');
  });
});

describe('context overflow', () => {
  test('a quota-flavoured failure is an overflow, a plain one is not', () => {
    expect(isContextOverflowError(new Error('quota exceeded'))).toBe(true);
    expect(isContextOverflowError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isContextOverflowError(new Error('the model went away'))).toBe(
      false,
    );
    expect(isContextOverflowError(null)).toBe(false);
  });

  test('a contextoverflow event turns an unhelpful failure into an overflow', async () => {
    const listeners: Record<string, () => void> = {};
    g.LanguageModel = {
      create: async () => ({
        prompt: async () => '',
        promptStreaming: () => {
          listeners.contextoverflow?.();
          throw new Error('something unhelpful');
        },
        addEventListener: (type: string, listener: () => void) => {
          listeners[type] = listener;
        },
      }),
    };
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    await expect(session.send('hi')).rejects.toBeInstanceOf(
      ContextOverflowError,
    );
  });

  test('a usage sitting on the window is treated as an overflow too', async () => {
    g.LanguageModel = {
      create: async () => ({
        prompt: async () => {
          throw new Error('something unhelpful');
        },
        contextUsage: 100,
        contextWindow: 100,
      }),
    };
    const session = await createChatSession({
      systemPrompt: 'sys',
      history: [],
    });
    await expect(session.send('hi')).rejects.toBeInstanceOf(
      ContextOverflowError,
    );
  });
});
