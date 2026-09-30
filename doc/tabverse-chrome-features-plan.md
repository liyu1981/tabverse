# Plan: Chrome tab features (pinned, groups, split view) and auto-save

Status: draft for discussion (2026-09-28). Builds on
[ADR 0006](../adr/0006-window-ownership-and-dexie-4.md), which established that
a manager page owns exactly one window.

Three pieces of work, in the order they should land:

1. **capability gating** — a feature table plus a warning banner, so anything
   below can degrade on an older Chrome without breaking the baseline
2. **pinned tabs** — the badge and `pinned` on restore
3. **tab groups** — persist membership/name/colour, recreate on restore
4. **split view** — read the pairing, connect the two cards
5. **auto-save with an explicit `tvid`** — replaces the manual first save

---

## 0. Verified API facts (Chromium schemas + docs, fetched 2026-09-28)

| Fact | Value |
| --- | --- |
| `Tab.pinned` | plain `Tab` property, **no permission**, and present in `onUpdated.changeInfo.pinned` |
| `Tab.groupId` | Chrome 88+, **no permission**; `tabGroups.TAB_GROUP_ID_NONE = -1` |
| `chrome.tabGroups` | Chrome 89+ (query/get 90+), **requires the `tabGroups` permission**; colours are a fixed 9-value enum (`grey blue red yellow green pink purple cyan orange`) — custom user colours are not in the schema |
| `TabGroup.id` | "unique within a browser session" — **not durable, must never be synced** |
| `Tab.splitViewId` | read Chrome **140+**, `tabs.SPLIT_VIEW_ID_NONE = -1`, also in `onUpdated.changeInfo.splitViewId` |
| Split view writes | `tabs.createSplit([a, b])`, `tabs.create({splitWithTabId})`, `tabs.unsplit(id)` — Chrome **155+** |
| `createSplit` preconditions | the two tabs must be **adjacent**, not already split, and have **matching `windowId`, `pinned` and `groupId`** |
| Current stable | 155.0.8059.12; the dev machine is on 154, so **155 APIs are not yet available to us** |

Consequences that shape everything below:

- **Session-scoped ids cannot be synced.** Both group and split identity must be
  modelled as *our* ids, with a live `ourId → chromeId` map kept in memory only.
  This is the same rule the codebase already follows for `chromeTabId`
  (`TabSavePayload` is `TabCore`, deliberately without it).
- **Split view can be read but not written** on 154. So the plan is read-only
  for split until the floor moves, and the UI must not pretend otherwise.

## 1. Capability gating (foundation — do this first)

### 1.1 `src/capabilities.ts` (new)

A single table of optional features, each with a *detector function* rather
than a version check (the API surface is the honest signal, and it degrades
gracefully if Chrome ships a backport or a flag):

```ts
export interface Capability {
  id: string;
  title: string;          // shown in the banner
  requiresChrome: number; // for the message
  detect(): boolean;      // feature test, no version sniffing
  lost: string;           // one line: what the user does not get
}
```

| id | detect() | needs Chrome | what it costs when missing |
| --- | --- | --- | --- |
| `tabGroupRead` | `typeof chrome.tabGroups?.query === 'function'` (the permission is also needed for the *fields*, see 1.2) | 89 | no group badges, no group restore |
| `splitViewRead` | `'splitViewId' in tab \|\| chrome.tabs.SPLIT_VIEW_ID_NONE !== undefined` | 140 | split pairs shown as two separate tabs |
| `splitViewWrite` | `typeof chrome.tabs?.createSplit === 'function'` | 155 | cannot *create* a split pair (read still works) |
| `tabFrozen` | `Tab.frozen` present | 132 | no "frozen tab" hint (optional, cosmetic) |

`getMissingCapabilities()` returns the subset that failed, and a
`$capabilities` effector store so the UI re-renders when the page loads
(no runtime change expected — a reload is enough).

### 1.2 The `tabGroups` permission

`Tab.groupId` is readable with the permissions we already have, but the
group's **title and colour** need `"tabGroups"` in the manifest. Plan: add the
permission in the same commit as the group feature (not before), and check
whether it triggers a store warning/justification question at review time.

### 1.3 The banner

`<Callout intent={Intent.WARNING}>` in `TabSpaceListView` **above the tab
list** (the user asked for exactly this placement), rendered only when
`getMissingCapabilities()` is non-empty:

- collapsed line: `Some tab features are unavailable in this Chrome (N missing)`;
- click → `Popover` listing, per capability: title, `requires Chrome N`,
  `lost` sentence, and a "How to update Chrome" link;
- deliberately *not* dismissible: it describes the environment, not a task. But
  it must be quiet — one line, warning intent, no modal, and never in the way of
  the tab list.

