# Plan: warming the built-in model (the first-message wait)

Status: **proposed** (2026-10-16). Extension only. No server, schema, wire or
manifest change. Recording the analysis only - nothing here is built, and the
conclusion is that the win is small.

## 0. The question

The AI features have a waiting time on the first message after a page opens.
Two things were asked:

1. After the prefill, will Chrome unload the model?
2. Can we pre-warm the Prompt API so the next message is answered faster?

The short answers are in §2; the reason the win is judged small is in §4.

## 1. Where we are

- `src/ai/session.ts` caches **one session per system prompt**, created lazily
  on first use, for the page's life; `destroyAiSessions()` runs on `pagehide`.
  The first use pays `create()`.
- `src/data/aiChat/runtime.ts` keeps **one chat session** for the conversation,
  created on the first send and reused; `stopChat`, a failure, `clearChat` and
  compaction all `destroy()` it, so the next send recreates one.
- `createChatSession` (`src/ai/chatSession.ts`) calls `createRawAiSession` with
  `systemPrompt` **and `initialPrompts: history`**.
- `probeAiAvailability()` is cheap and unrelated; it only asks the state machine.
- The expensive call is `create()`. For the chat's first send it is *model load*
  **plus prefill of the stored history**, then the question itself is prefilled.
- `prepareAiModel(systemPrompt)` already exists and is the settings section's
  "download" button; it warms the naming session as a side effect.

## 2. What Chrome does, and what we do not know

- The model (Gemini Nano) is a shared, downloaded component. `create()` loads it
  into memory and makes a session; a session holds the prefill in its KV cache.
- A live session keeps the model loaded. When **no** session references it,
  Chrome is free to unload it - after idle, or under memory pressure. There is
  **no public pin / keep-alive / warm-up call**; the only lever is holding a
  session.
- A session itself can be terminated by Chrome at any time.
- So: within one page life we already keep it warm (the caches above); across a
  reload, or if Chrome evicts it, the first message pays again.

**Unknown, and the reason a spike is required** (the gemma plan's §4
methodology; AGENTS.md forbids browser automation, so the user runs it):

- how long an idle, kept-alive session actually survives;
- whether a hidden/backgrounded page keeps it;
- whether the model survives `destroy()` + immediate `create()`;
- whether `pagehide` costs anything (it should not - the page is going away).

## 3. What pre-warming would look like

There is no dedicated warm-up; **creating the real session early is the
warm-up**. The design constraints, if it were built:

1. **Share the in-flight promise.** The chat session must become a module-level
   cached `Promise<ChatSession>` (as `session.ts` does), never the current
   `let session: ChatSession | null`. `prepareChatSession()` starts it and
   `answerQuestion` awaits the same promise, so a fast first send *joins* the
   warm-up instead of racing it into a second `create()`.
2. **Warm only after `loadChat()`.** The session is seeded with the stored
   history; warming before it is read seeds an empty history and the first send
   recreates.
3. **Gate on `availability() === 'available'`.** Warming a `downloadable` model
   with `create()` starts the download, which plan D4 reserves for the first
   click. Never warm `downloadable`/`downloading`.
4. **Re-warm after it goes cold.** `stopChat`, a failure, `clearChat` and
   compaction all destroy the session; an optional idle re-warm would cover the
   next question.
5. **Cap the seeded history** (`CHAT_CONTEXT_MESSAGES`, 20) - a long history is
   the expensive part of the prefill.
6. **Never destroy on panel unmount.** Switching tool tabs unmounts
   `ChatPanel`; the session lives in `runtime.ts` and stays warm.

### Where to warm

| # | Trigger | Moves the wait to | Background cost | Verdict |
|---|---|---|---|---|
| A | chat tool opened (`ChatPanel` mount) | the moment the chat opens | one session while the chat is mounted | best intent signal; overlaps typing |
| B | manager page idle (`requestIdleCallback`) | page idle | model resident for the page's life | broadest, most aggressive |
| C | AI settings "download" button (exists, `prepareAiModel`) | explicit action | none until clicked | already there for the naming prompt |
| D | pre-download at page load | first-ever use | network + disk | **rejected** (D4) |
| E | keep-alive heartbeat prompt | - | compute/battery | last resort, only if the spike shows fast eviction |

## 4. Why the win is judged small

- The dominant cost is the **model load**, and it is paid once per page life
  already - the existing caches keep the model warm for every message after the
  first. Pre-warming only moves that one load, and only by the open-to-first-
  message interval.
- The chat's session is seeded with the conversation, so warming it means
  prefilling the stored history early - which is the same work, just moved.
- The realistic cases where it helps are narrow: a slow machine, a long stored
  history, or a user who opens the chat and sends within a second or two. For a
  user who opens the chat and reads before typing (which is the flow now that
  the page is attached as context), the load has usually finished anyway.
- The aggressive versions (B, E) hold a large model resident, and E spends
  compute/battery, for a few hundred milliseconds saved on one message.

Conclusion: **not worth building now.** Revisit only if a spike shows the first
message is slow *after* the model is plainly already downloaded and idle, and
the user's own flow keeps hitting it.

## 5. If it is ever built

- `src/data/aiChat/runtime.ts` - cached `Promise<ChatSession>`,
  `prepareChatSession()`, await-instead-create in `answerQuestion`, re-warm
  hooks.
- `src/ui/manager/TabSpaceRightSide/ChatPanel.tsx` - `prepareChatSession()`
  after `loadChat()` when `availability === 'available'`.
- `src/ai/session.ts` - `perfStart`/`perfEnd` around `create()` so the cost is
  visible; a shared `prepareAiSession(systemPrompt)` for the named prompts.
- Tests: runtime - "prepare then send creates one session"; ChatPanel - mount
  warms only when the model is available.

## 6. The spike (manual, bounded)

On the user's Chrome, once:

1. cold page → open chat → first send: `create()` time and time-to-first-token;
2. with A on: confirm the create overlapped typing, and measure the same;
3. a kept session, idle 1 / 5 / 15 minutes, then one send - warm or reloaded?;
4. a hidden tab for 5 minutes, then a send;
5. `destroy()` then immediate `create()`: is the model already in memory?;
6. resident memory/GPU while a session is held (does Chrome show an indicator?).

Paste the numbers here before building anything.
