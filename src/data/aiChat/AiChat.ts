/**
 * The chat's own model: a conversation is a list of turns, and nothing here
 * knows about the model API or about storage. The parts that survive a reload
 * are the messages themselves, so they are the shape that is written down.
 */
import { getNewId } from '../common';
import type { AiInitialPrompt } from '../../ai/languageModel';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** the text, empty while an answer is still streaming */
  content: string;
  /** when it was created, in ms */
  at: number;
  /** below: what the assistant turn learned, when it answered */
  durationMs?: number;
  /** estimated: the Prompt API reports no output token count */
  outputTokens?: number;
  tokensPerSecond?: number;
  /** set on a failed answer, so the bubble shows the reason instead of text */
  error?: string | null;
  /**
   * A compaction summary: the older turns folded into one `system` turn. It is
   * a message rather than a separate field so it is seeded, stored and shown by
   * the same path as everything else.
   */
  compacted?: boolean;
}

/** How much of the conversation a fresh session is seeded with. */
export const CHAT_CONTEXT_MESSAGES = 20;

/** How many turns are kept verbatim when older ones are folded into a summary. */
export const CHAT_KEEP_RECENT = 6;

/**
 * The summarizer's input cap, in characters. Compaction is triggered by a full
 * context, so the thing that summarizes it must not be handed the same large
 * transcript; the newest of the older turns matter most, so the tail is kept.
 */
const CHAT_COMPACT_INPUT_BUDGET = 6000;

const ROLE_LABELS: Record<ChatRole, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'Summary so far',
};

export function newChatMessage(
  role: ChatRole,
  content: string,
  at: number = Date.now(),
): ChatMessage {
  return { id: getNewId(), role, content, at, error: null };
}

/**
 * The messages a new model session starts from, oldest first.
 *
 * Only turns that carry text and did not fail are seeded: an empty or errored
 * assistant bubble is our own record of a problem, not something the model
 * said, and feeding it back would put a phantom turn in the conversation. A
 * compaction summary is a `system` turn and is seeded like any other. The tail
 * is what matters, so the list is capped at `limit` messages.
 */
export function chatInitialPrompts(
  messages: ChatMessage[],
  limit: number = CHAT_CONTEXT_MESSAGES,
): AiInitialPrompt[] {
  return messages
    .filter((message) => message.content.trim().length > 0 && !message.error)
    .slice(-limit)
    .map((message) => ({ role: message.role, content: message.content }));
}

/**
 * The transcript the summarizer is handed: the turns with their roles, capped
 * to the most recent `budget` characters. Empty and failed turns are skipped,
 * because they are not part of what was said.
 */
export function summaryTranscript(
  messages: ChatMessage[],
  budget: number = CHAT_COMPACT_INPUT_BUDGET,
): string {
  const lines = messages
    .filter((message) => message.content.trim().length > 0 && !message.error)
    .map(
      (message) => `${ROLE_LABELS[message.role]}: ${message.content.trim()}`,
    );
  const text = lines.join('\n\n');
  return text.length > budget ? `…${text.slice(text.length - budget)}` : text;
}

/** A value read back from storage, kept only if it is shaped like a message. */
export function isChatMessage(value: unknown): value is ChatMessage {
  const message = value as Partial<ChatMessage> | null;
  return (
    !!message &&
    typeof message.id === 'string' &&
    (message.role === 'user' ||
      message.role === 'assistant' ||
      message.role === 'system') &&
    typeof message.content === 'string' &&
    typeof message.at === 'number'
  );
}
