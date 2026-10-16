/**
 * The chat's side effects: one turn at a time, streamed into the store, kept in
 * `chrome.storage.local`, and never written to the prompt log.
 *
 * The session is created lazily, on the first send, and seeded from the
 * conversation so far - so a page reload reconstructs the context instead of
 * starting blank. It is reused for later turns (that is what makes it a
 * conversation) and dropped on failure or stop, so the next send starts from a
 * session that matches what is on screen.
 *
 * **Compaction.** A local model has a small context window, and a conversation
 * eventually fills it. When a turn fails because the context is full, the older
 * turns are folded into one summary turn, a fresh session is seeded from the
 * shorter conversation, and the question is asked again - so the person sees an
 * answer rather than a quota error they can do nothing about. The compaction is
 * shown in the transcript, because a summary that silently replaced the history
 * would be a lie. See `compactConversation`.
 */
import {
  CHAT_COMPACT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  type ChatSession,
  createChatSession,
  isContextOverflowError,
} from '../../ai/chatSession';
import type { AiInitialPrompt } from '../../ai/languageModel';
import { logger } from '../../global';
import {
  CHAT_KEEP_RECENT,
  type ChatMessage,
  chatInitialPrompts,
  newChatMessage,
  promptTextFor,
  summaryTranscript,
} from './AiChat';
import {
  $chatContext,
  $chatLoaded,
  $chatMessages,
  chatMessagesApi,
  setChatContext,
  setChatDraft,
  setChatError,
  setChatLoaded,
  setChatStatus,
  setChatUsage,
} from './store';
import { clearStoredChat, loadStoredChat, saveStoredChat } from './persist';

let session: ChatSession | null = null;
let controller: AbortController | null = null;

/** Reads the stored conversation once, into the store. */
export async function loadChat(): Promise<void> {
  if ($chatLoaded.getState()) {
    return;
  }
  const messages = await loadStoredChat();
  chatMessagesApi.replace(messages);
  setChatLoaded(true);
}

async function persistChat(): Promise<void> {
  await saveStoredChat($chatMessages.getState());
}

/** The summarizer session: a one-shot model call, not the chat's session. */
async function summarizeForCompaction(transcript: string): Promise<string> {
  const summarizer = await createChatSession({
    systemPrompt: CHAT_COMPACT_SYSTEM_PROMPT,
    history: [],
  });
  try {
    const result = await summarizer.send(
      `The conversation so far:\n\n${transcript}`,
    );
    return (
      result.text.trim() ||
      'The earlier turns were summarized, but the summary came back empty.'
    );
  } finally {
    summarizer.destroy();
  }
}

/**
 * Fold the turns that no longer fit into one summary.
 *
 * The newest `CHAT_KEEP_RECENT` turns (and the question being asked) are kept
 * verbatim; everything older becomes a single `system` turn. Returns whether
 * anything was folded: a conversation short enough to have "nothing older"
 * cannot be compacted, and then the failure has to be shown instead.
 *
 * If the summarizer itself fails, the older turns are dropped rather than the
 * turn: the point is to get an answer, and a smaller context is a working one.
 */
async function compactConversation(question: ChatMessage): Promise<boolean> {
  const messages = $chatMessages.getState();
  // everything before the question, which is about to be asked again
  const prior = messages.filter((message) => message.id !== question.id);
  const older = prior.slice(0, Math.max(0, prior.length - CHAT_KEEP_RECENT));
  const tail = prior.slice(Math.max(0, prior.length - CHAT_KEEP_RECENT));
  if (older.length === 0) {
    return false;
  }
  const transcript = summaryTranscript(older);
  let summary: string;
  try {
    summary = await summarizeForCompaction(transcript);
  } catch (err: unknown) {
    logger.log('could not summarize the chat for compaction', err);
    summary = `${older.length} earlier turn(s) were dropped to fit the context window.`;
  }
  const summaryMessage: ChatMessage = {
    ...newChatMessage('system', summary),
    compacted: true,
  };
  chatMessagesApi.replace([summaryMessage, ...tail, question]);
  return true;
}

