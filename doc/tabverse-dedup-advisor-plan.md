# Plan: deduplicate as an advisor (scan in the worker, act in the manager)

Status: **plan** (2026-10). Extension only. Follows the tab snapshot model
(`src/data/tabSpace/Tab.ts`), the pure-decision pattern of the suspender
(`src/data/tabSpace/suspender.ts`) and the preview reaper
(`src/data/tabSpace/previewReaper.ts`), the worker lifecycle in
`src/background.ts`, and the manager's banner slot
(`src/ui/manager/TabSpace/TabSpaceListView.tsx`). It is a new cross-cutting
extension behaviour, so it wants an ADR of its own (`adr/0033`).

## 0. What is being asked

1. **Dedup as an advisor, never as a gate.** While a person works, the
   extension does not close or block anything. It *watches*, and when the
   person comes back to the extension it can say "I found duplicate tabs" and
   offer **Remove duplicates** or **Ignore**.
2. **The check runs in the worker, not the UI.** A periodic scan (and a
   refresh when the manager opens) keeps the answer ready off the render path,
   so the tabverse view never has to compute it and never stutters.

The notice lives in the **tabverse manager window** (the tab list), which is
what "our extension" means for this feature.

## 1. Where we are (grounded)

- **The manager banner slot exists.** `TabSpaceListView` renders
  `<CapabilityWarning />` immediately above the tab entries
  (`src/ui/manager/TabSpace/TabSpaceListView.tsx`, around line 409). That is
  where a one-line notice that expands in place already lives, and the advisor
  notice belongs beside it.
- **Periodic work already has a shape.** The preview reaper and the suspender
  each create their own `chrome.alarms` alarm only when missing, once per
  browser session, and run a sweep in the worker
  (`src/background.ts`, `PREVIEW_REAP_ALARM` and `SUSPEND_SWEEP_ALARM`);
  `chrome.idle.onStateChanged` already triggers an audit pass.
- **A decision that must be testable is a pure function.** `tabsToSuspend`
  takes a plain candidate list and returns ids
  (`src/data/tabSpace/suspender.ts`), and only `suspendInactiveTabs` touches
  `chrome.*`. This feature gets the same split.
- **The remit is "windows that hold a Tabverse".** The suspender only
  considers a window that contains a manager tab
  (`isTabSpaceManagerPage`, `src/global`), which keeps the extension inside
  its own tabs. Dedup uses the same rule.
- **Tab events are cheap and plentiful.** `chrome.tabs.onCreated`,
  `onUpdated`, `onRemoved`, `onActivated` and `chrome.windows.onFocusChanged`
  are the stream of "the person is operating"; the reaper already listens to
  `onRemoved`/`onDetached` at the top level.
- **The tab shape is small and stable.** `Tab`/`TabCore` carry `url`, `title`,
  `pinned`, `suspended`, plus live `chromeTabId`/`chromeWindowId`
  (`src/data/tabSpace/Tab.ts`); a `chrome.tabs.Tab` also has `active`,
  `audible` and `lastAccessed`, which the suspender already reads.
- **Settings are device-local and follow one shape.** `suspendSettings.ts` and
  `aiSettings.ts`: absent means the default, `null` means "not read yet", and
  the write is optimistic. `chrome.storage.local` is the home
  (`src/storage/localSetting.ts` is per-window `localStorage`, not this).
- **The worker already talks to pages.** `BackgroundMsg` messages
  (`src/message/message.ts`) push `LocalTablesChanged`, `SyncActivityChanged`
  and `AuditComplete`; the manager subscribes. The advisor adds one more.
- **Nothing here needs the server.** Tab ids are per browser session and the
  report is a device-local fact; it is not synced and never leaves the machine
  (`adr/0002`).

