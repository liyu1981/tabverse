/**
 * A multi-turn conversation with the on-device model, streamed.
 *
 * `session.ts`'s cached sessions are for one-shot suggestions: one system
 * prompt, one answer at a time, every exchange written to the prompt log. This
 * is the chat instead:
 *
 * - the previous messages are seeded as `initialPrompts`, so the conversation
 *   *is* the context rather than something the caller re-sends;
 * - the reply arrives as a stream, so it can be drawn as it is written;
 * - nothing here touches `promptLog` - the chat keeps its own history
 *   (`data/aiChat`), which is what the feature asked for.
 *
 * What the API does and does not report shapes the stats: the context window is
 * read from the session (`contextUsage`/`contextWindow`, or the older
 * `inputUsage`/`inputQuota`), but **output tokens are not exposed anywhere**, so
 * the rate the panel shows is a character estimate and is commented as one.
 *
 * The factory is injectable so tests drive the whole flow without a browser.
 */
import { logger } from '../global';
import {
  type AiInitialPrompt,
  type AiPromptOptions,
  type AiRawSession,
} from './languageModel';
import { aiDownloadMonitor, createRawAiSession } from './session';

export interface ChatUsage {
  /** tokens the session reports for its context, or null when it does not. */
  used: number | null;
  /** the context window, or null when the session does not report one. */
  total: number | null;
}

interface ChatStreamHandlers {
  /** Called with the new text and the whole reply so far. */
  onDelta?: (delta: string, full: string) => void;
  /** Stop mid-answer; the partial reply is what the turn returns. */
  signal?: AbortSignal;
}

export interface ChatTurnResult {
  text: string;
  durationMs: number;
  /** estimated, because the API reports no output token count. */
  outputTokens: number;
  tokensPerSecond: number;
  usage: ChatUsage;
}

export interface ChatSession {
  send(input: string, handlers?: ChatStreamHandlers): Promise<ChatTurnResult>;
  usage(): ChatUsage;
  /** Best effort, and final: a destroyed session is not used again. */
  destroy(): void;
}

export interface ChatSessionOptions {
  systemPrompt: string;
  /** The conversation so far, oldest first, minus the turn about to be sent. */
  history: AiInitialPrompt[];
}

/**
 * The model's context window is full: the turn cannot be sent as it stands.
 *
 * The API reports this in more than one shape - a rejected promise with a
 * quota-flavoured name or message on some builds, a `contextoverflow` event on
 * others - so the session normalizes it, and the chat's one response to it is
 * to compact and try again (`data/aiChat/runtime.ts`).
 */
export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

const OVERFLOW_PATTERN =
  /overflow|quota|too (long|large|many)|context.{0,24}(length|window|limit)|maximum/i;

/** Whether a failure is the context window filling up, in any of its shapes. */
export function isContextOverflowError(err: unknown): boolean {
  if (err instanceof ContextOverflowError) {
    return true;
  }
  const name =
    err !== null && typeof err === 'object' && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return OVERFLOW_PATTERN.test(`${name} ${message}`);
}

/**
 * What the chat's model is told up front. The answer is rendered as markdown
 * (`ChatPanel`), so the prompt can ask for structure rather than warning it
 * off; lists and short code blocks are the shapes a chat answer wants.
 */
export const CHAT_SYSTEM_PROMPT =
  'You are Tabverse, a concise assistant built into a Chrome tab manager. ' +
  'Answer in short, plain language, and use short markdown lists or fenced ' +
  'code blocks when they make the answer clearer.';

/**
 * What the model is asked to do when the context window fills up: fold the
 * older turns into the one paragraph that carries them forward.
 */
export const CHAT_COMPACT_SYSTEM_PROMPT =
  'You compress a chat transcript into a short brief for another assistant ' +
  'that will continue the conversation. Keep the facts, decisions, names, ' +
  'numbers and open questions; drop the pleasantries. Write plain prose or a ' +
  'short list, and do not answer the conversation or add anything new.';

export type ChatSessionFactory = (
  options: ChatSessionOptions,
) => Promise<ChatSession>;

