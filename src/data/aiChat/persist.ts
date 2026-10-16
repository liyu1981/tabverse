/**
 * Where the chat lives between page loads: `chrome.storage.local`, one key, the
 * messages as they are.
 *
 * Local only, like the prompt log and for the same reason - a conversation can
 * hold anything a person typed about what they were looking at - and never
 * synced, never in Dexie, never on the server. The key is its own, so the chat
 * is a history of its own and does not appear in the AI-history view.
 */
import { logger } from '../../global';
import { ChromeStorageArea, type StorageAreaLike } from '../repo/outbox';
import { type ChatMessage, isChatMessage } from './AiChat';

export const AI_CHAT_STORAGE_KEY = 'tabverse_ai_chat_v1';

/** What is kept on disk; older turns beyond this fall off. */
export const CHAT_STORED_MESSAGES = 200;

let storageOverride: StorageAreaLike | null = null;

function storage(): StorageAreaLike {
  return storageOverride ?? new ChromeStorageArea();
}

export function setChatStorageForTest(area: StorageAreaLike | null): void {
  storageOverride = area;
}

/** The stored conversation, oldest first. Anything unreadable reads as empty. */
export async function loadStoredChat(): Promise<ChatMessage[]> {
  try {
    const items = await storage().get([AI_CHAT_STORAGE_KEY]);
    const raw = items[AI_CHAT_STORAGE_KEY];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(isChatMessage);
  } catch (err) {
    logger.log('could not read the chat', err);
    return [];
  }
}

/** The newest turns are the ones worth keeping, so the tail is what is written. */
export async function saveStoredChat(messages: ChatMessage[]): Promise<void> {
  try {
    await storage().set({
      [AI_CHAT_STORAGE_KEY]: messages.slice(-CHAT_STORED_MESSAGES),
    });
  } catch (err) {
    // a full or broken store costs the chat nothing but its persistence
    logger.log('could not save the chat', err);
  }
}

export async function clearStoredChat(): Promise<void> {
  try {
    await storage().remove([AI_CHAT_STORAGE_KEY]);
  } catch (err) {
    logger.log('could not clear the chat', err);
  }
}
