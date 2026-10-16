/**
 * One turn of the chat, end to end over the stores
 * (`src/data/aiChat/runtime.ts`).
 *
 * The session is injected, so this drives the real orchestration - the two
 * messages, the streaming patches, the failure bubble, the seeding, the stop
 * and the clear - without a browser or a model.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  type ChatSession,
  type ChatSessionOptions,
  type ChatTurnResult,
  ContextOverflowError,
  setChatSessionFactoryForTest,
} from '../../../ai/chatSession';
import type { AiInitialPrompt } from '../../../ai/languageModel';
import { MemoryStorageArea, type StorageAreaLike } from '../../repo/outbox';
import { newChatMessage } from '../AiChat';
import {
  AI_CHAT_STORAGE_KEY,
  loadStoredChat,
  setChatStorageForTest,
} from '../persist';
import {
  clearChat,
  loadChat,
  regenerateChat,
  resetChatRuntimeForTest,
  sendChat,
  stopChat,
} from '../runtime';
import {
  $chatContext,
  $chatDraft,
  $chatError,
  $chatMessages,
  $chatStatus,
  $chatUsage,
  chatMessagesApi,
  setChatContext,
  setChatDraft,
  setChatError,
  setChatLoaded,
  setChatStatus,
  setChatUsage,
} from '../store';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const result = (over: Partial<ChatTurnResult> = {}): ChatTurnResult => ({
  text: 'Hello world',
  durationMs: 100,
  outputTokens: 3,
  tokensPerSecond: 30,
  usage: { used: 12, total: 100 },
  ...over,
});

function fakeSession(over: Partial<ChatSession> = {}): ChatSession {
  return {
    send: vi.fn(async (_input, handlers) => {
      handlers?.onDelta?.('Hello', 'Hello');
      handlers?.onDelta?.(' world', 'Hello world');
      return result();
    }),
    usage: () => ({ used: 12, total: 100 }),
    destroy: vi.fn(),
    ...over,
  };
}

let storage: MemoryStorageArea;

function resetStores(): void {
  chatMessagesApi.clear();
  setChatLoaded(false);
  setChatStatus('idle');
  setChatUsage({ used: null, total: null });
  setChatError(null);
  setChatDraft('');
  setChatContext(null);
  resetChatRuntimeForTest();
}

beforeEach(() => {
  storage = new MemoryStorageArea();
  setChatStorageForTest(storage);
  setChatSessionFactoryForTest(null);
  resetStores();
});

afterEach(() => {
  setChatStorageForTest(null);
  setChatSessionFactoryForTest(null);
  resetStores();
});

test('a turn stores the question and the answer, and the answer is filled in', async () => {
  setChatSessionFactoryForTest(async () => fakeSession());
  setChatDraft('what is up');
  await sendChat('what is up');
  const messages = $chatMessages.getState();
  expect(messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(messages[0].content).toBe('what is up');
  expect(messages[1].content).toBe('Hello world');
  expect(messages[1].tokensPerSecond).toBe(30);
  expect(messages[1].outputTokens).toBe(3);
  expect($chatUsage.getState()).toEqual({ used: 12, total: 100 });
  expect($chatStatus.getState()).toBe('idle');
  // the composer is emptied as the question is asked
  expect($chatDraft.getState()).toBe('');
  // the turn is written down, so a reload keeps it
  await expect(loadStoredChat()).resolves.toHaveLength(2);
});

test('an attached page rides on the question, and the model is given it', async () => {
  const send = vi.fn(async (_input: string) => result());
  setChatSessionFactoryForTest(async () => fakeSession({ send }));
  setChatContext({
    title: 'A Page',
    url: 'https://example.com',
    markdown: '# Heading',
  });
  await sendChat('what is this?');

  // the question the person typed is what the bubble stores
  const question = $chatMessages.getState()[0];
  expect(question.content).toBe('what is this?');
  expect(question.context?.title).toBe('A Page');
  // ...and the model is handed the page and the question, together
  const sent = send.mock.calls[0][0];
  expect(sent).toContain('# Heading');
  expect(sent).toContain('what is this?');
  // the attachment is spent, not left for the next question
  expect($chatContext.getState()).toBeNull();
});

test('the answer is patched in as it streams', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setChatSessionFactoryForTest(async () =>
    fakeSession({
      send: async (_input, handlers) => {
        handlers?.onDelta?.('Hel', 'Hel');
        await gate;
        handlers?.onDelta?.('lo', 'Hello');
        return result({ text: 'Hello' });
      },
    }),
  );
  const pending = sendChat('hi');
  await flush();
  expect($chatMessages.getState()[1].content).toBe('Hel');
  expect($chatStatus.getState()).toBe('streaming');
  release();
  await pending;
  expect($chatMessages.getState()[1].content).toBe('Hello');
});

test('the first turn seeds the session with the conversation so far', async () => {
  await storage.set({
    [AI_CHAT_STORAGE_KEY]: [
      newChatMessage('user', 'old question'),
      newChatMessage('assistant', 'old answer'),
    ],
  });
  await loadChat();
  const seeded: ChatSessionOptions[] = [];
  setChatSessionFactoryForTest(async (options) => {
    seeded.push(options);
    return fakeSession();
  });
  await sendChat('new question');
  expect(seeded).toHaveLength(1);
  expect(seeded[0]).toMatchObject({
    history: [
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
    ],
  });
});

test('later turns reuse the session instead of reseeding it', async () => {
  let creates = 0;
  setChatSessionFactoryForTest(async () => {
    creates += 1;
    return fakeSession();
  });
  await sendChat('one');
  await sendChat('two');
  expect(creates).toBe(1);
  expect($chatMessages.getState()).toHaveLength(4);
});

test('regenerating drops the old answer and asks the question again', async () => {
  const asked: string[] = [];
  setChatSessionFactoryForTest(async () =>
    fakeSession({
      send: async (input, handlers) => {
        asked.push(input);
        handlers?.onDelta?.('second', 'second');
        return result({ text: 'second' });
      },
    }),
  );
  chatMessagesApi.add(newChatMessage('user', 'q1'));
  chatMessagesApi.add(newChatMessage('assistant', 'a1'));
  await regenerateChat();
  const messages = $chatMessages.getState();
  expect(messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(messages[0].content).toBe('q1');
  expect(messages[1].content).toBe('second');
  expect(asked).toEqual(['q1']);
});

test('regenerating seeds from the history that has no answer in it', async () => {
  const seeded: ChatSessionOptions[] = [];
  setChatSessionFactoryForTest(async (options) => {
    seeded.push(options);
    return fakeSession();
  });
  chatMessagesApi.add(newChatMessage('user', 'q1'));
  chatMessagesApi.add(newChatMessage('assistant', 'a1'));
  chatMessagesApi.add(newChatMessage('user', 'q2'));
  chatMessagesApi.add(newChatMessage('assistant', 'a2'));
  await regenerateChat();
  expect(seeded).toHaveLength(1);
  expect(seeded[0].history).toEqual([
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
  ]);
  expect($chatMessages.getState()).toHaveLength(4);
});

test('regenerating with nothing to ask again does nothing', async () => {
  let creates = 0;
  setChatSessionFactoryForTest(async () => {
    creates += 1;
    return fakeSession();
  });
  await regenerateChat();
  expect(creates).toBe(0);
  expect($chatMessages.getState()).toEqual([]);
});

describe('when the context overflows', () => {
  test('the older turns are compacted and the question is answered', async () => {
    const chatHistories: AiInitialPrompt[][] = [];
    let chatAttempts = 0;
    setChatSessionFactoryForTest(async (options) => {
      if (options.systemPrompt.includes('compress')) {
        return fakeSession({
          send: async () => result({ text: 'SUMMARY OF OLDER TURNS' }),
        });
      }
      chatHistories.push(options.history);
      chatAttempts += 1;
      const attempt = chatAttempts;
      return fakeSession({
        send: async (_input, handlers) => {
          if (attempt === 1) {
            throw new ContextOverflowError('the context window is full');
          }
          handlers?.onDelta?.('after compacting', 'after compacting');
          return result({ text: 'after compacting' });
        },
      });
    });

    for (let index = 0; index < 10; index++) {
      chatMessagesApi.add(newChatMessage('user', `q${index}`));
      chatMessagesApi.add(newChatMessage('assistant', `a${index}`));
    }
    await sendChat('the last question');

    const messages = $chatMessages.getState();
    expect(messages[0].role).toBe('system');
    expect(messages[0].compacted).toBe(true);
    expect(messages[0].content).toBe('SUMMARY OF OLDER TURNS');
    const last = messages[messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('after compacting');
    expect(last.error).toBeNull();
    // the failed bubble did not survive the retry
    expect(
      messages.some(
        (message) => message.error === 'the context window is full',
      ),
    ).toBe(false);
    // the retry was seeded from the compacted history, summary first
    expect(chatHistories).toHaveLength(2);
    expect(chatHistories[1][0]).toEqual({
      role: 'system',
      content: 'SUMMARY OF OLDER TURNS',
    });
  });

  test('a conversation too short to compact shows the failure', async () => {
    setChatSessionFactoryForTest(async () =>
      fakeSession({
        send: async () => {
          throw new ContextOverflowError('the context window is full');
        },
      }),
    );
    await sendChat('a question');
    const messages = $chatMessages.getState();
    expect(messages).toHaveLength(2);
    expect(messages[1].error).toContain('context window');
    expect($chatError.getState()).toContain('context window');
  });

  test('a summarizer that fails drops the older turns rather than the turn', async () => {
    let chatAttempts = 0;
    setChatSessionFactoryForTest(async (options) => {
      if (options.systemPrompt.includes('compress')) {
        return fakeSession({
          send: async () => {
            throw new Error('the summarizer is unavailable');
          },
        });
      }
      chatAttempts += 1;
      const attempt = chatAttempts;
      return fakeSession({
        send: async (_input, handlers) => {
          if (attempt === 1) {
            throw new ContextOverflowError('the context window is full');
          }
          handlers?.onDelta?.('an answer', 'an answer');
          return result({ text: 'an answer' });
        },
      });
    });
    for (let index = 0; index < 8; index++) {
      chatMessagesApi.add(newChatMessage('user', `q${index}`));
      chatMessagesApi.add(newChatMessage('assistant', `a${index}`));
    }
    await sendChat('the last question');
    const messages = $chatMessages.getState();
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('dropped to fit the context window');
    const last = messages[messages.length - 1];
    expect(last.content).toBe('an answer');
    expect(last.error).toBeNull();
  });
});

test('a failed answer is a bubble with the reason, not silence', async () => {
  setChatSessionFactoryForTest(async () =>
    fakeSession({
      send: async () => {
        throw new Error('model went away');
      },
    }),
  );
  await sendChat('hi');
  const assistant = $chatMessages.getState()[1];
  expect(assistant.error).toBe('model went away');
  expect($chatError.getState()).toBe('model went away');
  expect($chatStatus.getState()).toBe('idle');
});

test('an empty draft is not a turn', async () => {
  let creates = 0;
  setChatSessionFactoryForTest(async () => {
    creates += 1;
    return fakeSession();
  });
  await sendChat('   ');
  expect(creates).toBe(0);
  expect($chatMessages.getState()).toEqual([]);
});

test('a stop ends the turn and drops the session', async () => {
  const destroy = vi.fn();
  setChatSessionFactoryForTest(async () =>
    fakeSession({
      send: () => new Promise<ChatTurnResult>(() => undefined),
      destroy,
    }),
  );
  void sendChat('hi');
  await flush();
  stopChat();
  expect($chatStatus.getState()).toBe('idle');
  expect(destroy).toHaveBeenCalled();
});

test('the conversation is read once', async () => {
  await storage.set({
    [AI_CHAT_STORAGE_KEY]: [newChatMessage('user', 'stored')],
  });
  await loadChat();
  expect($chatMessages.getState()).toHaveLength(1);
  // a later turn in memory is not thrown away by a second load
  chatMessagesApi.add(newChatMessage('user', 'local'));
  await loadChat();
  expect($chatMessages.getState()).toHaveLength(2);
});

test('clear drops the conversation, the usage and the stored copy', async () => {
  await storage.set({
    [AI_CHAT_STORAGE_KEY]: [newChatMessage('user', 'stored')],
  });
  await loadChat();
  setChatUsage({ used: 5, total: 10 });
  await clearChat();
  expect($chatMessages.getState()).toEqual([]);
  expect($chatUsage.getState()).toEqual({ used: null, total: null });
  await expect(loadStoredChat()).resolves.toEqual([]);
});

test('a storage failure on save does not fail the turn', async () => {
  const broken: StorageAreaLike = {
    get: async () => ({}),
    set: async () => {
      throw new Error('no storage');
    },
    remove: async () => undefined,
  };
  setChatStorageForTest(broken);
  setChatSessionFactoryForTest(async () => fakeSession());
  await expect(sendChat('hi')).resolves.toBeUndefined();
  expect($chatMessages.getState()).toHaveLength(2);
});
