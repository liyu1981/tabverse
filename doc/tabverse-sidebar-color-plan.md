# Plan: a customizable sidebar colour

Status: proposed. Depends on nothing; the surface it paints already exists.

## 0. The feature

Three asks:

1. The left sidebar's background colour is the person's to choose, from a
   **fixed palette of dark colours** - everything drawn on the rail is a white
   or near-white glyph, so a light choice would erase the icons.
2. The rail's background is not the only thing painted that colour: the
   **inverse-corner cutouts** - the `.edge::before` / `.edge::after` pseudo
   elements on the active entry - are painted the same slate today, and they
   have to follow it, or the active card grows two mismatched wedges.
3. The colour is chosen in **Settings**, and a new tabverse can be given a
   **random** one at creation.

## 1. Where we are

The rail is one surface, and its colour is a Sass constant today:

- `src/ui/common/SidebarContainer.module.scss:30` - `.leftContainer`
  `background-color: global.$color-main-brand`.
- `src/ui/manager/Sidebar/Sidebar.module.scss:25,36` -
  `.sidebarComponent .edge::before` / `::after`, same constant. The `.edge` is
  rendered only when the row is **active** and the sidebar is **expanded**
  (`Sidebar.tsx`: `!collapsed ? <div className={classes.edge}>`), which is the
  "when expanded" in the ask.
- `src/ui/manager/BottomNav/BottomNav.module.scss:13` - the bottom bar is the
  rail's darker shade, `color.adjust(global.$color-d, -5%) !important`.
- `src/global.scss:35` - `$sidebar-background-color: $color-main-brand;` is
  already declared and **used nowhere**. This is that hook, finally used.
- `src/global.scss:23` - `$color-on-brand` (`#f4f6fb`) is the text/glyph colour
  for anything on the rail; every palette colour has to keep it legible.

Everything else that reads `$color-main-brand` (focus outlines, the right-hand
panel header, todo shadows, about-panel marks) is an **accent**, not the rail,
and stays as it is.

## 2. The shape

**The colour is an attribute of the tabverse.** That is what makes "random when
you create a new tabverse" mean something: each tabverse keeps its own look, the
rail shows the look of the tabverse the window is in, and switching to another
window's tabverse (whose entry is already in the rail) repaints it.

- `TabSpace` (`src/data/tabSpace/TabSpace.ts:65`) gains `color?: string`, a hex
  from the palette. Persisted in `TabSpaceSavePayload` (`:73`) and copied in
  `convertAndGetTabSpaceSavePayload` (`:345`), so it syncs like `name` does. The
  server treats a tabspace payload as opaque JSON (`tabspaceSummaryOf` only
  reads `name`/`tabGroups`), so no server change is needed.
- `newEmptyTabSpace` (`:82`) seeds the default; `fromSavedDataWithoutTabs`
  (`:124`) lets a saved row override it.
- A device preference - **whether a new tabverse rolls a random colour** - is
  not tabverse data, so it lives in `chrome.storage.local` next to the
  suspension settings (`src/data/tabSpace/suspendSettings.ts` is the pattern).

**The palette is a module, not literals in a component.**
`src/data/tabSpace/sidebarColor.ts`:

- `SIDEBAR_COLORS: { hex: string; name: string }[]` - eight dark choices, the
  first being today's slate `#54617a`.
- `DEFAULT_SIDEBAR_COLOR` (that slate), `isSidebarColor(v)`,
  `resolveSidebarColor(v)` (invalid or absent -> default - the value can arrive
  from the server, so it is validated), `randomSidebarColor()`.
- A test asserts **every** palette colour clears WCAG AA (4.5:1) against
  `$color-on-brand`. That is ask 1 as a check, not a comment.

## 3. Painting the surface

One custom property, published where the rail is:

- `SidebarContainer.tsx:48` reads the current tabverse's colour
  (`useStore($tabSpace)`) and sets
  `style={{ '--sidebar-color': resolveSidebarColor(color) }}` on
  `.topContainer`.
- The three rail-coloured rules switch to
  `var(--sidebar-color, #{$sidebar-background-color})`:
  `SidebarContainer.module.scss:30`, `Sidebar.module.scss:25,36`, and the
  bottom bar `BottomNav.module.scss:13` becomes
  `color-mix(in srgb, var(--sidebar-color, …), black 8%)` (Chrome 111+; the
  extension already requires 140).
- The `.edge`'s own gradient (`Sidebar.module.scss:18`, from the light card to
  the content colour) is **not** the rail colour and does not change. Only the
  two cutouts do - that is ask 2 exactly.

No other rule changes: `$color-main-brand` keeps every accent, and
`$color-on-brand` keeps the rail text legible on any palette entry.

## 4. Settings

A new **Look** tab in the one settings dialog:

- `SettingsDialog.tsx:16` - add `'look'` to `SettingsTab`, and a `<Tab id="look">`
  beside Sync / Tabs / AI / About (icon `tint`).
