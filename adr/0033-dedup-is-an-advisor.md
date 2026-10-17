# ADR 0033: duplicate tabs are an advisor, and the scan runs in the worker

Status: accepted (2026-10). Extension only. Follows the tab snapshot model
(`src/data/tabSpace/Tab.ts`, `adr/0006`), the pure-decision pattern of the
suspender and preview reaper (`src/data/tabSpace/suspender.ts`,
`previewReaper.ts`), the worker lifecycle in `src/background.ts`, and the
manager banner slot (`src/ui/manager/TabSpace/TabSpaceListView.tsx`). Plan:
[`doc/tabverse-dedup-advisor-plan.md`](../doc/tabverse-dedup-advisor-plan.md).

## Context

Two open tabs on the same page are the ordinary way a profile fills up, and the
extension already sees every tab. The obvious feature - close the duplicates -
is the wrong one to ship as a default: closing a tab is destructive and
irreversible, the person may be mid-task on one of the copies, and a rule that
guesses which copy matters will sometimes guess wrong. There is also a cost
question: comparing every open tab's URL is cheap in absolute terms but it is
not free, and doing it in the manager page would put it on the render path of
the view it is trying to help.

## Decision

**The worker watches; the manager asks; nothing is closed without a person.**

1. **Advisor, not a gate.** The scan only reads `chrome.tabs` and writes a
   report. It never closes, moves, pins or reloads a tab. The one action that
   closes anything is the notice's **Remove duplicates**, and even then the
   worker re-derives the ids from the live tabs before touching them
   (`planDedupApply`), so a report made minutes ago cannot close a tab that has
   since navigated, been pinned, started playing, or gone.

2. **The decision is a pure function.** `dedup.ts` - `duplicateKey`,
   `findDuplicateGroups`, `planDedupApply` - has no `chrome`, no clock and no
   storage, so every rule (the URL identity, the keeper's tie-breaks, the
   protected group, the re-validation) is one unit test with no browser. Only
   `dedupScan.ts` touches `chrome.*`, in the mould of `suspender.ts`.

3. **A duplicate is the same normalised URL in one window.** Scheme, host, path
   and query identify the page; the fragment is dropped and a trailing slash is
   normalised. Only windows that hold a tabverse are considered (the same remit
   the suspender uses); the manager tab itself is never a member; browser
   internals and files are never duplicates. Tracking parameters are kept in
   v1: a missed duplicate is better than a wrong one.

4. **The keeper is deterministic.** Active beats audible beats pinned beats
   newest `lastAccessed` beats lowest index, so two scans agree and a person can
   predict which copy survives. A group whose every extra copy is pinned or
   audible is reported **protected**, with the reason and no action.

5. **The scan runs in the worker, never on the render path.** Its own
   `chrome.alarms` alarm (period from a setting), a scan once per browser run,
   and a **debounced** scan on tab events - the event handler only schedules, it
   never scans inline. The manager requests the report on mount and subscribes
   to a push; it never lists tabs or compares URLs.

6. **Coming back is a request.** Opening (or focusing) the manager asks the
   worker for the report and gets the stored one immediately; a fresh scan
   follows when the report is stale. The worker also pushes a new report when a
   scan changes it.

7. **Ignore is two things.** *Ignore* dismisses the current set by fingerprint
   (remembered locally for 7 days, invalidated when the set changes); *Always
   ignore this URL* is a permanent key in the device settings. A URL on the
   ignore list is filtered out at scan time, so "Always ignore" cannot be
   undone by the next pass.

8. **The report is session-scoped.** It names `chromeTabId`s, which are scoped
   to a browser run and recycled, so it lives in `chrome.storage.session` and
   dies with the run. The switch, the interval, the ignore list and the
   dismissals are device settings in `chrome.storage.local`. Nothing is synced
   and nothing is sent to the server (`adr/0002`).

9. **The advisor is on by default.** Unlike suspension it changes no browser
   behaviour; a notice a person can ignore is not worth hiding behind a switch.
   `Tabs → Duplicates` in the settings dialog turns it off and sets the
   interval.

## Consequences

- Nothing the person does waits on the advisor: scans are in the worker, debounced,
  and off the render path.
- A duplicate is surfaced where it is actionable - the tab list of the window it
  is about - and can be dismissed or permanently ignored without a dialog.
- An apply is undoable: the last apply's tabs are recorded and can be reopened.
- The pure core is the whole policy, so the feature is testable without a
  browser, and a future cross-window or tracking-parameter rule is a change to
  one function.
- The feature is local-only and adds no permission; `tabs`, `alarms` and
  `storage` are already granted.
