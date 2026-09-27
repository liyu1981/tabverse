# ADR 0004: staged strictness, React 19, draft-js removal

Status: accepted (2026-09)

## Context

Follow-up to ADR 0003. The remaining deferrals were: `strict` TypeScript,
React 19, the archived draft-js editor, dead stores flagged by ESLint 10, the
store disclosures, and "delete the leader election".

## Decisions

### TypeScript strictness is staged, not switched on

`--strict` produces **644 errors** across 211 files (`strictNullChecks` alone
428, `noImplicitAny` 227). Turning it on in one step would mean touching every
file with no way to verify behaviour in a browser.

Instead, the flags that are affordable are **enabled and clean today**:

```
alwaysStrict, strictBindCallApply, strictFunctionTypes, noImplicitThis,
noImplicitReturns, noImplicitOverride, noFallthroughCasesInSwitch,
noUncheckedIndexedAccess, useUnknownInCatchVariables
```

That is 28 real errors fixed, including one genuine bug: `store.ts` used
`this.queryCursors` inside an object literal whose `this` was implicitly
`any` — it meant `tabSpaceQuery.queryCursors`.

Remaining (`strictNullChecks`, `noImplicitAny`, `exactOptionalPropertyTypes`,
`strictPropertyInitialization`) is a separate pass; count the errors first
with `npx tsc --noEmit --strict`.

### React 19 (and effector 23)

The blocker was `effector-react@22` (peers `<19`). `effector` 23 +
`effector-react` 23 support React 19 and keep the APIs this codebase uses
(`createStore`, `createApi`, `forward`, `useStore`) — the upgrade produced
zero errors. React 19 itself needed 8 files touched: `useRef<T>()` →
`useRef<T | null>(null)`, `React.ReactFragment` → `React.ReactNode`,
`JSX.Element` → `React.JSX.Element`, `React.VFC` → `React.FC`, `override`
modifiers on the error boundary.

Blueprint 6 already supported React 19, so no UI change rode along.

### draft-js replaced by TipTap

draft-js is archived and React-17-era; it was the last thing standing between
the project and React 19.

- Storage format for `note.data` becomes **HTML** (TipTap's document).
- `src/ui/notebook/draftLegacy.ts` converts legacy draft-js raw JSON on read;
  the next save persists HTML. Covered by unit tests (styles, headings,
  quotes, lists, code, links, HTML escaping).
- `RichTextEditor.tsx` reproduces the old toolbar (H1-H3, quote, lists, code
  block / bold, italic, underline, mono, strike) on TipTap's StarterKit.
- `draft-js`, `@types/draft-js` and `Draft.css` are gone.

### Dead stores cleaned, the new ESLint rule stays on

All 12 `no-useless-assignment` findings were reviewed and removed, so the
rule that ships with ESLint 10 is enabled rather than suppressed.

### The tabSpaceRegistry leader election stays (corrected rationale)

The original plan said "the server replaces leader election". That was wrong:
the registry tracks **which tab spaces are open in this browser**, which the
server never sees (it only stores saved data). The registry is load-bearing
for the manager sidebar across multiple windows, and rewriting the election
protocol without a browser to verify it is an unacceptable risk.

What the server _did_ replace: cross-context data coordination
(`dexie-observable` broadcasts are now the change feed that feeds the sync
outbox, Dropbox dumps are obsolete). `broadcast-channel` therefore remains a
deliberate dependency of local presence tracking; re-evaluate when the
manager page becomes single-instance by construction.

### Store disclosures and privacy text written

`doc/chrome-webstore/listing.md` holds the single-purpose statement,
permission justifications and the dashboard answers; the privacy policy got
its "Optional server sync" section (the previous text claimed nothing ever
leaves the device, which is only true by default now).

## Consequences

- `npm run typecheck` gates the stricter subset in CI; a future pass can add
  flags one at a time.
- Note content written by TipTap is HTML: anything reading `note.data` must
  treat it as HTML (the localStorage export path does; equality checks are
  format agnostic).
- Remaining follow-ups: `strictNullChecks`/`noImplicitAny`, and a decision on
  the registry when sync learns about open tabs.
