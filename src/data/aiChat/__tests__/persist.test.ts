/**
 * The chat's storage (`src/data/aiChat/persist.ts`): its own key, local only,
 * the newest turns kept, and a broken store costing the persistence rather than
 * the page.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';

import { MemoryStorageArea, type StorageAreaLike } from '../../repo/outbox';
import { newChatMessage } from '../AiChat';
import {
  AI_CHAT_STORAGE_KEY,
  CHAT_STORED_MESSAGES,
  clearStoredChat,
  loadStoredChat,
  saveStoredChat,
  setChatStorageForTest,
} from '../persist';

let storage: MemoryStorageArea;

beforeEach(() => {
  storage = new MemoryStorageArea();
  setChatStorageForTest(storage);
});

afterEach(() => {
  setChatStorageForTest(null);
});

test('the conversation survives a save and a load', async () => {
  const messages = [
    newChatMessage('user', 'a question'),
    newChatMessage('assistant', 'an answer'),
  ];
  await saveStoredChat(messages);
  await expect(loadStoredChat()).resolves.toEqual(messages);
});

test('only the newest turns are written', async () => {
  const messages = Array.from({ length: CHAT_STORED_MESSAGES + 10 }, (_, i) =>
    newChatMessage('user', `m${i}`),
  );
  await saveStoredChat(messages);
  const stored = await loadStoredChat();
  expect(stored).toHaveLength(CHAT_STORED_MESSAGES);
  expect(stored[stored.length - 1].content).toBe(`m${messages.length - 1}`);
});

test('nothing stored reads as an empty conversation', async () => {
  await expect(loadStoredChat()).resolves.toEqual([]);
});

test('a value that is not a list reads as empty', async () => {
  await storage.set({ [AI_CHAT_STORAGE_KEY]: 'not a conversation' });
  await expect(loadStoredChat()).resolves.toEqual([]);
});

test('a list with junk in it keeps only the messages', async () => {
  await storage.set({
    [AI_CHAT_STORAGE_KEY]: [newChatMessage('user', 'ok'), { junk: true }],
  });
  const stored = await loadStoredChat();
  expect(stored).toHaveLength(1);
  expect(stored[0].content).toBe('ok');
});

test('clear removes it', async () => {
  await saveStoredChat([newChatMessage('user', 'ok')]);
  await clearStoredChat();
  await expect(loadStoredChat()).resolves.toEqual([]);
});

test('a broken store reads as empty and save does not throw', async () => {
  const broken: StorageAreaLike = {
    get: async () => {
      throw new Error('no storage');
    },
    set: async () => {
      throw new Error('no storage');
    },
    remove: async () => undefined,
  };
  setChatStorageForTest(broken);
  await expect(loadStoredChat()).resolves.toEqual([]);
  await expect(
    saveStoredChat([newChatMessage('user', 'x')]),
  ).resolves.toBeUndefined();
});
