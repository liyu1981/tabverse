# ADR 0003: build and toolchain

Status: accepted (2026-09)

## Context

The extension was built with webpack 5 + ts-loader + a pile of shell scripts
(`copycss.sh`, `develop.sh`, `build.sh`) that symlinked `dist/assets` around,
Jest 28 for tests, an `.eslintrc`-style ESLint 8 configuration, Prettier 2 and
TypeScript 4.7. `dist/` was partly committed to git as if it were source.

Goals: one modern, boring toolchain; the sync layer from ADR 0001 landed on
top of it; CI that actually runs.

## Decisions

**Bundler: Vite 8 (Rolldown) with a hand written config**, not
`@crxjs/vite-plugin` and not WXT. The config is ~90 lines and does three
things a extension build needs: four HTML inputs (popup/manager always,
`icon`/`devdata` only in development builds so dev tools never ship), a
`background.ts` entry with `entryFileNames: background.js`, and a plugin that
emits `dist/manifest.json` with the version taken from `package.json`.
Hand written over a plugin because the output is predictable without a
browser to verify against. Build time went from 32 s to 1.7 s.

**Service worker: `type: "module"`.** Rolldown code-splits shared modules, so
`background.js` imports its siblings as ESM. The old `backgroundWrapper.js`
`importScripts` shim is deleted.

**`dist/` is fully generated** and gitignored; static assets live in `public/`
(previously `dist/icons`, `dist/_locales`), the manifest source moved to
`src/manifest.json`.

**Framework: React 18, not 19.** Blueprint 6 supports both, but
`effector-react@22` peers `<19` and `draft-js` (archived, not yet replaced)
has never been tested against 19 — 18 removes every legacy `ReactDOM.render`
path while keeping those two working. Upgrading to 19 is a one-line change
later.

**Blueprint 4 → 6.** Includes: `.bp4-` → `.bp6-` class prefixes in SCSS,
`Popover2`/`Tooltip2` → core `Popover`/`Tooltip` (the `@blueprintjs/popover2`
dependency is gone), `<Toaster>` → `OverlayToaster.create()` (async, so the
manager context now hands out a silent fallback toaster until it resolves),
`EditableText` lost `children` (value is the source of truth), and
`IElementRefProps` was removed (our two Tag-derived components declare their
own `elementRef` prop).

**Tests: Vitest 5** replacing Jest 28 — same 37 suites, no test rewrites
beyond `jest.fn` → `vi.fn`, plus `resolve.alias` swapping `src/storage/db.ts`'s
`./dbImpl` for the fake-indexeddb implementation. `storage/db.ts` lost its
last `require()` calls (ESM static imports).

**Lint/format: ESLint 10 flat config (`eslint.config.mjs`)** with
`typescript-eslint` 8, `eslint-plugin-react-hooks` (new: `rules-of-hooks` is an
error — it caught two real HOC naming violations) and
`eslint-plugin-unused-imports`; `eslint-plugin-react` was dropped because it
does not support ESLint 10 and TypeScript covers what it added. Formatting
was owned by Prettier 3, and is now owned by **Biome 2** (see the note at the
end of this ADR); `eslint-config-prettier` stays either way, because turning
off ESLint's stylistic rules is what keeps the two from fighting.

**TypeScript 5.9** with `moduleResolution: "bundler"`,
`customConditions: ["browser"]` (package `exports` maps, same condition Vite
uses) and `isolatedModules`. `strict` is still off — turning it on is a
separate, large change.

**Dependencies removed:** `moment` (→ a tested 60-line `src/time.ts` over
date-fns), `react-json-view` (dev page renders `JSON.stringify`),
`@blueprintjs/popover2`, `natural`, `@babel/*`, all of webpack, Jest/ts-jest,
`eslint-plugin-prettier`, `react-devtools`.
`crypto-js` stays: it is the only MD5 implementation for the Dropbox
checksum comparison.

### Later amendment: Prettier 3 -> Biome 2

Prettier is replaced by **Biome 2.5** for formatting, keeping ESLint 10 for
linting. The reasons:

- **One tool instead of two.** Biome reads `.gitignore`, so the old
  `.prettierignore` disappears, and `format:check` / `format:write` become
  `biome format` (check by default, `--write` to fix).
- **Negligible diff.** Biome aims for Prettier compatibility: of 189 files,
  187 were already conformant and only 2 changed (a binary expression inside a
  `Boolean(...)` call, and a long `extends` clause in a Blueprint props
  interface). Nothing in the diff was a hand-written decision.
- **Speed.** 189 files in ~30 ms, against a multi-second Prettier run; this is
  a real difference on `format:check`, which CI runs on every change.

`biome.json` mirrors the old `.prettierrc.json` (2-space indent, width 80,
single quotes, semicolons, `trailingComma: all`, `arrowParens: always`) and
adds the ignore list that used to live in `.prettierignore`. Two deliberate
settings: `organizeImports` is **off** (the repo does not enforce import order
and a mass reorder would be noise), and the linter is **disabled** (ESLint
still owns linting, including the strict TypeScript subset and react-hooks).

## Consequences

- One command each: `npm run develop` (watch), `npm run build`, `npm test`,
  `npm run build-crx`; CI gates typecheck + format + lint + tests + build.
- `no-useless-assignment` (new in ESLint 10) is disabled pending a manual
  dead-store cleanup — 12 sites, needs review, no runtime tests to lean on.
- Still deferred: draft-js replacement, React 19, `strict` mode, deleting the
  leader-election machinery (`broadcast-channel`).
