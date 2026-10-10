/**
 * One cached model session per system prompt, created on demand.
 *
 * Two costs shape this module (plan D9):
 *
 * - `create()` is expensive - it loads the model, and on first use downloads
 *   it - so the session is created lazily, on the first suggestion, and cached
 *   for the page's life. The first click is also the consent for the download
 *   (D4); nothing here runs at page load.
 * - A failure is never cached and never thrown past the caller unhandled:
 *   the cache entry is dropped so the *next* click retries with a fresh
 *   session, and the availability state records why (`error`, or `absent`
 *   when the browser turns out to have no API at all), which is the one line
 *   the control then shows.
 *
 * The factory is injectable so tests drive the whole flow without a browser
 * (D11); `defaultFactory` is the only function that touches the real API.
 * The system prompt is part of the cache key rather than a module constant:
 * the future "ask this tabverse" increment wants a different one, and two
 * prompts sharing one session would inherit each other's instructions.
 */
import { logger } from '../global';
import {
  getAiAvailability,
  noteAiAbsent,
  noteAiDownloading,
  noteAiError,
  noteAiReady,
} from './availability';
import {
  type AiCreateOptions,
  type AiRawSession,
  type DownloadMonitor,
  detectAiModelApi,
} from './languageModel';
import { appendPromptLog } from './promptLog';

export interface AiSession {
  prompt(input: string): Promise<string>;
  /** Best effort: some API shapes never expose it. */
  destroy?(): void;
  inputQuota?: number;
}

export type AiSessionFactory = (systemPrompt: string) => Promise<AiSession>;

/** The browser has no built-in AI; not an error, a fact. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

let injectedFactory: AiSessionFactory | null = null;
const sessions = new Map<string, Promise<AiSession>>();
let pageHideBound = false;

export function setAiSessionFactoryForTest(
  factory: AiSessionFactory | null,
): void {
  // no cache clear here: tests swap factories mid-scenario (and the cache
  // belongs to resetAiSessionsForTest)
  injectedFactory = factory;
}

/** The download monitor create() gets, if this API shape accepts one. */
function downloadMonitor(): (monitor: DownloadMonitor) => void {
  return (monitor) => {
    if (!monitor || typeof monitor.addEventListener !== 'function') {
      return;
    }
    monitor.addEventListener('downloadprogress', (event) => {
      const { loaded, total } = event;
      if (
        typeof total === 'number' &&
        total > 0 &&
        typeof loaded === 'number'
      ) {
        noteAiDownloading(Math.min(1, Math.max(0, loaded / total)));
      } else {
        noteAiDownloading(null);
      }
    });
  };
}

async function defaultFactory(systemPrompt: string): Promise<AiSession> {
  const api = detectAiModelApi();
  if (!api) {
    // the probe should already have said `absent` and hidden the control;
    // reaching here means the API vanished between probe and click
    noteAiAbsent();
    throw new AiUnavailableError('this browser has no built-in AI');
  }
  // D4: a model that is not downloaded yet starts downloading on this click
  if (getAiAvailability().state === 'downloadable') {
    noteAiDownloading(null);
  }
  const options: AiCreateOptions = { systemPrompt };
  options.monitor = downloadMonitor();
  const raw: AiRawSession = await api.create(options);
  noteAiReady();
  return {
    prompt: (input) => raw.prompt(input),
    destroy: () => raw.destroy?.(),
    inputQuota: raw.inputQuota,
  };
}

/**
 * Wrap a session so every exchange is written to the local prompt log
 * (`promptLog.ts`). The log is what the AI-history view reads, and it is the
 * only record of a session that exists: Chrome's Prompt API keeps the
 * conversation in memory and offers no way to ask it what was said.
 *
 * The wrapper never changes the answer: the read of the output and the write
 * of the log are separate, and the write cannot throw (it is fire-and-forget
 * inside `appendPromptLog`), so a full or broken store costs a log entry and
 * nothing else.
 */
function withPromptLogging(
  session: AiSession,
  systemPrompt: string,
): AiSession {
  return {
    ...session,
    prompt: async (input: string) => {
      const started = Date.now();
      try {
        const output = await session.prompt(input);
        void appendPromptLog({
          at: started,
          systemPrompt,
          input,
          output,
          error: null,
          durationMs: Date.now() - started,
        });
        return output;
      } catch (err: unknown) {
        void appendPromptLog({
          at: started,
          systemPrompt,
          input,
          output: null,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        });
        throw err;
      }
    },
  };
}

/**
 * The session for this system prompt, created on first use.
 *
 * Failures reject the returned promise *and* clear the cache entry, so the
 * caller always gets an error it must catch, and the next call retries.
 */
export function ensureAiSession(systemPrompt: string): Promise<AiSession> {
  let pending = sessions.get(systemPrompt);
  if (!pending) {
    const factory = injectedFactory ?? defaultFactory;
    pending = factory(systemPrompt).then(
      (session) => withPromptLogging(session, systemPrompt),
      (err: unknown) => {
        sessions.delete(systemPrompt);
        if (err instanceof AiUnavailableError) {
          // `absent`, not `error`: no amount of retrying conjures an API
          noteAiAbsent();
        } else {
          logger.log('built-in AI session creation failed', err);
          noteAiError();
        }
        throw err;
      },
    );
    sessions.set(systemPrompt, pending);
    bindPageHide();
  }
  return pending;
}

/**
 * Drop a cached session after a failure, destroying it if it got far enough
 * to exist: the next click must start from a fresh one (plan D9).
 */
export function evictAiSession(systemPrompt: string): void {
  const pending = sessions.get(systemPrompt);
  sessions.delete(systemPrompt);
  if (pending) {
    void pending
      .then((session) => session.destroy?.())
      .catch(() => {
        // it failed to create; there is nothing to destroy
      });
  }
}

async function destroyAll(): Promise<void> {
  const pending = Array.from(sessions.values());
  sessions.clear();
  for (const promise of pending) {
    try {
      const session = await promise;
      session.destroy?.();
    } catch {
      // a session that failed to create has nothing to destroy (D9: the
      // failure already evicted it)
    }
  }
}

/** Destroys every cached session; called on pagehide (D9). */
export function destroyAiSessions(): void {
  void destroyAll();
}

function bindPageHide(): void {
  // feature test inside a function (capabilities.ts rule): in the node test
  // environment there is no window, and binding must not run there anyway
  if (pageHideBound || typeof window === 'undefined') {
    return;
  }
  pageHideBound = true;
  window.addEventListener('pagehide', () => {
    destroyAiSessions();
  });
}

/** Test hooks: the cache and the pagehide binding are module state. */
export function resetAiSessionsForTest(): void {
  injectedFactory = null;
  sessions.clear();
  pageHideBound = false;
}