## 2. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | What is a duplicate? | Two or more **open tabs in the same window** whose URL normalises to the same key, in a window that holds a Tabverse manager tab. |
| D2 | What is "the same URL"? | A pure `duplicateKey(url)`: lowercase scheme/host, default ports dropped, fragment dropped, trailing slash dropped. `chrome://`, `file://`, `about:` and extension pages are **never** duplicates. Tracking parameters are **kept** in v1 (an optional stripping setting is a later question). |
| D3 | Which tab is kept? | The **keeper** is chosen deterministically: active > audible > pinned > newest `lastAccessed` > lowest tab index. Everything else in the group that is not pinned, not audible and not the manager tab is a **closer**. |
| D4 | When is a group not actionable? | When it has no closers (all members pinned/audible, or only the manager tab and one other) it is shown as **protected** with the reason, and **Remove duplicates** is not offered. |
| D5 | Does the scan ever close anything? | **No.** The worker only reads and reports. Tabs are closed only when a person presses **Remove duplicates**, which re-validates every closer against the live tab immediately before closing. |
| D6 | Where does the scan run? | In the **service worker**, on its own alarm and once per browser session, plus a debounced scan when the manager opens or a tab event marks the report stale. Tab events set a dirty flag and schedule; they never scan inline. |
| D7 | How does the UI get it? | The manager **requests** the report on mount and **subscribes** to a push. It renders stored data; it never computes duplicates. |
| D8 | Ignore, once or for good? | Two actions: **Ignore** dismisses the current report (fingerprint, remembered locally with a TTL); **Always ignore this URL** adds the key to a permanent ignore list in settings. |
| D9 | Can it be turned off? | Yes: `tabverse_dedup_enabled_v1` (default **on**, because the advisor is non-destructive and dismissible) and a scan interval. |
| D10 | Undo? | An apply records what it closed (bounded, last apply) and the notice offers **Undo** to reopen them. Phase 2; the apply path is written so this is a record, not a re-architecture. |
| D11 | Cross-window? | Within a window for v1 - a window is the tabverse's remit. The report carries `windowId`, so widening later is a query change, not a model change. |
| D12 | Does the report survive a worker teardown? | It lives in `chrome.storage.session`: it survives the worker being woken again within a browser run and is discarded on restart, which is exactly the lifetime of a `chromeTabId`. |

## 3. The model (pure, no `chrome`)

New `src/data/tabSpace/dedup.ts`:

```ts
/** A tab as the dedup decision sees it; a subset of chrome.tabs.Tab plus ours. */
export interface DedupTab {
  chromeTabId: number;
  chromeWindowId: number;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  lastAccessed: number | undefined;
  index: number;
  background: boolean; // is this the tabverse manager tab
}

export interface DuplicateTabRef {
  chromeTabId: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  background: boolean;
}

export interface DuplicateGroup {
  key: string;            // duplicateKey(url), also the ignore key
  url: string;            // the keeper's url, for display
  windowId: number;
  keeper: DuplicateTabRef;
  closers: DuplicateTabRef[];
  protectedReason?: 'all-pinned' | 'all-audible' | 'manager-only';
}

/** Tabs that normalise to the same key, grouped; empty when there is nothing
 *  worth a notice. Pure: no chrome, no clock. */
export function findDuplicateGroups(tabs: DedupTab[]): DuplicateGroup[];

/** The URL identity rule, its own function so it can be tested alone. */
export function duplicateKey(url: string): string | undefined;

/** Re-validate a group against the live tabs and return the ids safe to close. */
export function planDedupApply(
  groups: DuplicateGroup[],
  live: DedupTab[],
  ignored: Set<string>,
): number[];
```

`duplicateKey` returns `undefined` for a non-dedupable scheme and
`findDuplicateGroups` drops those and every key with fewer than two live
members. A group with no closers is kept and marked `protected` (D4), so the
notice can explain it rather than hide it. Groups are ordered by number of
closers, then URL, so the notice is deterministic.

## 4. The worker

New `src/data/tabSpace/dedupScan.ts`, the only file that touches `chrome.*`,
in the mould of `suspender.ts`:

```ts
export interface DedupReport {
  scannedAt: number;
  windows: number;
  tabs: number;
  groups: DuplicateGroup[];
  fingerprint: string;   // stable hash of the group keys + closer ids
}

export async function scanForDuplicates(options?: DedupScanOptions): Promise<DedupReport>;
```

- `chrome.tabs.query({})` once; filter to `isTabSpaceManagerPage` windows;
  build `DedupTab[]`; call the pure `findDuplicateGroups`; store the report in
  `chrome.storage.session` under `tabverse_dedup_report_v1`.
- **Once per browser session** at worker start, like
  `sweepPreviewsOncePerSession` in `src/background.ts`, so a restart produces a
  fresh answer before the manager is even opened.
- **Its own alarm** `tabverse_dedup_scan` (created only when missing), period
  from `tabverse_dedup_scan_minutes_v1` (default 10, clamped like
  `clampSuspendMinutes`).
- **A dirty flag, not an inline scan.** `chrome.tabs.onCreated/onUpdated/
  onRemoved/onActivated` and `chrome.windows.onFocusChanged` set
  `dedupDirty = true`; a short `setTimeout` (and the alarm) coalesces a burst
  into one scan. The event handler returns immediately, so nothing the person
  does waits on the scan.
- **On a changed report**, push the new fingerprint to open manager pages (D7);
  on no change, push nothing.
- The scan never throws: a failed `tabs.query` is logged and the previous
  report stands.

## 5. Coming back to the extension

The manager mount is the "user returned" moment:

- `src/ui/manager` sends `DedupMsg.RequestReport` on mount. The worker answers
  with the stored report immediately when it is fresh; when the report is
  missing or older than the interval it scans first and answers, so the first
  paint still has the stored one and the fresh one follows.
- The manager subscribes to `DedupMsg.Changed` (a `BackgroundMsg`) and
  re-reads. `onActivated` for a manager tab and `onFocusChanged` also schedule
  a scan, so returning to the window after working elsewhere refreshes it.

## 6. Storage

| key | area | lifetime | what |
|---|---|---|---|
| `tabverse_dedup_report_v1` | `session` | one browser run | the last `DedupReport`; dies with the tab ids it names |
| `tabverse_dedup_enabled_v1` | `local` | until changed | the advisor switch |
| `tabverse_dedup_scan_minutes_v1` | `local` | until changed | the alarm period |
| `tabverse_dedup_ignore_v1` | `local` | until changed | permanent ignore keys (always-ignore URLs) |
| `tabverse_dedup_dismissed_v1` | `local` | 7 days | fingerprint -> dismissedAt, so "Ignore" is not re-asked every scan |

Settings follow `suspendSettings.ts`: absent means the default, `null` means
"not read yet", writes are optimistic and the in-memory value notifies
subscribers.

## 7. The notice (manager UI)

A new `src/ui/manager/TabSpace/DedupAdvisorNotice.tsx`, rendered just above the
tab entries beside `CapabilityWarning`:

- **Collapsed** (one line, no layout shift beyond a banner): "3 duplicate tabs
  found in this window - Review / Ignore".
- **Expanded** (the `CapabilityWarning` expand-in-place pattern; a floating
  panel over the tabs it is talking about is the one thing to avoid): one row
  per group - the URL, "keeping <title>" and "closing 2" - plus a per-group
  **Always ignore this URL**, and the notice-level **Remove duplicates** and
  **Ignore**.
- **Protected** groups render greyed with the reason ("all copies are pinned"),
  so the count is honest and there is nothing to press.
- **After an apply**: "Removed 3 tabs - Undo" (D10), and the notice disappears
  if nothing is left.
- The notice is driven by an effector store fed by the report message; it holds
  no decision logic of its own.

Reached only through the store, the notice is checked by what it renders to
static markup with a fixture report (ADR 0018, AGENTS.md: no browser).

Optionally (phase 4) a full **Duplicates** view in the right side panel
(`src/ui/manager/RightSidePanel`) for every tabverse window at once; the
banner is the requirement, the panel is a convenience.