### 1.4 The baseline rule (the important architectural part)

**Tab capture must never depend on an optional API.** Concretely, as a rule to
write into the code comments and enforce in review:

- `scanCurrentTabs` and the tab list read only `Tab` fields available since
  Chrome 1 (`id`, `url`, `title`, `favIconUrl`, `pinned`, `index`, `windowId`).
- Group/split/frozen data is an **enrichment pass** applied afterwards, each
  guarded by its capability check, each failing soft (wrapped, logged, skipped).
- If every optional capability is missing, the extension behaves exactly like
  0.5.x minus the badges. That is the definition of "basic capture is the base
  line".

This is why gating comes first: it creates the vocabulary (`Capability`,
`getMissingCapabilities`) that items 2–4 all use, and it makes the fallback a
property of the design rather than an afterthought.

### 1.5 Manifest

`minimum_chrome_version`: `116` → **`140`**. That is required to read
`splitViewId` at all. Cost: users below 140 cannot install. Given the store
already effectively requires a recent Chrome, and the dev machine is on 154,
this is the right trade — but it is a product decision, so it is called out
here rather than slipped in. Everything except split-view *reading* would work
at a lower floor, so if 140 is too aggressive, 132 (`Tab.frozen`) or even 89
(groups) are the alternatives, at the cost of dropping split view for now.

## 2. Pinned tabs

Cheap, because the model is already there.

- **Data**: nothing. `TabCore.pinned` exists (`src/data/tabSpace/Tab.ts:13`),
  `toTabCore` syncs it, `copyChromeTabFields` already copies
  `chromeTab.pinned` into it.
- **Badge**: in `TabCard.tsx`, render a `Tag intent={Intent.PRIMARY}` (or a
  `pin` icon) next to the title when `tab.pinned`. Live tabs and saved-tabverse
  previews both use `TabCard`, so one change covers both.
- **Restore**: `loadTabSpaceByTabSpaceId` (`tabSpace/util.ts:303-306`) creates
  every tab as `chrome.tabs.create({url})`. Pass `pinned: savedTab.pinned`.
  Note: pinned tabs are inserted into Chrome's pinned section, so pass an
  explicit `index` per tab (derived from the saved order) rather than relying on
  creation order.
- **Order**: `maintainTabOrder` walks `chrome.tabs.query({windowId})` in
  Chrome's own order and Chrome returns pinned tabs first, so the saved `tabIds`
  sequence already encodes the pinned/normal split. No change needed.
- Also worth a one-line cleanup while in `Tab.ts`: `suspended` is fed from
  `chromeTab.discarded` (`chromeTab.ts:42`) — `suspended` is not a Chrome field.
  Either rename it to `discarded` (it is synced) or drop it. Separate commit.

## 3. Tab groups

### 3.1 Model

The user's requirement: *remember which tabs belong to a group with what name
and colour, and recreate the group on restore*. Chrome's `groupId` cannot be
stored (session-scoped), so:

- **Durable (synced)**: a group list on the **tabspace record**:

  ```ts
  interface TabGroupHint {   // name TBD: TabverseTabGroup
    id: string;        // our own nanoid, stable across the sync
    title: string;
    color: 'grey'|'blue'|'red'|'yellow'|'green'|'pink'|'purple'|'cyan'|'orange';
    tabIds: string[];  // our tab ids, not chrome ids
  }
  ```

  `TabSpace.tabGroups?: TabGroupHint[]` — inside the tabspace record rather than
  a new synced entity, because (a) membership is meaningless without the
  tabverse, (b) the record already owns the ordered `tabIds` list, so this is one
  more ordered child, and (c) it stays LWW-atomic with the tab list instead of
  introducing a second record that can disagree with the first.
- **Live only (never synced)**: `ourId → chrome.tabGroups id`, rebuilt on every
  scan. Keep it in the tabspace's live (non-`TabCore`) part, next to
  `chromeTabId`, so it is dropped by `toTabCore` on the way to the server.
- `Tab` needs nothing new: group membership is derivable from the tabspace's
  `tabIds` lists. If a per-tab shortcut is wanted later, it is redundant state.

### 3.2 Capture

- Initial scan: after the baseline `scanCurrentTabs`, if `tabGroupRead`:
  `await chrome.tabGroups.query({windowId})` once, then map
  `Tab.groupId → TabGroup` for the window. One extra call per scan.
- Live updates:
  - `chrome.tabs.onUpdated` already delivers `changeInfo.groupId` (and the
    extension already listens for tab updates) — handled in the existing
    debounced path.
  - `chrome.tabGroups.onUpdated` (title/colour/collapsed) and
    `onCreated`/`onRemoved`/`onMoved` need **new listeners**; they carry the
    colour and title changes that `onUpdated` on a tab does not.
