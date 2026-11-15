# Plan: auto grouping (suggest a grouping plan, let a person edit it, then apply)

Status: **plan** (2026-11). Extension only. Follows the pure-decision pattern of
the suspender (`src/data/tabSpace/suspender.ts`) and the duplicate advisor
(`src/data/tabSpace/dedup.ts`, `adr/0033`), the tab-group model of `adr/0022`
(`src/data/tabSpace/tabGroup.ts`), the on-device AI plumbing of
`src/ai/naming.ts` (plan D9/D11) and the manager header's actions
(`src/ui/manager/TabSpace/TabSpaceListView.tsx`).

## 0. What is being asked

A button in the tabverse header that:

1. **scans the window's tabs and the groups they are already in**;
2. **presents a grouping plan** - "these 4 github tabs become Github", "these 3
   figma tabs join the Work group" - in a dialog;
3. lets the person **apply it, drop parts of it, or change a bit** (rename a
   group, recolour it, leave a tab out) before anything is executed;
4. and, when the device's on-device AI is switched on, also offers an
   **AI-suggested plan** (by topic, not just by site) alongside the
   deterministic one.

Nothing is grouped until **Apply**. Tabverse still invents no group of its own.

## 1. Where we are (grounded)

- **Grouping is already modelled.** `TabGroupHint` (our stable group id, title,
  the nine Chrome colours, and our tab ids) rides in the tabverse record;
  `captureTabGroups` rebuilds it from `chrome.tabGroups`, and
  `restoreTabGroups` recreates groups after a restore
  (`src/data/tabSpace/tabGroup.ts`). The live our-id -> chrome-id map is module
  state there (`chromeGroupToOurId`).
- **The write path exists in Chrome and in the manifest.** `chrome.tabs.group`
  (88+), `chrome.tabs.ungroup` (88+) and `chrome.tabGroups.update` (89+) need
  only the `tabs` and `tabGroups` permissions the extension already holds;
  `hasCapability('tabGroups')` is the feature test, and the floor is Chrome 140.
  No manifest, permission or schema change.
- **The window is already in memory.** The manager page holds the window's tabs
  (`$tabSpace.tabs`, with live `chromeTabId`) and its groups
  (`$tabSpace.tabGroups`), so the scan needs no worker and no `chrome.tabs`
  round trip: unlike the duplicate advisor, which must answer on tab events with
  no page open, this is an **on-demand, page-only** feature.
- **Applying changes Chrome's tab strip.** Grouping non-adjacent tabs makes
  Chrome move them together, so `onMoved` fires; `tabs.group`/`tabGroups.update`
  fire `tabGroups.onCreated/onUpdated`. The page's existing monitors
  (`startMonitorTabChanges`, `startMonitorTabGroups`) already re-read order and
  hints - this feature just forces one re-read after applying, rather than
  waiting for the events, so the list is right before the toast says so.
- **The on-device AI has one shape.** `src/ai/session.ts` caches one session per
  system prompt and logs every exchange (`promptLog.ts`); `aiSettings.ts` holds
  the per-device on/off (`null` = not read yet); `availability.ts` holds the
  browser's answer (`ready`, `downloadable`, ...); `naming.ts` shows how a
  feature builds a prompt, passes a `responseConstraint` schema, and parses a
  defensive reply. Titles are attacker-controlled, so they are sanitised to one
  line before they become a prompt line.

## 2. The rules (deterministic planner, by site)

**Candidates** are this window's tabs that are:

- live (`chromeTabId > 0`) and **not already in a group** (a plan never moves a
  tab out of a group it is in);
- **not pinned** (Chrome forbids a group mixing pinned and unpinned tabs);
- **http(s)** (`siteKeyOf` returns null otherwise: `chrome://`, `file://`,
  `chrome-extension://` and the manager tab itself are not "sites").

**The site key** is the registrable domain: lower-cased host, `www.` dropped,
the last two labels - or three for a small table of multi-label suffixes
(`co.uk`, `com.au`, `github.io`, `pages.dev`, ...). IP hosts are their own key.
`siteLabelOf` turns `github.com` into `Github` for a group title the person can
edit.

**A suggestion is one group:**

- `create`: two or more candidates share a site key that no existing group
  already owns. Title = `siteLabelOf(key)`, colour = a colour no existing group
  uses when one is free (hash of the key decides where the walk starts, so two
  scans agree).
- `extend`: an existing group's tabs are dominated by one site key, and one or
  more *ungrouped* candidates have that key. The suggestion adds only those
  candidates to that group, with the group's own title and colour. Nothing is
  ever proposed *out* of a group, and two groups are never merged.

Singletons are reported as skipped, not suggested (a group of one is not a
group). At most `AUTO_GROUP_MAX_GROUPS` (12) suggestions, sorted by how many
tabs they cover, then by key.

## 3. The rules (AI planner)

Only offered when the on-device AI is switched on (`getAiEnabled() === true`);
without it the dialog has no AI control at all. The same candidate set is sent -
never a tab that is already grouped, pinned or not a web page - numbered:

```
#1 Title — github.com
#2 Title — figma.com
Existing groups (leave these out): "Work": figma.com; "Docs": developer.mozilla.org
```

