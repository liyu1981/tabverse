# ADR 0019: the tabverse view is shared, one component at a time

Status: accepted (2026-10)

Follows [ADR 0018](0018-console-is-a-vite-app.md), which made the console a
Vite/React app. Extends [ADR 0015](0015-delete-a-tabverse-from-the-console.md),
which is why the shared view has no buttons in it.

## Context

The console's tabverse drawer is meant to show a tabverse the way the extension
shows one: the same "Working on 7 tabs in 2 groups", the same tab cards, the same
tab groups. `adr/0009` wrote that intent down when the drawer was built, and the
drawer did what it could with no framework to share - it transcribed the line,
redrew the cards, and put a flat uppercase heading where the extension puts a
coloured group block. Everything drifted together for a while, which is the
normal way: two implementations of one sentence.

`adr/0018` changed what reuse costs. The console is a React app that already
ships React, Blueprint and the icon paths, so the extension's components are
nearly free to draw: measured against the console as `adr/0018` left it, adding
`TabCard`, `TabGroupBlock`, `SplitBlock` and `tabverseEntries` costs **+48 kB
gzipped** and **0.03 kB of CSS** (both hosts already load `blueprint.css`, and the
extension's `*.module.scss` files compile into the console's build as their own
modules). Adding the whole `SavedTabSpaceDetail` view costs +82 kB gzipped, and
the extra 34 kB is Dexie: the view imports `deleteSavedTabSpace`, which reaches
`storage/db`, whose `export const db = dbImpl` opens a database handle at module
scope - in an operator's browser, on the console's origin, for a console that
must never write a record.

Three things in the extension also stood in the way, all of them found by trying
rather than by reading:

1. **`src/global.ts` threw while evaluating, on any ordinary web page.** The
   manager page's URL prefix read `globalThis.chrome ? chrome-extension://${chrome.runtime.id}/…`.
   `window.chrome` is truthy in Chrome on every page; only `chrome.runtime` is
   extension-only. So importing anything that reaches `global` - which is every
   path to `TabCard`, through `chromeUtil` - raised a TypeError at import and
   blanked the console. In the extension and in node the same line is harmless,
   which is why it survived.
2. **`TabCard`'s close button appeared on saved tabverses.** A saved tab carries
   `chromeTabId: -1` (`newEmptyTab`'s "no live tab"), and the guard was
   "is the field set" rather than "is it a real id", so `-1` passed and every
   card in the saved list offered "Close this tab" - a button that called
   `chrome.tabs.remove(-1)` and could never work. The console would have
   inherited it, and there it is a read-only view of somebody else's data.
3. **The summary line was inline JSX in the view**, so there was nothing to
   share: only the view, or a copy.

## Decision

**The console draws a tabverse with the extension's own leaves and the
extension's own entry builder. The view around them stays the console's.**

1. **Reuse `TabCard`, `TabGroupBlock`, `SplitBlock` and `tabverseEntries`.** The
   console maps the bundle to the `TabSpace` shape they expect and renders the
   entries exactly as `SavedTabSpaceDetail` does. Group colours come with
   `TabGroupBlock` (it maps `TabGroupColor` through `TAB_GROUP_COLORS_JS`), so
   the console's own `--group-*` tokens are deleted rather than kept as a second
   palette.

2. **Do not reuse `SavedTabSpaceDetail`, and do not extract it.** It is the
   *page* - a sticky action column with Load to New / Load to Current / Switch /
   Delete, all of which act on this browser - and making it host-agnostic means
   prop-drilling actions into it and dragging the Dexie import out of it. The
   drawer needs the tabs, not the page. If the tab list's container is ever
   worth sharing as well, that is the moment to extract it, with the same
   measurement first.

3. **The console keeps its own favicon for now.** `FavIcon` falls back to a
   `dummyimage.com` URL for a tab with no icon, which ADR 0016 removed from the
   preview path on the grounds that a tab's picture is the one thing that must
   never leave the machine. Reusing `TabCard` would have handed the console a
   third-party fetch, so the console passes a row it can render itself and will
   draw its own icon when it has one. (Which means today's reused card has no
   icon at all for such a tab - a known gap, and the reason the FavIcon fallback
   is a separate piece of work rather than a footnote.)

4. **The import-time chrome guard is fixed, and the close guard with it.** One
   line in `src/global.ts` (`chrome?.runtime?.id`) and one comparison in
   `TabCard` (`chromeTabId > 0`), both with tests. The first is a real
   robustness fix for any non-extension host; the second removes a dead button
   from the extension's own saved list, which is the user's to see.

5. **The summary line becomes `TabverseSummary`,** rendered by both pages. The
   wording is then one implementation, asserted once, and "the console shows
   what the extension shows" stops being a thing to keep an eye on.

## Consequences

- `server/ui` imports `src/ui`, so the server's console has a build-time source
  dependency on the extension's view code. Both are in one package and one
  lockfile; nothing about the Go side changes.
- Two prices, paid knowingly: chrome-typed modules (`global`, `chromeUtil`,
  `message`) end up in the console bundle as dead code, and the reused cards take
  their colours from the extension's compiled SCSS rather than from the
  console's custom properties. The values are the same numbers; the theming is
  no longer the console's to change.
- Split views cannot appear in the console: `splitViewId` is session-scoped and
  never synced (ADR 0016), so `SplitBlock` has nothing to draw there. It is
  imported anyway, because the day a tabverse records a split, both pages should
  show it.
- The console's own tabverse view model (`tabverseView.ts`) and the CSS that went
  with it are deleted. The one thing worth keeping from them - which tab belongs
  to which group - is `tabverseEntries`, and now there is one of it.
- Nothing here is verified by a browser. What the user should look at: the
  extension's saved tabverse list (no dead ✕, no remote icon) and the console's
  drawer beside it.