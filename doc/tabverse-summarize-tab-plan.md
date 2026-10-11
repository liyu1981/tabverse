# Plan: summarize a tab into a note

Status: **built** (2026-10-11). Extension side only. No server, schema, or wire
change. **One manifest change: the `scripting` permission** (see §2).

Extends `doc/tabverse-gemma-nano-plan.md`, which built the on-device model and
deliberately shipped with no permission change ("no permission is needed to call
a native API"). Summarizing a tab is a different job: it has to *read the page*,
and that is what costs the permission.

## 0. The feature

A live tab in the tabverse list gets a summarize button. One click reads the
page's visible text, asks Chrome's built-in model (the Prompt API / Gemma Nano)
for a short summary, and drops the result into a new note of the current
tabverse. The note body leads with the tab's **title and url** (the url as a
link), then the summary; the note is named for the tab. The button is hidden
when the browser has no built-in AI or the person switched AI off in Settings,
and **disabled while the tab is suspended** - a discarded tab has no page to
read until it is opened again.

## 1. Where we are

- The on-device model, session caching, availability, the AI setting and the
  prompt log already exist (`src/ai/`), built for name suggestions.
- Notes are a tabverse entity (`src/data/note/`): `Note { tabSpaceId, name,
  data }`, `data` is TipTap HTML, saved through `saveAllNote` and the sync
  layer. `NotebookView` owns creation today.
- The extension has no content script and never injects: it reads only tab
  metadata (`title`, `url`, `favIconUrl`). Reading page text is new ground.

## 2. The one decision that costs something: `scripting`

Reading a live tab's rendered text needs `chrome.scripting.executeScript`. There
is no way around it: `chrome.tabs` exposes no page content, a re-`fetch` of the
url would miss JavaScript-rendered pages and authenticated ones, and a declared
content script would run on every page instead of on demand.

So `src/manifest.json` gains exactly one permission:

```json
"permissions": ["tabs", "tabGroups", "scripting", "storage", ...]
```

What this means, stated plainly:

- **It is an escalation.** The extension already holds `<all_urls>` host
  permissions, but until now it could not *read* a page. `scripting` lets it.
- **It is used on demand, not ambiently.** Injection happens only on the
  summarize click, only into the tab that was clicked. No content script, no
  page-load hook.
- **The text never leaves the machine.** It goes to the built-in model in the
  same browser (`src/ai/session.ts`), the summary is stored in the user's own
  note, and the only network path is the existing sync of that note.
- **The Chrome Web Store listing's permission justification must be updated**
  before shipping, the same way ADR 0002 required for the sync feature.

A deployment that does not want this can drop the button without touching the
rest: the button is hidden unless the model is available, and nothing else in
the extension imports `tabText.ts`.

## 3. The shape

```
tab card ──click──► data/tabSpace/tabText.ts        (chrome.scripting)
                        │  visible page text, capped
                        ▼
                    ai/summarize.ts                  (pure + injected session)
                        │  prompt → model → summary
                        ▼
                    data/note/util.ts                (addNoteToTabSpace)
                        │  new Note{name, html}
                        ▼
                    $allNote → saveAllNote → sync
```

## 4. Decisions

| # | Decision | Why |
| --- | --- | --- |
| S1 | **Extract on click, via `chrome.scripting`** | the only way to read rendered, authenticated page text; on-demand rather than a content script |
| S2 | **The model runs in the manager page** | same as the name suggester (gemma plan D2): the API is window-scope and the worker dies mid-call |
| S3 | **One click, one note - no candidate list** | a summary is a single result; a list to choose from would be ceremony. The note is named `Summary: <tab title>` |
| S4 | **Plain text in, safe HTML out** | the reply is prose, so no `responseConstraint`; `summaryToNoteHtml` escapes and turns bullets into a `<ul>` |
| S5 | **Page text is data** | it is attacker-controlled: sanitized to one line before it becomes a prompt, and the system prompt says to ignore instructions in it (the `naming.ts` defense, bigger surface) |
| S6 | **A note is added to the current tabverse's list** | `addNoteToTabSpace` loads the list first if the Note panel has not been opened, so a note never lands on a stale tabverse; when the panel is open it also flushes pending edits |
| S7 | **Failure is a line, never a throw** | an unreadable tab (`chrome://`, a PDF, a page that went away), an empty page, and a model error each become one honest tooltip line |
| S8 | **The note carries the tab's title and url** | the title as a heading, the url as a real link for http(s) (plain text otherwise, so a `javascript:` url is never clickable), then the summary. All three are escaped |
| S9 | **Disabled while suspended** | a discarded tab has no page to read, so the button is disabled until the tab loads again. `copyChromeTabFields` now copies `discarded` both ways (it used to only ever set `suspended = true`), so opening a suspended tab re-enables the button |

## 5. Files

| File | Change |
| --- | --- |
| `src/manifest.json` | add `scripting` |
| `src/data/tabSpace/tabText.ts` | new: `extractTabText`, `capTabText`, injected extractor |
| `src/ai/summarize.ts` | new: system prompt, `buildSummarizePrompt`, `parseSummary`, `summarizeTab`, `summaryToNoteHtml`, `summaryNoteName` |
| `src/data/note/util.ts` | `newSummaryNote`, `addNoteToTabSpace` |
| `src/ui/manager/TabSpace/SummarizeTabButton.tsx` | new: the control (view + container) |
| `src/ui/manager/TabSpace/TabCard.tsx` | an `actions` slot in the live action row |
| `src/ui/manager/TabSpace/TabSpaceListView.tsx` | pass the button as the tab's action |
| `src/data/tabSpace/chromeTabFields.ts` | copy `discarded` both ways, so `suspended` clears when a tab reloads |
| `src/ai/__tests__/summarize.test.ts`, `src/data/tabSpace/__tests__/tabText.test.ts`, `src/data/tabSpace/__tests__/chromeTabFields.test.ts`, `src/ui/manager/TabSpace/__tests__/SummarizeTabButton.test.tsx` | new suites |

## 6. Tests

- `summarize.ts`: the prompt is sanitized (control chars, newlines) and budgeted;
  the reply is cleaned and capped; bullets become a list; HTML is escaped; the
  note name is prefixed and capped; an empty page never calls the model.
- `tabText.ts`: the cap, an unreadable tab, a failed injection, and a
  non-positive id - all with the browser injected.
- `SummarizeTabButton`: the view draws the button and its busy/disabled
  states; the container is hidden when AI is off, absent, or still checking,
  and disabled when the tab is suspended.
- `chromeTabFields`: `discarded` sets `suspended` both ways, while an unloaded
  tab still does not blank a kept tab's title.

## 7. Not in this increment

- Streaming the summary into the note as it is generated.
- Summarizing every tab at once, or a whole tabverse.
- Storing the source url/tab on the note (the note name carries the title only).
- Summarizing from the popup or the service worker.