/**
 * The answer to a question that is already in the store.
 *
 * A context overflow gets one response before it becomes an error the person
 * sees: the older turns are compacted, the session is rebuilt from the shorter
 * history, and the question is asked again. For that retry the failed bubble is
 * taken away, so the person sees one answer rather than a failure and then a
 * second try.
 */
async function answerQuestion(
  question: ChatMessage,
  initialHistory: AiInitialPrompt[],
): Promise<void> {
  const abort = new AbortController();
  controller = abort;
  setChatError(null);
  setChatStatus('streaming');
  let history = initialHistory;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = newChatMessage('assistant', '');
      chatMessagesApi.add(answer);
      void persistChat();
      try {
        if (session === null) {
          session = await createChatSession({
            systemPrompt: CHAT_SYSTEM_PROMPT,
            history,
          });
        }
        const result = await session.send(promptTextFor(question), {
          signal: abort.signal,
          onDelta: (_delta, full) => {
            chatMessagesApi.patch({
              id: answer.id,
              changes: { content: full },
            });
          },
        });
        chatMessagesApi.patch({
          id: answer.id,
          changes: {
            content: result.text,
            durationMs: result.durationMs,
            outputTokens: result.outputTokens,
            tokensPerSecond: result.tokensPerSecond,
          },
        });
        setChatUsage(result.usage);
        return;
      } catch (err: unknown) {
        if (attempt === 0 && isContextOverflowError(err)) {
          const compacted = await compactConversation(question);
          if (compacted) {
            chatMessagesApi.remove(answer.id);
            session?.destroy();
            session = null;
            history = chatInitialPrompts(
              $chatMessages
                .getState()
                .filter((message) => message.id !== question.id),
            );
            continue;
          }
        }
        const reason = err instanceof Error ? err.message : String(err);
        chatMessagesApi.patch({ id: answer.id, changes: { error: reason } });
        setChatError(reason);
        // a session that failed is not reused: the next send seeds a fresh one
        session?.destroy();
        session = null;
        return;
      }
    }
  } finally {
    if (controller === abort) {
      controller = null;
    }
    setChatStatus('idle');
    await persistChat();
  }
}

/**
 * What the composer sends: the question. The conversation so far seeds the
 * session, taken before the question is added because `send` sends the
 * question itself.
 */
export async function sendChat(text: string): Promise<void> {
  const input = text.trim();
  if (input.length === 0 || controller !== null) {
    return;
  }
  const history = chatInitialPrompts($chatMessages.getState());
  // the attached page rides on the message, then stops being a draft
  const context = $chatContext.getState();
  setChatDraft('');
  setChatContext(null);
  const question = newChatMessage(
    'user',
    input,
    Date.now(),
    context ?? undefined,
  );
  chatMessagesApi.add(question);
  await answerQuestion(question, history);
}

/**
 * Ask the last question again. The answer (and anything after the question) is
 * dropped, and the turn runs from the history that has no answer in it: reusing
 * the old session would feed the model its own previous reply, which is the
 * opposite of asking again.
 */
export async function regenerateChat(): Promise<void> {
  if (controller !== null) {
    return;
  }
  const messages = $chatMessages.getState();
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) {
    return;
  }
  const question = messages[lastUserIndex];
  const before = messages.slice(0, lastUserIndex);
  chatMessagesApi.replace(before);
  chatMessagesApi.add(question);
  session?.destroy();
  session = null;
  await answerQuestion(question, chatInitialPrompts(before));
}

/** Stops the answer in flight; what has streamed so far is left in place. */
export function stopChat(): void {
  controller?.abort();
  controller = null;
  session?.destroy();
  session = null;
  setChatStatus('idle');
}

export async function clearChat(): Promise<void> {
  stopChat();
  session = null;
  chatMessagesApi.clear();
  setChatContext(null);
  setChatUsage({ used: null, total: null });
  setChatError(null);
  await clearStoredChat();
}

/** Test hook: the session and the in-flight controller are module state. */
export function resetChatRuntimeForTest(): void {
  session = null;
  controller = null;
}