- `src/ui/dialog/AppearanceSettingsPanel.tsx` + `.module.scss`, following
  `SuspendSettingsPanel.tsx`: a presentational `AppearanceSettingsView`
  (static-testable, the repo's rule for anything Blueprint) and a container
  that:
  - reads the current colour from `$tabSpace` and the random switch from the
    device setting (`useSyncExternalStore`), and
  - on a swatch click writes `tabSpaceStoreApi.updateTabSpace({ color })` and
    `saveCurrentTabSpace()`; on a switch toggle writes the device setting.
- The panel says, in one sentence, that the colour belongs to **this tabverse**
  and follows it between windows.

## 5. Creating a new tabverse

A tabverse is created when a manager page is opened with no `tvid`:
`src/ui/manager.tsx:57` mints one (`queryParams.tvid || getNewId()`), and
`tabverseUrl` (`src/data/tabSpace/chromeUtil.ts:17`) mints one for the opener
(`PopupView.tsx:178,184`). Nothing else needs to know about colour:

1. In `manager.tsx`, when `queryParams.tvid` is absent (a real create), read the
   device switch once; `color = random ? randomSidebarColor() : currentOrDefault`.
2. `tabSpaceStoreApi.updateTabSpace({ color })` **before** `tabSpaceBootstrap`
   (bootstrap merges, so it will not overwrite it), so the immediate first save
   already carries it.
3. Write it into the url (`history.replaceState`, `color=…`) for the same reason
   `tvid` is in the url: a reload rebuilds the in-memory tabverse, and without
   the parameter the rolled colour would not survive it.
4. On any load, `queryParams.color` (validated) seeds `updateTabSpace`; for
   `op=loadsaved` (`manager.tsx:59`) the saved record wins, which is the colour
   that tabverse already had.

Small decision: with the switch **off**, a new tabverse gets the **default**
slate, not the colour of the tabverse being left - a new window should not
silently inherit, and "the colour you last saw" is a harder promise to keep
once creation moves to the popup.

## 6. Files

| File | Change |
| --- | --- |
| `src/data/tabSpace/sidebarColor.ts` | new: palette, default, validate, random |
| `src/data/tabSpace/sidebarColorSettings.ts` | new: the random-on-create device switch |
| `src/data/tabSpace/TabSpace.ts` | `color` on `TabSpaceCore` / `TabSpaceSavePayload`, seed, copy, payload |
| `src/ui/common/SidebarContainer.tsx` | publish `--sidebar-color` |
| `src/ui/common/SidebarContainer.module.scss` | rail background -> `var(--sidebar-color, …)` |
| `src/ui/manager/Sidebar/Sidebar.module.scss` | the two `.edge` cutouts -> the var |
| `src/ui/manager/BottomNav/BottomNav.module.scss` | bottom bar -> `color-mix` of the var |
| `src/ui/dialog/SettingsDialog.tsx` | the Look tab |
| `src/ui/dialog/AppearanceSettingsPanel.tsx` + `.module.scss` | new panel |
| `src/ui/manager.tsx` | mint/seed the colour on create, put it in the url |

`src/global.scss:35` (`$sidebar-background-color`) becomes the CSS fallback
instead of dead code.

## 7. Tests

- `sidebarColor.test.ts` - validation, the default, randomness is in the
  palette, and the **contrast** of every entry against `$color-on-brand`.
- `TabSpace` tests - `color` survives `convertAndGetTabSpaceSavePayload` and
  `fromSavedDataWithoutTabs`; absent on an old row is the default.
- `sidebarColorSettings.test.ts` - the absent-means-off, `null`-is-not-`false`
  shape `suspendSettings` uses.
- `AppearanceSettingsPanel.test.tsx` - `renderToStaticMarkup` of the view: every
  swatch renders, the chosen one is `aria-pressed`, the switch reflects the
  device preference.
- A sidebar render test that the rail carries the resolved colour in its style.
- Manual (the person, not a headless browser): switch tabverses and watch the
  rail and the active card's cutouts move together.

## 8. Open questions

1. **Per-tabverse or one global look?** This plan does per-tabverse, because
   "random when you create a new tabverse" only means something then. If the
   intent is a single app-wide colour, the `TabSpace`/payload work drops out and
   only a device setting remains.
2. **The Look tab's home** - a new tab, or a section of Tabs/About? A tab, here,
   because the swatches want the width and the topic is not tabs or the build.
3. **Arbitrary hex?** Not here: a fixed palette is what "the colours we offered"
   implies, and it is what the contrast check can enforce.

## 9. Not in this increment

- A colour dot on each `OtherTabSpaces` row (the data is there after step 2; it
  is a second surface design).
- The server admin view showing a tabverse's colour.
- Per-device overrides of a tabverse's colour (the colour is the tabverse's, and
  it syncs - one look everywhere).
