/**
 * The AI chat: a conversation with the same on-device model the summaries and
 * suggestions use, kept as its own history (see `data/aiChat`) and drawn like a
 * chat rather than a record - the question and the answer, streaming in.
 *
 * A tabverse tool tab, alongside Todo/Note/Bookmark/History. It used to be a
 * view of the right side panel; it moved because a page action ("send page
 * content to AI chat") belongs where a person looks for a tabverse's tools.
 * Its history is still the extension's one conversation (`data/aiChat`), not
 * per tabverse.
 *
 * Answers are rendered as markdown (`react-markdown`), which is safe by
 * construction: it builds React elements, never sets HTML, renders no raw HTML,
 * and checks link protocols, so a model answer - or a page that talked the
 * model into something - cannot put a script or a `javascript:` link in a page
 * that holds the whole account.
 *
 * The parts are presentational, so the markup can be checked by what it renders
 * (AGENTS.md: no browser); the container only wires the stores to them.
 */
import { Button, Callout, Icon, Intent, Spinner } from '@blueprintjs/core';
import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { useStore } from 'effector-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  type AiAvailabilityState,
  getAiAvailability,
  probeAiAvailability,
  subscribeAiAvailability,
} from '../../../ai/availability';
import {
  getAiEnabled,
  loadAiEnabled,
  subscribeAiEnabled,
} from '../../../ai/aiSettings';
import type { ChatUsage } from '../../../ai/chatSession';
import type { ChatContext, ChatMessage } from '../../../data/aiChat/AiChat';
import {
  $chatContext,
  $chatDraft,
  $chatError,
  $chatLoaded,
  $chatMessages,
  $chatStatus,
  $chatUsage,
  setChatContext,
  setChatDraft,
} from '../../../data/aiChat/store';
import {
  clearChat,
  loadChat,
  regenerateChat,
  sendChat,
  stopChat,
} from '../../../data/aiChat/runtime';
import classes from './ChatPanel.module.scss';

/** External links open in a new tab; an extension page must not navigate away. */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ node, ...props }) => {
    // `node` is react-markdown's mdast node, not a DOM attribute
    void node;
    return <a {...props} target="_blank" rel="noreferrer noopener" />;
  },
};