- Store the hint on the tabspace and let the existing debounced autosave carry
  it (item 5 makes that always-on).

### 3.3 Recreate on restore

`loadTabSpaceByTabSpaceId`, after the tabs exist:

1. create all tabs (with `pinned`/`index` from item 2),
2. for each group with ≥2 surviving tabs: `chrome.tabs.group({tabIds})` (no
   `groupId` → creates a new group) then
   `chrome.tabGroups.update(newGroupId, {color, title})`,
3. tabs whose group no longer exists simply stay ungrouped — soft failure, no
   error surface. A group with one surviving tab is skipped (Chrome deletes
   empty groups; a 1-tab group is noise).

Ordering matters: group **after** all tabs are created, because `tabs.group()`
takes tab ids that must already exist, and because `createSplit` (item 4) has
matching-`groupId` constraints.

### 3.4 UI

- `TabCard`: a thin coloured left border + the group title as a small header
  row above the first tab of a group (Blueprint `Tag minimal` with an inline
  `style={{color}}` from the 9-value palette).
- Restore path already covered; add `chrome.tabs.group/ungroup` to the
  selected-tabs toolbar (`SelectedTabTool`) as a later nicety — not in v1.

## 4. Split view

Deliberately **read-only** for now, because writes need Chrome 155 and the dev
machine is on 154.

- **Data (live only)**: add `splitViewId?: number` to the live `Tab`
  (not `TabCore` — session-scoped, same rule as `chromeTabId`).
- **Capture**: read `Tab.splitViewId` in `scanCurrentTabs` when `splitViewRead`;
  `onUpdated.changeInfo.splitViewId` (140+) covers changes. No extra API calls.
- **Sync**: store the *pair*, not the id, once writes are available: the
  durable form is `TabCore.splitWithTabId?: string` (our tab id) on one member
  of the pair. Until then there is nothing to sync.
- **UI**: when two adjacent cards share a `splitViewId`, render them inside one
  container with a shared left rule and a small `⫽ split` chip on both, so the
  pair reads as one unit. Purely presentational, ~30 lines in
  `TabSpaceListView`.
- **Writing (future, gated)**: expose "split these two tabs" only when
  `splitViewWrite` is detected; implement with `chrome.tabs.createSplit([a, b])`
  after moving them adjacent with `tabs.move`, and `tabs.unsplit(id)` for
  undo. Both must be added to the capability table and the banner, otherwise the
  button appears broken on 154.

## 5. Auto-save with an explicit `tvid`

### 5.1 The rule the user asked for

> if user has opened a tabverse tab, means he want to save current window's tabs
> into a tabverse, so we open tabverse tab, pin it, and auto save it … the
> tabverse id will be the one in `&tvid=`

Two of the three parts already exist:

- the manager tab **is already pinned** — `manager.tsx` ends its bootstrap with
  `chrome.tabs.update(tab.id, { pinned: true, autoDiscardable: false })`;
- autosave already exists, but only *after* the first manual save:
  `needAutoSave(ts) = !isIdNotSaved(ts.id)`, and `SaveIndicator` /
  `Auto Saving Off` in the toolbar show which mode you are in.

What is new is that the tabverse is **born saved**, with an id chosen by whoever
opened the tab.

### 5.2 Changes

- **Id in the URL**: every tabverse URL carries the id.
  `manager.html?op=new&tvid=<nanoid>` and
  `manager.html?op=loadsaved&tvid=<id>` (replaces `stsid`).
  One helper builds them, so the three call sites cannot drift:
  `tabverseUrl(op, tvid?)` in `data/tabSpace/chromeUtil.ts`. Call sites:
  `ui/popup.tsx` (new), `restoreSavedTabSpaceUtil` (new window),
  `loadToCurrentWindowUtil` (current window).
- **Bootstrap**: `tabSpaceBootstrap(chromeTabId, chromeWindowId, tvid)` sets the
  id at creation via `tabSpaceStoreApi.updateTabSpace({id: tvid, …})`.
  `IManagerQueryParams` gains `tvid?: string` and drops `stsid`.
  Missing `tvid` (a tab opened by an older build) → mint one at bootstrap. This
  is safe: `$tabSpace` is rebuilt from `newEmptyTabSpace()` on every page load,
  so an unsaved id was never durable anyway.
- **`needAutoSave()` disappears** (or becomes `true`): every tabverse is saved
  by construction. `saveCurrentTabSpaceIfNeeded()` stays and becomes plain
  "save now". `convertToSavedBase` no longer rewrites the id, so the
  `TabSpaceMsg.ChangeID` re-parenting branch in `saveCurrentTabSpaceImpl` dies
  with it.