## 8. The actions

- **Remove duplicates** sends `DedupMsg.Apply { fingerprint }`. The worker
  re-reads the live tabs, runs `planDedupApply` against them and the ignore
  list, closes the returned ids with `chrome.tabs.remove`, records the closed
  tabs for Undo, and scans again.
- **Ignore** sends `DedupMsg.Ignore { fingerprint }` and writes the dismissed
  entry; the notice hides until the underlying set changes (a new fingerprint).
- **Always ignore this URL** writes the key to `tabverse_dedup_ignore_v1`.
- **Undo** reopens the recorded tabs with `chrome.tabs.create` at their index
  and window, best effort.
- Every mutation is a **message to the worker**; the manager never calls
  `chrome.tabs.remove` itself, so there is one place that closes tabs and one
  place that audits what it did.

## 9. Message protocol (`src/message/message.ts`)

```
DedupMsg.RequestReport   page -> worker      -> DedupReport | null   (answer)
DedupMsg.Apply           page -> worker      { fingerprint }
DedupMsg.Ignore          page -> worker      { fingerprint }
DedupMsg.AlwaysIgnore    page -> worker      { key }
DedupMsg.Undo            page -> worker      {}
DedupMsg.ReportChanged   worker -> pages      { report }   (push)
```

`ReportChanged` is added to `BackgroundMsg` so the existing
`chrome.runtime.onMessage` fan-out carries it; the answer to `RequestReport`
uses the callback form the external-pairing listener already uses.

## 10. Settings

A small block in the manager's settings (the shape the suspension switch uses):
**Duplicate advisor** on/off, and the scan interval. Defaults: on, 10 minutes.
Turning it off clears the report and stops the alarm; turning it on scans
immediately.

## 11. Testing

- `duplicateKey`: scheme/host case, default port, fragment, trailing slash,
  query kept, `chrome://`/`file://` refused.
- `findDuplicateGroups`: grouping, keeper selection for every tie-break, a
  protected group, manager tabs excluded, order stability.
- `planDedupApply`: re-validation (a tab that changed or closed is dropped),
  ignored keys skipped, never returns a pinned/audible/manager id.
- The scan with injected `queryTabs`/storage, like `suspendInactiveTabs` tests,
  including the dirty-coalescing and the once-per-session guard.
- The notice rendered to static markup for the collapsed, expanded, protected
  and post-apply states.
- A store/settings test for defaults, `null` before first read, and optimistic
  write.

## 12. Rollout

- **Phase 1 - pure core.** `dedup.ts` (`duplicateKey`, `findDuplicateGroups`,
  `planDedupApply`) and its tests. No `chrome`, no UI, nothing shipped changes.
- **Phase 2 - the worker.** `dedupScan.ts`, alarm, session scan, dirty flag,
  report storage, message push/answer; wired into `src/background.ts` next to
  the reaper and suspender.
- **Phase 3 - the notice.** `DedupAdvisorNotice`, the report store, the
  Apply/Ignore/Always-ignore actions, the push subscription.
- **Phase 4 - settings + undo.** The switch and interval, the bounded Undo
  record, and (optional) the right-panel Duplicates view.

## 13. Open questions

1. **Tracking parameters.** `?utm_*` and friends make the "same" page not
   normalise equal. Stripping them finds more duplicates and is what a person
   means by "the same page", but it is opinionated about their URLs. Proposed:
   keep them in v1, add a setting later.
2. **Keeper preference.** Newest `lastAccessed` is proposed as the tie-break
   after active/audible/pinned. Some people mean "keep the first"; the choice
   is one comparator if it should be reversed or made a setting.
3. **How long is "Ignore" remembered?** Proposed: the dismissed fingerprint is
   kept 7 days; the underlying set changing produces a new fingerprint and
   re-asks. `Always ignore this URL` is the permanent answer.
4. **Undo across windows.** Reopening at the original index and window is best
   effort; if the window is gone the tab goes to the current one. Acceptable,
   and stated in the notice.