function MarkdownContent(props: { content: string }) {
  return (
    <div className={classes.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}

/** "1,024 / 6,144 tokens" or an honest one-liner when the build reports none. */
export function contextLabel(usage: ChatUsage): string {
  if (usage.used === null || usage.total === null) {
    return 'This browser does not report the context window.';
  }
  return `${usage.used.toLocaleString()} / ${usage.total.toLocaleString()} tokens`;
}

function contextPercent(usage: ChatUsage): number {
  if (usage.used === null || usage.total === null || usage.total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((usage.used / usage.total) * 100));
}

/**
 * The chat's top bar: the conversation's clear control, then the context window
 * as a bar and its numbers. The clear button lives here, away from the composer,
 * because it clears the whole conversation - the composer's own control clears
 * only what is being typed.
 */
export function ChatStats(props: {
  usage: ChatUsage;
  canClear: boolean;
  onClear: () => void;
}) {
  const { usage } = props;
  const percent = contextPercent(usage);
  const known = usage.used !== null && usage.total !== null;
  return (
    <div className={classes.stats}>
      {props.canClear ? (
        <Button
          className={classes.clearConversation}
          minimal={true}
          small={true}
          icon="trash"
          text="Clear conversation"
          onClick={props.onClear}
        />
      ) : null}
      <span className={classes.statsLabel}>Context</span>
      <div
        className={classes.contextBar}
        role="progressbar"
        aria-label="Context window used"
        aria-valuemin={0}
        aria-valuemax={known ? (usage.total as number) : 100}
        aria-valuenow={known ? (usage.used as number) : 0}
      >
        <div className={classes.contextFill} style={{ width: `${percent}%` }} />
      </div>
      <span className={classes.statsValue}>{contextLabel(usage)}</span>
    </div>
  );
}

/** Copy an answer, and say so for a moment without a toast. */
function CopyButton(props: { onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  const label = copied ? 'Copied' : 'Copy the answer';
  return (
    <button
      type="button"
      className={classes.action}
      aria-label={label}
      title={label}
      onClick={() => {
        props.onCopy();
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon icon={copied ? 'tick' : 'duplicate'} size={12} />
    </button>
  );
}

/** Ask again for the last question, replacing the answer that is there. */
function RegenerateButton(props: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={classes.action}
      aria-label="Regenerate the answer"
      title="Regenerate the answer"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon icon="refresh" size={12} />
    </button>
  );
}

interface ChatBubbleProps {
  message: ChatMessage;
  /** Only the newest answer can be asked for again. */
  showRegenerate: boolean;
  busy: boolean;
  onCopy: (message: ChatMessage) => void;
  onRegenerate: () => void;
}

/** One turn. The assistant gets the small mark; the question is right-aligned. */
function ChatBubble(props: ChatBubbleProps) {
  const { message } = props;
  const isUser = message.role === 'user';
  const failed = message.error !== undefined && message.error !== null;
  // an assistant bubble with no text yet is the "thinking" indicator
  const pending = !isUser && !failed && message.content.length === 0;
  return (
    <div
      className={clsx(
        classes.row,
        isUser ? classes.rowUser : classes.rowAssistant,
      )}
    >
      {!isUser ? (
        <span className={classes.avatar} aria-hidden={true}>
          <Icon icon="lightbulb" size={14} />
        </span>
      ) : null}
      <div
        className={clsx(
          classes.bubble,
          isUser ? classes.bubbleUser : classes.bubbleAssistant,
          failed && classes.bubbleError,
        )}
      >
        {failed ? (
          <span className={classes.errorText}>{message.error}</span>
        ) : isUser ? (
          <>
            {/* the page the question is about, folded away: the question stays
                the bubble's text, the context is material to open */}
            {message.context ? (
              <details className={classes.contextBlock}>
                <summary className={classes.contextSummary}>
                  <Icon icon="document" size={12} />
                  <span className={classes.contextLabel}>
                    {message.context.title || 'Attached page'}
                  </span>
                </summary>
                <pre className={classes.contextText}>
                  {message.context.markdown}
                </pre>
              </details>
            ) : null}
            <pre className={classes.text}>{message.content}</pre>
          </>
        ) : pending ? (
          <pre className={classes.text}>…</pre>
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {!isUser ? (
          <div className={classes.actions}>
            <span className={classes.meta}>
              {message.tokensPerSecond === undefined
                ? ''
                : `${message.outputTokens ?? 0} tok · ${message.tokensPerSecond.toFixed(
                    1,
                  )} tok/s · ${message.durationMs ?? 0} ms`}
            </span>
            {message.content.length > 0 ? (
              <CopyButton onCopy={() => props.onCopy(message)} />
            ) : null}
            {props.showRegenerate ? (
              <RegenerateButton
                disabled={props.busy}
                onClick={props.onRegenerate}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The compaction summary: a note that history was folded, not a chat turn. */
function CompactNotice(props: { message: ChatMessage }) {
  return (
    <details className={classes.compact}>
      <summary className={classes.compactSummary}>
        <Icon icon="compressed" size={12} />
        <span>Earlier conversation summarized to fit the context</span>
      </summary>
      <div className={classes.compactBody}>
        <MarkdownContent content={props.message.content} />
      </div>
    </details>
  );
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  streaming: boolean;
  /** Shown while the model installs; null when it is not downloading. */
  downloadProgress: number | null;
  /** True when a download has not started yet. */
  downloadable: boolean;
  onCopy: (message: ChatMessage) => void;
  onRegenerate: () => void;
}

function ChatMessages(props: ChatMessagesProps) {
  const { messages, streaming } = props;
  const endRef = useRef<HTMLDivElement>(null);
  // A stream that arrives while the panel is open should stay in view; the
  // empty case has nothing to scroll to. The effect does nothing in a static
  // render, which is part of what keeps the view testable.
  useEffect(() => {
    if (messages.length === 0 && !streaming) {
      return;
    }
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streaming]);

  const lastAnswerId = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')?.id;

  return (
    <div className={classes.messages}>
      {messages.length === 0 ? (
        <div className={classes.empty}>
          <Icon icon="comment" size={22} />
          <p>
            Ask Chrome&rsquo;s on-device model anything. The conversation stays
            in this browser, and it is kept separately from the AI history.
          </p>
          {props.downloadable ? (
            <p className={classes.emptyHint}>
              The model will download on the first message.
            </p>
          ) : null}
          {props.downloadProgress !== null ? (
            <p className={classes.emptyHint}>
              {`Installing the model… ${Math.round(
                props.downloadProgress * 100,
              )}%`}
            </p>
          ) : null}
        </div>
      ) : (
        messages.map((message) =>
          message.role === 'system' ? (
            <CompactNotice key={message.id} message={message} />
          ) : (
            <ChatBubble
              key={message.id}
              message={message}
              busy={streaming}
              showRegenerate={message.id === lastAnswerId}
              onCopy={props.onCopy}
              onRegenerate={props.onRegenerate}
            />
          ),
        )
      )}
      <div ref={endRef} />
    </div>
  );
}

interface ChatComposerProps {
  draft: string;
  /** The page attached to the next question, shown as a removable chip. */
  context: ChatContext | null;
  streaming: boolean;
  onDraftChange: (value: string) => void;
  onRemoveContext: () => void;
  /** Clears everything being composed: the draft and the attached page. */
  onClearInput: () => void;
  onSend: () => void;
  onStop: () => void;
}

function ChatComposer(props: ChatComposerProps) {
  const { draft, streaming } = props;

  return (
    <form
      className={classes.composer}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSend();
      }}
    >
      {props.context ? (
        <div className={classes.contextChip}>
          <Icon icon="document" size={12} />
          <span
            className={classes.contextChipLabel}
            title={props.context.title}
          >
            {props.context.title || 'Attached page'}
          </span>
          <button
            type="button"
            className={classes.contextChipRemove}
            aria-label="Remove the attached page"
            title="Remove the attached page"
            onClick={props.onRemoveContext}
          >
            <Icon icon="cross" size={12} />
          </button>
        </div>
      ) : null}
      <textarea
        className={classes.input}
        value={draft}
        rows={1}
        placeholder="Ask the on-device model…"
        aria-label="Message"
        onChange={(event) => props.onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            props.onSend();
          }
        }}
      />
      <div className={classes.composerRow}>
        <span className={classes.hint}>
          Enter sends · Shift+Enter makes a new line
        </span>
        <span className={classes.spacer} />
        {draft.trim().length > 0 || props.context ? (
          <Button
            minimal={true}
            small={true}
            icon="cross"
            text="Clear input"
            aria-label="Clear the input"
            title="Clear the input"
            onClick={props.onClearInput}
          />
        ) : null}
        {streaming ? (
          <Button
            small={true}
            intent={Intent.WARNING}
            icon="stop"
            onClick={props.onStop}
          >
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            small={true}
            intent={Intent.PRIMARY}
            icon="arrow-up"
            disabled={draft.trim().length === 0}
          >
            Send
          </Button>
        )}
      </div>
    </form>
  );
}

export interface ChatViewProps {
  messages: ChatMessage[];
  draft: string;
  /** The page attached to the next question, if any. */
  context: ChatContext | null;
  streaming: boolean;
  usage: ChatUsage;
  error: string | null;
  availability: AiAvailabilityState;
  progress: number | null;
  enabled: boolean | null;
  loaded: boolean;
  onDraftChange: (value: string) => void;
  onRemoveContext: () => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
  onCopy: (message: ChatMessage) => void;
  onRegenerate: () => void;
}

/** The view's body, presentational so its shapes can be checked statically. */
export function ChatView(props: ChatViewProps) {
  const { messages, usage, availability, enabled, loaded } = props;

  if (!loaded) {
    return (
      <div className={classes.center}>
        <Spinner size={20} />
      </div>
    );
  }

  if (availability === 'absent') {
    return (
      <div className={classes.center}>
        <Callout intent={Intent.WARNING} title="No on-device model">
          This browser does not offer Chrome&rsquo;s built-in AI, so there is
          nothing for the chat to run on. The other AI features are absent here
          for the same reason.
        </Callout>
      </div>
    );
  }

  if (enabled === false) {
    return (
      <div className={classes.center}>
        <Callout title="The on-device model is off">
          Turn it back on in Settings → AI to use the chat.
        </Callout>
      </div>
    );
  }

  return (
    <div className={classes.view}>
      <ChatStats
        usage={usage}
        canClear={messages.length > 0}
        onClear={props.onClear}
      />
      <ChatMessages
        messages={messages}
        streaming={props.streaming}
        downloadProgress={
          availability === 'downloading' ? props.progress : null
        }
        downloadable={availability === 'downloadable'}
        onCopy={props.onCopy}
        onRegenerate={props.onRegenerate}
      />
      {props.error !== null ? (
        <div className={classes.error}>{props.error}</div>
      ) : null}
      <ChatComposer
        draft={props.draft}
        context={props.context}
        streaming={props.streaming}
        onDraftChange={props.onDraftChange}
        onRemoveContext={props.onRemoveContext}
        onClearInput={() => {
          props.onDraftChange('');
          props.onRemoveContext();
        }}
        onSend={props.onSend}
        onStop={props.onStop}
      />
    </div>
  );
}

export function ChatPanel() {
  const messages = useStore($chatMessages);
  const draft = useStore($chatDraft);
  const context = useStore($chatContext);
  const status = useStore($chatStatus);
  const usage = useStore($chatUsage);
  const error = useStore($chatError);
  const loaded = useStore($chatLoaded);
  const availability = useSyncExternalStore(
    subscribeAiAvailability,
    getAiAvailability,
    getAiAvailability,
  );
  const enabled = useSyncExternalStore(
    subscribeAiEnabled,
    getAiEnabled,
    getAiEnabled,
  );

  useEffect(() => {
    void loadChat();
    void probeAiAvailability();
    void loadAiEnabled();
  }, []);

  const onDraftChange = useCallback((value: string) => {
    setChatDraft(value);
  }, []);
  const onRemoveContext = useCallback(() => {
    setChatContext(null);
  }, []);
  const onSend = useCallback(() => {
    void sendChat($chatDraft.getState());
  }, []);
  const onStop = useCallback(() => {
    stopChat();
  }, []);
  const onClear = useCallback(() => {
    void clearChat();
  }, []);
  const onCopy = useCallback((message: ChatMessage) => {
    // the raw markdown: what a markdown-aware target wants, and what the model
    // actually said
    void navigator.clipboard?.writeText(message.content).catch(() => undefined);
  }, []);
  const onRegenerate = useCallback(() => {
    void regenerateChat();
  }, []);

  return (
    <ChatView
      messages={messages}
      draft={draft}
      context={context}
      streaming={status === 'streaming'}
      usage={usage}
      error={error}
      availability={availability.state}
      progress={availability.progress}
      enabled={enabled}
      loaded={loaded}
      onDraftChange={onDraftChange}
      onRemoveContext={onRemoveContext}
      onSend={onSend}
      onStop={onStop}
      onClear={onClear}
      onCopy={onCopy}
      onRegenerate={onRegenerate}
    />
  );
}
