# Plan: an opened tab as Markdown

Status: **built** (2026-10-16). Extension side only. No server, schema, wire or
manifest change: it reuses the `scripting` permission the summarize feature
already added.

## 0. The feature

The live-tab action button (the lightbulb on a tab card) grows from a
summarize-only menu into a **page-actions** menu:

1. **View page content as Markdown** - reads the page, converts it, and opens
   a dialog showing the Markdown with a **Copy** button. Needs no AI.
2. **Send page content to AI chat** - reads the page, converts it, brings the
   tabverse's **AI Chat tool tab** forward and puts the Markdown in the
   composer, so the person adds the question they actually have. Needs AI.
3. **New note with AI summary** - reads the page, converts it, then summarizes
   the *Markdown* (not the old `innerText`) into a new note.
4. **Append to current note with AI summary** - the same summary, proposed to
   the note being edited (ADR 0031).

The button is now always drawn on a live tab, because outcome 1 needs no model;
the AI items are the ones disabled when the browser has no built-in AI or the
person switched it off. It is disabled while the tab is suspended, and the
Markdown conversion itself runs in a **Web Worker**.
## 1. Why this is worth doing

The old summarize read `document.body.innerText`. That is flat text: headings,
links, lists, code and tables all collapse, and the page chrome (nav, cookie
banner, footer) comes with it. Readability isolates the article, Turndown keeps
its structure, and the whole thing is Markdown - which is the note's own format
(ADR 0030) and the chat's own rendering format (`ChatPanel`). The summary gets
cleaner for the same reason, because the model is now handed the article's
prose rather than the page's chrome.

## 2. The pipeline

```
live tab
  │ chrome.scripting.executeScript  (isolated world, self-contained function)
  │   clone <html>, drop script/style/noscript/template/link
  ▼
{ html, url }  ──postMessage──►  Web Worker
                                    │ linkedom       parse to a DOM
                                    │ Readability    keep only the article
                                    │ Turndown + GFM article -> markdown
                                    ▼
                              { title, byline, siteName, excerpt, markdown }
  ◄────onmessage──────────────────────┘
  │
  ├─ view  → the Markdown view dialog, which copies on demand
  ├─ chat  → the composer, then open the panel
  └─ note  → markdownToPlainText → the model → a note
```

### 2.1 Why the worker needs a DOM library

Readability and Turndown both walk a DOM. A Web Worker has no `document` and no
`DOMParser`; Turndown's browser build additionally reads the global
`window`/`document` whenever it is handed an HTML **string**. `linkedom`
supplies a DOM in the worker: Readability runs on it unchanged, and Turndown is
handed an already-parsed **node** (never a string), which skips its own parser
entirely. `linkedom` ships a worker build (`linkedom/worker`).

Three ways this could have run, and why the middle one won:

| Option | Where | DOM | Blocked the manager UI | Node-testable |
| --- | --- | --- | --- | --- |
| A | injected page context (a bundled content script) | the real one | no (the page's thread) | no |
| B | **Web Worker + linkedom** | linkedom | **no** | **yes** |
| C | the manager page | the real one | **yes** | yes |

A would have needed a second build target (a self-contained IIFE for
`executeScript({ files })`) and its conversion is not reachable from a unit
test. C is exactly what the feature is avoiding. B keeps the libraries in the
normal Vite bundle, runs the conversion off the UI thread, and its logic is a
pure function that runs under `vitest` in a node environment.

### 2.2 The linkedom gaps worked around

- `HTMLTableElement.rows` / `HTMLTableRowElement.cells` are missing, and the
  GFM table rule reads them. Two query-backed getters are installed once, on
  the shared `HTMLElement` prototype so the nodes Turndown clones inherit them.
  A row of a nested table is also returned, which a real `rows` would not do;
  the honest cost, and the fallback for an unreadable table is its raw HTML.
- Turndown must be given a node. Passing a string in a worker reaches for
  `document` and throws - the one rule the worker keeps.
- A document parsed from a string has no base url. The page's own
  `document.baseURI` is sent along, and a `<base>` is injected only when the
  page has none of its own - so a page that declares a base keeps it.

## 3. Decisions

| # | Decision | Why |
| --- | --- | --- |
| M1 | **Readability, then Turndown** | isolating the article is what makes the Markdown watchable; converting the whole page keeps nav, ads and footers |
| M2 | **The conversion runs in a Web Worker** | off the manager's main thread; the pure `htmlToMarkdown` is testable in node without a browser |
| M3 | **Serialize the DOM in the page, parse it in the worker** | the injected function stays self-contained (the same constraint as `readPageText`); the libraries are never injected |
| M4 | **Pre-strip `script`, `style`, `noscript`, `template`, `link` on a clone** | inline app JSON (`__NEXT_DATA__`, hydration blobs) dwarfs the prose; the clone keeps the live page untouched |
| M5 | **Base url from `document.baseURI`, a `<base>` only when the page has none** | so relative links and images resolve the way the page itself resolves them |
| M6 | **A local GFM table shim, not a fork of the plugin** | `@joplin/turndown-plugin-gfm` is maintained; only linkedom's missing APIs need patching |
| M7 | **Falling back to the whole body when Readability finds no article** | a login page or web app still returns something instead of failing the whole action |
| M8 | **Markdown is Markdown, and only the title/url are escaped** | the summary prompt gets `markdownToPlainText(markdown)`; the note's title and url are escaped exactly as `summaryNoteBody` already does |
| M9 | **The chat gets a draft, not a sent turn** | the page in the composer plus the person's own question beats a context sent with no question; the item is named "Send page content to AI chat" |
| M10 | **The view and the chat item are the reason the button is always drawn** | only the summary items need the model, so the button no longer disappears when AI is off - only those items disable |
| M11 | **One worker per run, terminated on the answer or a 20s timeout** | a page action happens a few times at most; nothing is pooled, so a conversion can never be answered from a stale page, and a hung worker cannot hold the page |
| M12 | **Failure is one honest status line, never a throw** | an unreadable tab, an empty article, a worker error, a timeout and a clipboard refusal each say what happened |
| M13 | **A new dependency set, no new permission** | `@mozilla/readability`, `linkedom`, `turndown`, `@joplin/turndown-plugin-gfm`; `scripting` + `<all_urls>` already cover the read |

## 4. Files

| File | Change |
| --- | --- |
| `package.json` | add `@mozilla/readability`, `linkedom`, `turndown`, `@joplin/turndown-plugin-gfm` and `@types/turndown` (devDependencies, where this repo keeps everything) |
| `src/types/turndown-plugin-gfm.d.ts` | new: the plugin ships no types |
| `src/data/tabSpace/articleMarkdown.ts` | new: `htmlToMarkdown` - linkedom parse, table shims, base, Readability (body fallback), Turndown + GFM |
| `src/data/tabSpace/pageMarkdown.worker.ts` | new: the worker entry, a thin shell around `htmlToMarkdown` |
| `src/data/tabSpace/pageMarkdown.ts` | new: `convertTabToMarkdown`, the per-run worker, the timeout, the injectable extractor/runner |
| `src/data/tabSpace/tabText.ts` | add `extractTabHtml` (clone, strip, serialize, base url) and its test hook, next to the existing `extractTabText` |
| `src/message/message.ts` | add `ToolTabMsg.OpenChat` and its overloads |
| `src/ui/manager/TabSpaceRightSide/TabSpaceRightSideView.tsx` | subscribe to `ToolTabMsg.OpenChat` and bring the chat tool tab forward; the chat itself lives here now |
| `src/ui/manager/RightSidePanel/RightSidePanel.tsx` | the chat is removed from the panel's rail; it keeps the AI history and the server console |
| `src/ui/manager/TabSpace/TabContentButton.tsx` (+ `.module.scss`) | renamed from `SummarizeTabButton`: the four-item menu and the container that runs them |
| `src/ui/manager/TabSpace/MarkdownViewDialog.tsx` (+ `.module.scss`) | new: the Markdown view - a body (the Markdown and a Copy button) split from the `Dialog`, so the body is checkable statically |
| `src/ui/manager/TabSpace/TabSpaceListView.tsx` | the tab's action slot uses `TabContentButton` |
| `src/manifest.json` | unchanged |
| tests | `src/data/tabSpace/__tests__/articleMarkdown.test.ts`, `__tests__/pageMarkdown.test.ts`, additions to `__tests__/tabText.test.ts`, `src/ui/manager/TabSpace/__tests__/TabContentButton.test.tsx` (renamed) and `__tests__/MarkdownViewDialog.test.tsx` |

## 5. Tests

- `articleMarkdown.ts`: the fixture page converts - heading, bold/italic, list,
  fenced code, a GFM table - and the nav, footer and inline script are gone;
  relative links and images are absolute against the base; Readability's title
  is reported; a page with no article falls back to the whole body; an empty
  document is null.
- `pageMarkdown.ts`: the extractor is handed the tab id and its answer reaches
  the runner; an unreadable tab never reaches the runner; a runner that throws
  is null; a non-positive id reaches neither.
- `tabText.ts`: `extractTabHtml` returns `{ html, url }`, and an unreadable
  tab / failed injection / non-positive id are null, with the browser injected.
- `TabContentButton`: the menu names the four outcomes and disables the AI ones
  (and append) correctly; the view draws its busy and disabled states; the
  container draws the button for a live tab, still draws it when AI is off or
  absent, and disables it while the tab is suspended.
- `MarkdownViewBody`: the title and the Markdown are shown verbatim, and the
  copy button reports its copied state. The dialog's open/close is for the
  browser to check.
- The worker itself has no test: it is a shell around `htmlToMarkdown`.

## 6. Build and verification

- `new Worker(new URL('./pageMarkdown.worker.ts', import.meta.url), { type: 'module' })`
  makes Vite emit a worker chunk; confirm it lands in `dist/` and is referenced
  from the manager bundle.
- Vite resolves Turndown's **browser** build for that worker (the package's
  `browser` field); vitest's node resolution uses the node build, and both work
  because Turndown is only ever handed a node.
- Bounded checks, per AGENTS.md: the new vitest suites, `pnpm run typecheck`,
  `pnpm run lint:check`, `pnpm run format:check`, and a `pnpm build` whose
  output is inspected.
- The UI (the menu, the copied clipboard, the chat draft, the note) is for the
  user to check; it is not driven from here.

## 7. Not in this increment

- A "copy straight from the menu" action; copying lives in the view dialog.
- A "new note with the full page Markdown" outcome; the page goes to the
  clipboard or the chat, and the note carries the model's summary.
- Sending the Markdown to the chat as an already-sent turn.- Inlining or rewriting images; Turndown keeps their url.
- Reading `<iframe>` and shadow-DOM content (neither is in `outerHTML`).
- Per-site or user-provided extraction rules.
- A cap on the serialized markup; a very large page is transferred whole.
- Converting from the popup or the service worker: like the on-device model,
  this lives in the manager page.

## 8. Open questions

1. **The view and chat on a page Readability cannot parse.** The body fallback
   keeps the action working, but the Markdown then carries the page chrome. Is
   that better than an honest "could not find an article"?
2. **A huge page in the chat composer.** The Markdown goes in uncapped; a long
   article could fill the model's context on the first turn. Cap it, or leave
   the compaction the chat already does to handle it?