The reply is constrained to JSON
(`{"groups":[{"title","color","tabIds":[1,2]}]}`) and then **validated as
data**: an unknown index, a tab claimed twice, a group with fewer than two
tabs, an empty or overlong title, and a colour that is not one of the nine are
all handled here - the model gets no authority over what is grouped, only an
opinion about it. Proposals become ordinary `create` suggestions, so the dialog
and the apply path are the same for both planners.

The AI is a fallback, never a requirement: if the model is absent, downloading,
busy or answers nonsense, the dialog keeps (or returns to) the deterministic
plan and says one line about it. Nothing is applied without Apply either way.

## 4. The shapes

```ts
// data/tabSpace/autoGroup.ts - no chrome, no DOM
type AutoGroupSuggestion = {
  id: string;                 // 'create:<key>' | 'extend:<our group id>'
  kind: 'create' | 'extend';
  groupId?: string;           // our group id, for extend
  key: string;                // the site key the plan came from
  title: string;
  color: TabGroupColor;
  tabs: { tabId, chromeTabId, title, url }[];
};
type AutoGroupPlan = { suggestions: AutoGroupSuggestion[]; skipped: {...} };

// The dialog edits one row per suggestion; Apply turns the rows into choices
type AutoGroupChoice = {
  kind: 'create' | 'extend';  groupId?: string;
  key?: string;               // kept for the re-validation below
  title: string;  color: TabGroupColor;  tabIds: string[];
};
```

`planAutoGroupApply` (pure) re-derives the plan against the **live** tabs the
moment Apply is pressed, exactly like `planDedupApply`: a tab that is gone is
dropped, a site-based choice drops tabs whose url no longer has that site key,
and a group that falls under two tabs is dropped. A stale dialog therefore
cannot group the wrong tab.

## 5. The UI

The header gains one button (`Group tabs`), next to the AI menu, enabled when
there are at least two candidates and `hasCapability('tabGroups')`.

The dialog (`AutoGroupDialog`) is a Blueprint `Dialog` whose body is a separate,
presentational component (`AutoGroupBody`) so its states can be checked by what
they render (ADR 0018):

- a **card** per suggestion, not a collapsed row: the tabs it would group are
  the point of the suggestion, so the list is **always expanded**. The card
  borrows the group vocabulary of the tab list - a rule down the left in the
  group's colour, the same colour tinting the header - so a suggestion already
  looks like the group it would become. Its header has the checkbox, the colour
  swatch (the nine Chrome colours), the editable title, the "3 of 4 tabs" count
  and the "adds to the existing group" tag; its body is one row per tab with a
  checkbox to leave it out, the favicon, the title and the short url. A long
  group scrolls inside its card rather than pushing the next one away;
- a footnote with what was left out and why (pinned, already grouped, single
  tabs, not a web page);
- when AI is on: a `By site` / `AI` switch and, under AI, the model's state
  (`Asking the on-device model…`, `Installing the model 42%…`, an error line
  with Retry);
- `Cancel` and `Apply` - `Apply` is disabled when nothing is selected, and a row
  whose edits leave fewer than two tabs says so instead of being applied.

On Apply: the choices are validated, applied in order (`tabs.group` then
`tabGroups.update` for the title/colour), the window is re-read once
(order + groups) and saved, the dialog closes and a toast says what happened
("Grouped 12 tabs into 3 groups", with skipped/failed counts when non-zero).

## 6. Failure modes

- **No `chrome.tabGroups`**: the button is not drawn; `CapabilityWarning` already
  explains why in the list.
- **The map from our group id to Chrome's is gone** (the group was removed
  since the scan): an `extend` falls back to creating a new group rather than
  failing.
- **A tab is closed between the dialog opening and Apply**: dropped by the
  re-validation; the counts in the toast say so.
- **A `tabs.group` call throws** (the tab went away, Chrome refused): that group
  is counted as failed, the rest still apply.
- **The AI replies with prose or nonsense**: no suggestions from it, one line in
  the dialog, the deterministic plan is one click away.

## 7. Out of scope (v1)

- **Undo.** If one is added it belongs next to the duplicate advisor's: remember
  the created chrome group ids and `tabs.ungroup` them. Chrome's own "Ungroup"
  is the escape hatch today.
- **Background suggestions.** No advisor notice, no worker scan: this is a
  button, not a nag.
- **Moving tabs between groups, merging groups, reordering the strip.** The
  plan only creates and extends.
- **Learning preferences** (per-site group names, "always group this site").
  There is no settings surface for it yet, and a wrong memory is worse than
  asking.

## 8. Tests

- `autoGroup.test.ts`: site keys (suffixes, `www`, IPs, non-http), candidate
  filtering (pinned, grouped, manager tab), create vs extend, the colour draw
  (never one in use, distinct inside a plan, random across scans), caps and
  ordering, AI-proposal validation (unknown/duplicate ids, short groups, bad
  colours/titles), and the apply re-validation (gone tab, changed site, group
  under two).
- `ai/grouping.test.ts`: prompt budget and one-line sanitising, the JSON parser
  (fenced, aliases, prose), and the session glue with an injected session.
- `autoGroupChrome.test.ts`: create vs extend against a fake API, the fallback
  when an extend's chrome group id is missing, per-group failure accounting.
- `AutoGroupDialog.test.tsx`: the static markup for the empty, site-plan,
  AI-plan and left-out states (no jsdom, ADR 0019).
- `pnpm run i18n:check` for the new strings.
