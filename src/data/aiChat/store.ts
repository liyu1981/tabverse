/**
 * The chat's in-memory state, as effector stores so it outlives the panel:
 * switching the right panel to another view unmounts `ChatPanel`, and a chat
 * that lost its conversation (or its stream) on a glance at the console would
 * not be a chat.
 */
import { createApi, createEvent, createStore } from 'effector';

import type { ChatUsage } from '../../ai/chatSession';
import type { ChatMessage } from './AiChat';

export type ChatStatus = 'idle' | 'streaming';

export const $chatMessages = createStore<ChatMessage[]>([]);
export const $chatStatus = createStore<ChatStatus>('idle');
export const $chatUsage = createStore<ChatUsage>({ used: null, total: null });
export const $chatError = createStore<string | null>(null);
export const $chatDraft = createStore<string>('');
export const $chatLoaded = createStore<boolean>(false);

export const chatMessagesApi = createApi($chatMessages, {
  replace: (_last, messages: ChatMessage[]) => messages,
  add: (last, message: ChatMessage) => [...last, message],
  patch: (
    last,
    { id, changes }: { id: string; changes: Partial<ChatMessage> },
  ) =>
    last.map((message) =>
      message.id === id ? { ...message, ...changes } : message,
    ),
  remove: (last, id: string) => last.filter((message) => message.id !== id),
  clear: () => [],
});

export const setChatStatus = createEvent<ChatStatus>();
$chatStatus.on(setChatStatus, (_last, status) => status);

export const setChatUsage = createEvent<ChatUsage>();
$chatUsage.on(setChatUsage, (_last, usage) => usage);

export const setChatError = createEvent<string | null>();
$chatError.on(setChatError, (_last, error) => error);

export const setChatDraft = createEvent<string>();
$chatDraft.on(setChatDraft, (_last, draft) => draft);

export const setChatLoaded = createEvent<boolean>();
$chatLoaded.on(setChatLoaded, (_last, loaded) => loaded);
