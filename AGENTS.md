# AGENTS.md

Instructions for AI coding agents working in this repository. Follow them in
addition to anything in `ARCHITECTURE.md` and `adr/`.

## Package manager

- **Use pnpm** for installing and managing Node dependencies:
  `pnpm add -D <pkg>`, `pnpm remove <pkg>`, `pnpm <script>`, `pnpm dlx ...`.
- Do not mix lockfiles: only one package manager's lockfile may exist per
  package. The repository moved off npm on 2025: `package-lock.json` is gone,
  `pnpm-lock.yaml` is the source of truth, and CI
  (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile` with
  `pnpm/action-setup@v4`, which reads the pinned version from
  `packageManager` in `package.json`. The Docusaurus site in
  `doc/tabverse-website/` is a package of its own (it has a
  `pnpm-workspace.yaml` so it is its own workspace root, and its own
  `pnpm-lock.yaml`), built and served separately from the extension.

## Verification

- Run what is automatable: `pnpm test` (vitest), `pnpm run typecheck`, biome
  `format`/`lint`, and the Go suite (`go vet`, `go test -race ./...` in
  `server/`). Fix what they report, and state plainly which checks you ran.
- **Every manual check that involves something long-lived must be bounded.**
  A server in the foreground, a `systemctl start`ed unit, a `journalctl -f`, a
  `tail -f`, a `pnpm run develop` watch build, a server waiting on a port: put a
  timeout on it (`timeout 5 ...`, `journalctl -n 50 --no-pager`, `&` plus
  `kill`), and never leave one running between tool calls. A call that blocks
  for minutes with no output is indistinguishable from a hang, and it holds the
  session hostage - the same discipline as the `--no-pager` flag on anything
  that pages. Anything started for a check is stopped again in the same task,
  including units that were `enable`d, and say what you left behind.
- **Do not drive a headless browser to verify UI.** The user checks the UI
  (extension pages, the tabversed console) themselves. Report what to look for
  instead, and say plainly what is unverified - do not imply a UI was checked
  when only the tests were.
- Do not install a browser-automation dependency (puppeteer, playwright, jsdom)
  for this repo to do so either.

## Git commits

- **Never commit unless explicitly asked.** No "just committing while I was
  here", no fixup commits, no commits bundled into another task. Leave the
  changes in the working tree and report what is pending.
- When asked to commit: make **exactly one** commit for that request, with
  - a concise title line (imperative mood, what the change does),
  - details in the body (why, notable decisions, how it was verified).
- After that single commit: stop. Do not push, do not create follow-up
  commits, do not amend - wait for the next instruction.
- **One instruction means one commit, and then the agent is idle again.** A
  "commit" instruction is spent by the commit it produces: it does not carry
  over to work finished afterwards, and it is not permission to commit
  everything that happens to be pending. After committing, go back to waiting
  for the next order.
- In particular, do not commit again at the end of a later task, a review pass
  or a verification run, even when the only pending change is your own and
  even when it "clearly belongs" with the previous commit. Leave it in the
  working tree and say what is pending; the next commit happens when the next
  commit is asked for.
- Staging is not committing: `git add` is fine for inspecting what a commit
  would contain, but the tree stays uncommitted until told otherwise.
