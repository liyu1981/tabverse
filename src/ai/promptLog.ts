/**
 * A local log of what this extension asked Chrome's built-in model, and what
 * came back.
 *
 * Chrome keeps no readable history of Prompt API sessions - a session is an
 * in-memory conversation that dies with the page, and there is no API to ask
 * it what was said - so the only history there can be is the one we write
 * down ourselves. This is that: one entry per call, newest first.
 *
 * Three rules, and the reasons:
 *
 * - **Local only, never synced.** The entries hold tab titles, which are the
 *   same personal data the extension already keeps on this device; they go
 *   into `chrome.storage.local` (not Dexie, not the server) and the view that
 *   shows them says so and can clear them.
 * - **Capped, not grown forever.** A suggestion per tabverse is already the
 *   whole feature; a hundred entries covers months of use and bounds what a
 *   stored log of browsing data can weigh. The oldest fall off the end.
 * - **Never in the way.** Writing the log must not be able to break the AI
 *   call it describes: every failure here is logged and swallowed (the answer
 *   the person asked for is not worth losing to a storage quota), and the
 *   read-modify-write is serialized so two fast calls cannot lose one entry.
 */
import { logger } from '../global';
import { ChromeStorageArea, type StorageAreaLike } from '../data/repo/outbox';

export const PROMPT_LOG_KEY = 'tabverse_prompt_log_v1';

/** How many exchanges are kept; older ones fall off the end. */
export const PROMPT_LOG_LIMIT = 100;

export interface PromptLogEntry {
  /** When the call started, in ms. */
  at: number;
  /** The fixed instruction the session was created with (plan D9). */
  systemPrompt: string;
  /** The user message that was sent. */
  input: string;
  /** The model's answer, or null when the call failed. */
  output: string | null;
  /** Why it failed, or null when it did not. */
  error: string | null;
  durationMs: number;
}

let storageOverride: StorageAreaLike | null = null;
const listeners = new Set<() => void>();

function storage(): StorageAreaLike {
  return storageOverride ?? new ChromeStorageArea();
}

export function setPromptLogStorageForTest(area: StorageAreaLike | null): void {
  storageOverride = area;
  listeners.clear();
}

/** The view listens so an entry arriving while it is open shows up. */
export function subscribePromptLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

function isEntry(value: unknown): value is PromptLogEntry {
  const entry = value as Partial<PromptLogEntry> | null;
  return (
    !!entry &&
    typeof entry.at === 'number' &&
    typeof entry.input === 'string' &&
    (typeof entry.output === 'string' || entry.output === null) &&
    (typeof entry.error === 'string' || entry.error === null)
  );
}

/** The log, newest first. Anything unreadable reads as "nothing yet". */
export async function loadPromptLog(): Promise<PromptLogEntry[]> {
  try {
    const items = await storage().get([PROMPT_LOG_KEY]);
    const raw = items[PROMPT_LOG_KEY];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(isEntry);
  } catch (err) {
    logger.log('could not read the prompt history', err);
    return [];
  }
}

async function appendNow(entry: PromptLogEntry): Promise<void> {
  const entries = await loadPromptLog();
  const next = [entry, ...entries].slice(0, PROMPT_LOG_LIMIT);
  await storage().set({ [PROMPT_LOG_KEY]: next });
  notify();
}

// One writer at a time: the read-modify-write above loses an entry if two
// calls overlap, and a suggestion is fast enough to do that.
let queue: Promise<void> = Promise.resolve();

export function appendPromptLog(entry: PromptLogEntry): Promise<void> {
  queue = queue
    .then(() => appendNow(entry))
    .catch((err: unknown) => {
      logger.log('could not record a prompt exchange', err);
    });
  return queue;
}

export async function clearPromptLog(): Promise<void> {
  try {
    await storage().remove([PROMPT_LOG_KEY]);
    notify();
  } catch (err) {
    logger.log('could not clear the prompt history', err);
  }
}