- **UI**: the `Save` / `Auto` button and `SaveIndicator` become one status chip
  ("Auto-saved 3s ago"); the manual-save path and its styling go away. No new
  affordance is added — opening the tab *is* the consent.
- **First save is immediate**, not debounced (`DEFAULT_SAVE_DEBOUNCE` is 1s):
  create the tabspace row on bootstrap so the record exists before the first
  tab event, otherwise a crash in the first second loses the tabverse.

### 5.3 Consequences that need a decision

1. **Child entities.** Today a note/todo/bookmark born inside a tabverse gets a
   `~`-prefixed id and stays local until manually saved, and `listLocalRecords`
   skips every `~` row. With the tabverse born saved, a saved tabverse would
   contain notes that never sync — the two halves of the model disagree.
   *Recommendation*: apply the same rule to everything owned by a tabverse —
   born saved, autosaved on the existing debounce. That is the "move away from
   manual save" the user asked for, applied consistently. The cost is a write
   per keystroke-ish, mitigated by the 1s debounce and by the outbox (which
   collapses per record).
2. **Sync/privacy posture.** Born-saved means a newly opened tabverse uploads to
   the server (as soon as it has ≥1 tab) without a per-tabverse click. ADR 0002
   §3 promised explicit consent before the first upload — that promise was about
   *pre-existing local data* at pairing time. ADR 0002 §3 has since been amended
   to an informed default instead (pre-existing data uploads when sync is set
   up, ticked by default, with the count shown and a box to untick), so this
   item is now consistent with the ADR; the disclosure text in
   `docs/privacy` and the store listing was updated with it. The "Upload local
   data" button keeps its meaning for later: data created while disconnected,
   or a retry.
3. **Orphan tabverses.** Opening and instantly closing a tabverse creates a
   saved, synced, empty tabverse. Mitigation options: (a) accept it, (b) only
   push once the tabverse has ≥1 tab (`listLocalRecords` already filters
   nothing like that today, but it is a one-line filter), (c) delay the first
   push by N seconds. (b) is cheap and I'd take it.
4. **Restore over an existing tabverse.** `loadTabSpaceByTabSpaceId` reuses the
   id and clears the window's other tabs; with `tvid` the "load into this
   window" and "restore into a new window" paths both carry the id explicitly,
   which is a small readability win over today's `stsid` + `willSendChromeMessage`
   flags.
5. **Pinned manager tab + restore ordering.** The manager tab is pinned (index
   0); restored pinned tabs land in the pinned section too. Pass explicit
   `index` values when recreating (see item 2) so the saved order is honoured
   regardless of where Chrome puts pinned tabs.

## 6. Phasing

| # | Change | Risk | Notes |
| - | ------ | ---- | ----- |
| 1 | `capabilities.ts` + banner + `minimum_chrome_version: 140` | low | foundation; no behaviour change on a modern Chrome |
| 2 | pinned badge + `pinned`/`index` on restore | low | model already carries it |
| 3 | `tvid` + auto-save (5.1–5.2) | **medium** | touches the id lifecycle, the save UI, and the sync filter; decide 5.3.1–5.3.3 first |
| 4 | tab groups: model, capture, restore, UI (3.x) | medium | needs the `tabGroups` permission; soft-fail everywhere |
| 5 | split view: read + paired UI (4.x) | low | read-only until Chrome 155 |
| 6 | child entities born saved (5.3.1) | medium | do it with 3, or right after |
| 7 | split view write path | blocked on Chrome 155 | capability-gated |

Item 3 before 4 is deliberate: groups ride on the autosave that 3 turns on for
good, and the restore path is only worth touching once.

## 7. Open questions

1. **Minimum Chrome version.** 140 is required only to *read* `splitViewId`.
   Is dropping users below 140 acceptable, or should the floor be 132 (`frozen`)
   or 89 (groups) and split view wait? The dev machine being on 154 argues for
   140; the store's own requirements should be checked before deciding.
2. **Group placement in the record.** Inside the tabspace payload (recommended)
   or a separate synced `tabgroup` entity? The former is atomic and small; the
   latter scales better if groups ever outlive a tabverse.
3. **Are child entities born saved too?** (5.3.1) This is the difference between
   a consistent model and a half-migrated one.
4. **Empty-but-saved tabverses**: upload or suppress? (5.3.3)
5. **Does the `tabGroups` permission need a store justification**, and does it
   show a user-facing permission warning? Needs a look at the actual store
   submission flow.
6. **Split view: read-only for now, or ship the write path behind the flag**
   and let 155 users have it first? (4, 7)