/** The Prompt API reports no output tokens, so this is a rough 4 chars/token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readUsage(raw: AiRawSession): ChatUsage {
  const used = raw.contextUsage ?? raw.inputUsage ?? null;
  const total = raw.contextWindow ?? raw.inputQuota ?? null;
  return {
    used: typeof used === 'number' ? used : null,
    total: typeof total === 'number' ? total : null,
  };
}

/** A last-resort overflow signal for a build whose error said nothing useful. */
function usageAtLimit(raw: AiRawSession): boolean {
  const usage = readUsage(raw);
  return (
    usage.used !== null && usage.total !== null && usage.used >= usage.total
  );
}

/**
 * A stream's chunks have been *cumulative* on every shape seen - each one is the
 * whole reply so far - so the delta is what was added since the last read. A
 * shape that sends deltas instead is detected by a chunk that does not extend
 * what we have, and taken as-is.
 */
function splitChunk(
  previous: string,
  chunk: string,
): { full: string; delta: string } {
  if (chunk.startsWith(previous)) {
    return { full: chunk, delta: chunk.slice(previous.length) };
  }
  return { full: previous + chunk, delta: chunk };
}

function wrapRawSession(raw: AiRawSession): ChatSession {
  let destroyed = false;
  let overflowed = false;
  // the event is the cleanest signal a build can give; the error path below
  // covers the builds that reject instead
  const listenable = raw as unknown as {
    addEventListener?: (type: string, listener: () => void) => void;
  };
  if (typeof listenable.addEventListener === 'function') {
    listenable.addEventListener('contextoverflow', () => {
      overflowed = true;
    });
  }
  return {
    usage: () => readUsage(raw),
    destroy: () => {
      destroyed = true;
      raw.destroy?.();
    },
    send: async (input, handlers = {}) => {
      const started = Date.now();
      const options: AiPromptOptions = {};
      if (handlers.signal) {
        options.signal = handlers.signal;
      }
      let full = '';
      try {
        if (typeof raw.promptStreaming === 'function') {
          const reader = raw.promptStreaming(input, options).getReader();
          try {
            for (;;) {
              if (destroyed || handlers.signal?.aborted === true) {
                await reader.cancel();
                break;
              }
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              const chunk =
                typeof value === 'string' ? value : String(value ?? '');
              const next = splitChunk(full, chunk);
              full = next.full;
              if (next.delta.length > 0) {
                handlers.onDelta?.(next.delta, full);
              }
            }
          } finally {
            reader.releaseLock();
          }
        } else {
          // no streaming shape: one answer, handed over in one piece
          full = await raw.prompt(input, options);
          handlers.onDelta?.(full, full);
        }
      } catch (err: unknown) {
        if (handlers.signal?.aborted === true || destroyed) {
          // a stop is not a failure; the partial reply is what there is
          logger.log('chat generation was stopped');
        } else if (
          overflowed ||
          isContextOverflowError(err) ||
          usageAtLimit(raw)
        ) {
          throw new ContextOverflowError(
            err instanceof Error ? err.message : String(err),
          );
        } else {
          throw err;
        }
      }
      const durationMs = Date.now() - started;
      const outputTokens = estimateTokens(full);
      const seconds = durationMs / 1000;
      return {
        text: full,
        durationMs,
        outputTokens,
        tokensPerSecond: seconds > 0 ? outputTokens / seconds : 0,
        usage: readUsage(raw),
      };
    },
  };
}

let injectedFactory: ChatSessionFactory | null = null;

export function setChatSessionFactoryForTest(
  factory: ChatSessionFactory | null,
): void {
  injectedFactory = factory;
}

async function defaultFactory(
  options: ChatSessionOptions,
): Promise<ChatSession> {
  const raw = await createRawAiSession({
    systemPrompt: options.systemPrompt,
    initialPrompts: options.history,
    monitor: aiDownloadMonitor(),
  });
  return wrapRawSession(raw);
}

export async function createChatSession(
  options: ChatSessionOptions,
): Promise<ChatSession> {
  const factory = injectedFactory ?? defaultFactory;
  return factory(options);
}
