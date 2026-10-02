# ADR 0018: the console is a Vite app, built and embedded

Status: accepted (2026-10)

Supersedes the "three embedded files, no framework, no build step" decision of
[ADR 0009](0009-multi-tenant-and-server-console.md) (decision 6). Everything
else in ADR 0009 - the admin token's role, the read-only-over-user-data rule,
the three-file URL space - stands.

## Context

The console grew into 2118 lines of hand written JavaScript and 1173 lines of
hand written CSS, in one file each, with a stub DOM built by hand so the script
could be run under `node`. It works, and it is the only UI in the repository
that is not React, which by now makes it the odd one out in three ways at once.

**It has no types.** Every response is an untyped `any` out of `fetch`, so a
renamed field is a runtime surprise rather than a compile error. The extension
has the opposite problem solved (`src/data/repo/types.ts` mirrors
`api/openapi.yaml` and `tsc` checks the client against it).

**It cannot use the components the product already has.** Blueprint 6 is a
dependency of this repository, and the console's CSS is a hand transcription of
the extension's palette into `:root` custom properties with the source named in
a comment. The transcription drifts: `Card`, `HTMLTable`, `Dialog`, `Toaster`,
`Tag` and `Tabs` are all free, and all reimplemented as `div` and a
`prompt()`.

**Its test strategy is the price of no build step.** `console.test.mjs` builds
a fake DOM out of the real `index.html` and asserts the script reaches the
sign-in view, because a missing function in a 2000-line vanilla script otherwise
sails through every other check and then blanks the page. That harness exists
only because there is no compiler to catch the mistake. It cannot assert
anything about a component, because a component needs a renderer, and
`AGENTS.md` forbids installing jsdom for this repository.

Meanwhile the extension side has exactly the tooling the console lacks: Vite,
React 19, effector, Blueprint, Sass modules, vitest, biome - all already in the
root `package.json` and the root lockfile.

## Decision

**The console becomes a Vite project at `server/ui`, built into
`server/internal/webui/dist` and embedded in the binary, with Blueprint as its
component base.**

1. **Same setup as the extension, one lockfile.** `server/ui` is a directory in
   the root package, not a package of its own: every dependency it needs
   (`react`, `react-dom`, `effector`, `@blueprintjs/core`,
   `@blueprintjs/icons`, `sass`, `@vitejs/plugin-react`, `vitest`) is already
   there. No new `package.json`, no second `pnpm-lock.yaml`, nothing new to
   install. It has its own `vite.config.mts` (base `/assets/`, `outDir`
   pointing into the Go package) so the extension's build is untouched.

2. **The build output is not committed.** `server/internal/webui/dist/` is
   generated and git-ignored, and every Go target runs `pnpm run ui:build`
   first (the `server:*` scripts in the root `package.json`, and the `server`
   job in CI, which installs the workspace before it builds Go). A tracked
   `.gitkeep` keeps the directory present so `go:embed` still compiles on a
   fresh clone. The cost of this choice is that a Go build without a UI build
   produces a binary whose console is a placeholder page - so
   `internal/webui` has a test that fails, with the command to run in the
   message, when the bundle is missing.

3. **Blueprint is the base, not an addition.** The page imports
   `normalize.css`, `blueprint.css` and `blueprint-icons.css` and is a
   Blueprint application: `Card`, `HTMLTable`, `Dialog`, `Toaster`, `Tag`,
   `Tabs`, `InputGroup`. Blueprint sets `body { font-family; color;
   line-height }` globally, which used to be the reason it could not be linked
   into a page with its own chrome; after the rewrite the whole page *is* the
   Blueprint app, so that global is the intent rather than a collision. What
   survives from the hand written stylesheet is the product's own layer: the
   palette tokens (`server/ui/tokens.scss`, transcribed from
   `src/global.scss` as before), the brand bar, the account rail, the
   read-only bar, the tabverse rows and the drawer.

4. **State is effector, like the extension.** `server/ui/data/stores/` holds
   `createStore` + `createApi` units and `createEffect`s for the calls, and the
   views read them with `useUnit`. The reason is not novelty: the console's
   state is a handful of interdependent screens (session, selected account,
   which tab, which sub-view, paging and filters, the open tabverse), which is
   what a store library is for, and it is the same idiom a reader will meet in
   `src/data/`.

5. **The API client is typed against `api/openapi.yaml`.** `server/ui/data/types.ts`
   declares the wire shapes of the console and admin routes, and
   `server/ui/data/api.ts` is a `fetch` wrapper with an injected `fetchFn` (the
   pattern `src/data/repo/serverApi.ts` already uses) so every test runs
   without a network. Errors normalize to `ApiError` with `status` and `code`,
   because the views branch on them: 401 sends the page back to sign-in, 403 is
   the read-only banner, 409 is a precondition the server explains in a
   sentence (`revoke it first`), which the UI shows rather than calls a failure.

6. **The URL fragment stays.** Operators bookmark and paste
   `#user=…&tab=…&tabspace=…&q=…`; the routing module keeps reading and writing
   it, and the boot sequence honours a link that names an account, a tab and a
   tabverse. This is a workflow that exists in the field, not a detail.

7. **The session story is unchanged.** An httpOnly cookie plus the readable
   XSRF cookie echoed in a header on every state-changing request (ADR 0012),
   and the sign-in form posts to `/api/v1/console/signin-link` rather than
   submitting a form, because the console's CSP sets `form-action 'none'`. The
   admin-token login screen goes away: ADR 0013 removed the token in favour of
   accounts, and the markup had been dead since (nothing in `console.js` ever
   un-hid it).

8. **The tests move to what a compiler cannot do.** Three layers:
   - vitest over the pure parts (api client, stores, formatters, routing, the
     tabverse view model) in a `node` environment, with a stubbed `fetch`;
   - `react-dom/server`'s `renderToStaticMarkup` for the views' structure
     (which panels, columns, rows and empty states render) - it needs no DOM,
     so it works under the same rule that forbids jsdom;
   - Go tests over the embedded bundle: the shell exists, every file it
     references is embedded, hashed assets are served immutable, and the SPA
     fallback still serves the shell.
   `console.test.mjs`'s hand built stub DOM and the selector cross-checks in
   `webui_test.go` go away with the script they were reading: a bundler and
   `tsc` are what catch a missing function, and they catch it earlier.

9. **The console stays read-only over user data.** No view in the rewrite
   writes a record; the single write over user content is still the tabverse
   delete with its typed confirmation (ADR 0015), now a `Dialog` with a
   `TextArea` to type the name into rather than a `prompt()`.

## Consequences

- The one UI in the repository that is not React, is not typed, and cannot use
  the design system stops existing. The console gets `tsc`, biome, vitest and
  the Blueprint components, for the price of a build step.
- A Go contributor needs Node to build the console. The `server:*` scripts and
  the CI job do it for them, and a missing bundle produces one clear message
  rather than a blank page.
- The console's payload grows from ~120 kB of hand written files to React +
  Blueprint (~244 kB gzipped JS, ~560 kB of CSS). It is a single-binary server
  on a LAN serving one operator; the trade buys the component library, and it
  is the same trade the extension already made.
- The console's look changes in this pass, because Blueprint's typography,
  spacing and control shapes take over from the hand written rules. That is
  the point of the rewrite, and it is the one thing in this ADR that cannot be
  verified by a test: the user looks at it.
- The tabverse drawer is the one view whose *content* is prescribed by another
  screen (it shows what the extension's saved-tabverse view shows, minus the
  actions that would act on this browser). Its markup and styling are this
  project's own, and the parity with the extension is a visual review, not a
  shared component.
