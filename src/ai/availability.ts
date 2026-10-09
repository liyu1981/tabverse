/**
 * What this browser offers of Chrome's built-in AI, as one state the UI can
 * read, and the probe that fills it in.
 *
 * The state machine follows `src/capabilities.ts`'s philosophy - detect by
 * feature test, fail soft, say so in one line - but it cannot *be* a row of
 * `CAPABILITIES`: that table is a sync boolean per feature, while built-in AI
 * is async (the probe is a promise), has a download in the middle of it, and
 * changes state after the page has loaded. So it gets its own module with its
 * own cache:
 *
 *   checking ──probe──► absent | downloadable | downloading | ready | error
 *                              ▲        │              │        │
 *                              │        └──create()────┴──►ready│
 *                              └────────── any failure ◄────────┘
 *
 * `downloadable → downloading → ready` is driven by `src/ai/session.ts`
 * around the model download (plan D4: the first click on the control is what
 * starts it, never page load), and by the download monitor while the bytes
 * move. `error` is retryable: the next probe (or the next click, which
 * probes) gets a fresh answer, and `session.ts` clears its cache so the next
 * attempt also gets a fresh session (plan D9).
 *
 * A probe result is cached like `capabilities.ts` caches its table - the
 * answer cannot change without *our* create() changing it, which we report
 * ourselves. `error` is deliberately not cached: it is the one state whose
 * whole meaning is "ask again".
 */
import { logger } from '../global';
import {
  type AiModelApi,
  type ModelAvailability,
  detectAiModelApi,
} from './languageModel';

export type AiAvailabilityState =
  | 'checking'
  | 'absent'
  | 'downloadable'
  | 'downloading'
  | 'ready'
  | 'error';

export interface AiAvailability {
  state: AiAvailabilityState;
  /** 0..1 while the model downloads, null when unknown or not downloading. */
  progress: number | null;
}

interface AiAvailabilityStore {
  state: AiAvailabilityState;
  progress: number | null;
}

let current: AiAvailabilityStore = { state: 'checking', progress: null };
let probePromise: Promise<AiAvailability> | null = null;
const listeners = new Set<() => void>();

/** States a probe would not re-ask about; `checking` and `error` re-probe. */
const SETTLED_STATES: AiAvailabilityState[] = [
  'absent',
  'downloadable',
  'downloading',
  'ready',
];

function set(next: AiAvailabilityStore): void {
  if (next.state === current.state && next.progress === current.progress) {
    return;
  }
  current = next;
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

export function getAiAvailability(): AiAvailability {
  return current;
}

/**
 * Subscribe to state changes; returns the unsubscribe. The snapshot handed to
 * `useSyncExternalStore` is `getAiAvailability()` - the object only changes
 * identity when the state does, which is what keeps that hook quiet.
 */
export function subscribeAiAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function stateOf(answer: ModelAvailability): AiAvailabilityState {
  switch (answer) {
    case 'available':
      return 'ready';
    case 'downloadable':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    case 'unavailable':
      return 'absent';
  }
}

async function runProbe(api: AiModelApi): Promise<AiAvailability> {
  try {
    const answer = await api.availability();
    set({ state: stateOf(answer), progress: null });
  } catch (err) {
    logger.log('built-in AI availability probe failed', err);
    set({ state: 'error', progress: null });
  }
  return current;
}

/**
 * Probe once per settled answer; concurrent callers share the one in-flight
 * probe, and `error` is re-asked on the next call (it means "try again").
 */
export function probeAiAvailability(): Promise<AiAvailability> {
  if (SETTLED_STATES.includes(current.state)) {
    return Promise.resolve(current);
  }
  if (probePromise) {
    return probePromise;
  }
  const api = detectAiModelApi();
  if (!api) {
    set({ state: 'absent', progress: null });
    return Promise.resolve(current);
  }
  probePromise = runProbe(api).finally(() => {
    probePromise = null;
  });
  return probePromise;
}

/* Transitions reported by the session layer while create() runs. */

export function noteAiDownloading(progress: number | null): void {
  set({ state: 'downloading', progress });
}

export function noteAiReady(): void {
  set({ state: 'ready', progress: null });
}

export function noteAiError(): void {
  set({ state: 'error', progress: null });
}

export function noteAiAbsent(): void {
  set({ state: 'absent', progress: null });
}

/** Test hooks: the state and the in-flight probe are module state. */
export function setAiAvailabilityForTest(next: AiAvailability): void {
  probePromise = null;
  set({ state: next.state, progress: next.progress });
}

export function resetAiAvailabilityForTest(): void {
  probePromise = null;
  listeners.clear();
  set({ state: 'checking', progress: null });
}
