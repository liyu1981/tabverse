# Plan: tab suspension

Status: **built (2026-10-11).** Extension side only. No server change,
no wire change, no new permission: `chrome.tabs.discard` needs only the `tabs`
permission we already hold, and `alarms` is already granted
(`src/manifest.json`). This is the first item in
`doc/tabverse-workona-gap-plan.md` §3 (rated **M**).

Built as planned, with the defaults recommended in §8: **off** by default,
**15 minutes**, scope limited to **open tabverse windows**, and pinned/audible
as fixed skips. One refinement the build forced: the page-only publisher was
split out of `suspendWhitelist.ts` into `suspendWhitelistMonitor.ts`, because
the sweep in the service worker imports `suspendWhitelist.ts` and importing
`$tabSpace` there dragged the whole store (and Dexie) into the worker bundle.
The worker now loads no store chunk at all.

Three asks:

1. suspend an inactive Chrome tab after a configurable time;
2. a per-tabverse whitelist of tabs that are never suspended;
3. a global on/off switch.

Everything below is those three applied to what is already here.

## 0. Where we are

- **We read suspension and never cause it.** `chromeTabFields.ts:38-39` copies
  `chromeTab.discarded` into `Tab.suspended`, and `Tab.ts:14` saves it as part
  of `TabCore`. So a suspended tab is already a first-class, synced fact - there
  is simply no code that discards anything.
- **The manager tab is already protected.** `pinTabverseTabFirst`
  (`chromeUtil.ts:41`) pins the tabverse's own tab with
  `autoDiscardable: false`, so Chrome will not discard it and neither should we.
- **The reaper is the template.** `src/data/tabSpace/previewReaper.ts` is a
  worker-owned sweep on an alarm, with the browser state (the live tab ids)
  injected so the decision is a pure function. Suspension is the same shape with
  a different predicate.
- **A worker can know which tabverse a window is.** Every tabverse tab carries
  its id in the URL as `tvid` (`chromeUtil.ts:tabverseUrl`), and the manager page
  is recognisable (`isTabSpaceManagerPage`). `chrome.tabs.query({})` therefore
  says which tabverses are open, in which windows, with no registry to keep
  (`openWindowStore.ts` reaches the same conclusion).
- **`SavedTab` does not carry a Chrome tab id.** `TabCore` excludes
  `chromeTabId`/`chromeWindowId` (they are `LiveTab`, session-scoped), and the
  Dexie schema is `id, title, url, createdAt` (`Tab.ts:69`). A worker that has
  only the database therefore **cannot** map a live Chrome tab back to a saved
  tab. That is the constraint the whitelist design has to live with (§3).

## 1. The mechanism and the policy

Discard with `chrome.tabs.discard(tabId)` (`@types/chrome`: "discarded unless it
is active or already discarded"). Inactivity comes from `Tab.lastAccessed`
(Chrome 121+, and the floor is 140), which is better than a map we keep
ourselves: it survives a worker teardown and reflects real activity.

The policy is a **pure function**, so it is testable with no browser:

```ts
// src/data/tabSpace/suspender.ts
export interface SuspendCandidate {
  chromeTabId: number;
  lastAccessed: number | undefined; // chrome.tabs.Tab.lastAccessed
  active: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  autoDiscardable: boolean | undefined;
  isManagerTab: boolean;
  whitelisted: boolean;
}
export function tabsToSuspend(
  candidates: SuspendCandidate[],
  now: number,
  afterMs: number,
): number[];
```

Skip a tab unless **all** of these hold:

| Rule | Why |
| --- | --- |
| not `active` | discarding the tab in front of the person is never right |
| not `pinned` | a pinned tab is an intentional keeper |
| not `audible` | audio is use; discarding kills it |
| not `discarded` | already suspended; nothing to do |
| `autoDiscardable !== false` | Chrome itself was told not to; we do not override |
| not the manager tab | it *is* the tabverse, and is pinned anyway |
| not whitelisted | §3 |
| `lastAccessed` is a number | an unknown clock is not evidence of inactivity |
| `now - lastAccessed >= afterMs` | the whole point |

**Scope: tabs in open tabverse windows only.** A window counts when it holds a
Tabverse manager tab; its tabverse id is the `tvid` on that tab's URL. This
matches "a tab in this tabverse", keeps the extension inside its remit, and
means we never discard a stranger's tab in an unrelated window. (A global scope
is possible but is a bigger, more surprising promise - §8.)

The sweep never throws: a `discard` that fails because the tab went away, or
because Chrome refuses a split-view half, is logged and skipped. One bad tab
must not stop the pass.

## 2. Settings

Two device-level values in `chrome.storage.local`, in a new
`src/data/tabSpace/suspendSettings.ts` that copies `src/ai/aiSettings.ts`
exactly - cached value, subscribe/load/set, an injected storage area for tests,
optimistic write:

| Key | Type | Absent means |
| --- | --- | --- |
| `tabverse_suspend_enabled_v1` | boolean | **off** |
| `tabverse_suspend_after_minutes_v1` | number | 15 |

`enabled` defaults **off**: suspension changes browser behaviour and can lose
in-page state on reload, so it is opted into, not inherited. `null` before the
first read, so the switch never flashes (the AI setting's rule). Threshold is
clamped to a sane band (e.g. 5-1440 minutes) on read and write.

Both are device settings, not synced: whether *this* machine unloads tabs has
nothing to do with another device, and it keeps the change wire-free.

## 3. The whitelist

Per tabverse, and **device-local**. The stable handle we have is our own
`Tab.id`; the handle the worker needs is the session-scoped `chromeTabId`. The
bridge is the manager page, which is the only context that knows both at once.

Two layers:

1. **Durable intent, in `chrome.storage.local`**:
   `tabverse_suspend_whitelist_v1 = { [tabSpaceId]: string[] }` holding our
   `Tab.id`s. Toggled from the tab list (§5).
2. **Resolved live set, in `chrome.storage.session`**:
   `tabverse_suspend_whitelisted_tabs_v1 = number[]` of `chromeTabId`s, written
   by the manager page whenever the tabverse or the whitelist changes, using the
   live `$tabSpace` mapping. `chrome.storage.session` is the right home for a
   `chromeTabId`: its contents live for exactly one browser run and survive a
   service-worker teardown, which is what `previewSession.ts` already relies on.

The worker reads the session set and skips those ids. It does not need the
durable layer at all - the page has already resolved it. When no manager page is
open, the tabverse does not exist, so there is nothing to protect and nothing to
suspend in its window.

*Alternative if the whitelist must hold with the page closed:* store URLs (or
origins) per tabverse and match live tabs by `tab.url`. Durable and page-free,
but blunter: a tab that navigates stops matching, and URL equality is a weak
identity. Rejected as the default; noted in §8.

## 4. Where it runs

In the service worker, on an alarm, like the preview reaper
(`background.ts:startPreviewReaper`):

- one `chrome.alarms` alarm, created only if missing, `periodInMinutes: 1`
  (Chrome's floor for a released extension; the threshold itself is in minutes);
- on the alarm: read the settings, `chrome.tabs.query({})`, group tabs by
  window, find the manager tab and its `tvid`, read the session whitelist, run
  `tabsToSuspend`, and `discard` the result;
- **no-op when the switch is off**, before any query - the feature costs nothing
  when it is not wanted;
- log a one-line report (scanned / suspended / skipped-why), like
  `describeReap`.

The page never pays for this: no timer in the UI, no sweep at bootstrap. The
existing `chrome.idle` listener is *not* the trigger (a tab is inactive whether
or not the person is at the keyboard); if we later want "only while idle", it
becomes a second guard, not the scheduler.

## 5. UI

- **A settings section.** A new `SuspendSettingsPanel` (presentational
  `SuspendSettingsView` + container, like `AiSettingsPanel`) added as a fourth
  tab in `SettingsDialog.tsx` (`SettingsTab` gains `'suspend'`): the on/off
  switch, the threshold (a `NumericInput` in minutes, with a plain-language
  echo: "suspend tabs left alone for more than 15 minutes"), and a sentence
  that a suspended tab reloads when opened again.
- **A per-tab whitelist toggle.** A small action on `TabCard` in the live
  tabverse list ("Keep this tab loaded"), visible only for live tabs, that adds
  or removes the tab's `Tab.id` from the tabverse's whitelist and re-publishes
  the session set. The card already owns a per-tab action row
  (`TabBookmarkBtn`), so this is a sibling, not a new surface.

## 6. Testing

- **`tabsToSuspend` is unit-tested as a table**: every skip rule in §1 is one
  case (active, pinned, audible, discarded, `autoDiscardable: false`, manager,
  whitelisted, unknown `lastAccessed`, exactly-at-threshold, just-under), plus
  the happy path and the empty list. Injected `now`, no browser.
- **`suspendSettings`** tested through an injected storage area, exactly like
  `src/ai/__tests__/aiSettings.test.ts`: absent reads as off/15, write is
  optimistic, a storage failure does not throw.
- **The whitelist resolver** (tab ids -> live `chromeTabId`s) tested as a pure
  function over a fake `$tabSpace`.
- **The sweep** tested with an injected tab list and a fake `discard`, so the
  "no-op when off" and "never throws" rules are both asserted.
- `chromeMock` gains `tabs.discard` (and `lastAccessed` on its tab shape) if the
  worker path is exercised in a test; the pure-function tests need neither.
- No headless browser: the panel is checked by `renderToStaticMarkup` like the
  other settings views (`adr/0018`).

## 7. What changes

| File | Change |
| --- | --- |
| `src/data/tabSpace/suspendSettings.ts` | new: enabled + threshold, injected storage |
| `src/data/tabSpace/suspendWhitelist.ts` | new: durable map + session publish/read |
| `src/data/tabSpace/suspendWhitelistMonitor.ts` | new: page-only publish on tab/store change |
| `src/data/tabSpace/suspender.ts` | new: `tabsToSuspend` + the worker sweep |
| `src/background.ts` | new alarm, wired like `startPreviewReaper` |
| `src/ui/dialog/SuspendSettingsPanel.tsx` (+ `.module.scss`) | new settings section |
| `src/ui/dialog/SettingsDialog.tsx` | add the `suspend` tab |
| `src/ui/manager/TabSpace/TabCard.tsx` | the whitelist action |
| `src/dev/chromeMock.ts` | `tabs.discard`, `lastAccessed` (test-only) |
| `src/data/tabSpace/__tests__/`, `src/ui/dialog/__tests__/` | new suites |

No change to `Tab`, `TabCore`, Dexie schema, `api/openapi.yaml`, the server, or
the sync layer. `Tab.suspended` already carries the result.

## 8. Open questions

1. **Default on or off?** Recommended off (§2). If on, pick a long default
   (60 min) so the first surprise is a gentle one.
2. **Scope: tabverse windows only, or every window?** Recommended tabverse
   windows (§1). Global is more useful and more surprising; it also has to
   decide what to do with a window that has no tabverse at all.
3. **Whitelist key.** Recommended our `Tab.id` + a session-resolved
   `chromeTabId` set. The durable URL alternative is in §3.
4. **Should pinned/audible be configurable skips**, or fixed? Recommended
   fixed, matching every other tab suspender's safe default.
5. **Split-view halves.** Confirm Chrome's behaviour when one half of a split is
   discarded; if it refuses, skip both halves.
6. **Visibility.** Should a whitelisted tab say so in the list (an icon), and
   should the tabverse show "N tabs suspended"? Recommended a subtle icon on the
   card, nothing global.
7. **Does the whitelist need to sync?** Recommended no - it is a per-device
   loading decision. If yes, it becomes a `TabCore` field and a wire change, and
   the plan's "no wire change" no longer holds.

## 9. Evidence (read, not assumed)

- `src/manifest.json`: `tabs`, `idle`, `alarms` already granted; no `history`.
- `chromeTabFields.ts:38-39` and `Tab.ts:14`: `suspended` is read from
  `discarded` and saved; nothing discards.
- `chromeUtil.ts:41`: the manager tab is pinned `autoDiscardable: false`.
- `Tab.ts:69` (`SavedTab` schema) and `TabCore` vs `LiveTab`: `SavedTab` has no
  Chrome tab id, so the worker cannot resolve one from the database.
- `previewReaper.ts` (`liveTabIds` injected) and `background.ts`
  (`startPreviewReaper`): the worker-alarm + pure-predicate pattern.
- `previewSession.ts`: `chrome.storage.session` for session-scoped values that
  survive a worker teardown.
- `aiSettings.ts` and `src/ai/__tests__/aiSettings.test.ts`: the device-setting
  module pattern (injected storage, absent-means-default).
- `@types/chrome`: `tabs.discard(tabId?)`, `Tab.lastAccessed`,
  `Tab.autoDiscardable`.
- `doc/tabverse-workona-gap-plan.md` §2-3: suspension rated **M**, first in the
  order, "no wire change; `suspended` is already a read of Chrome".
