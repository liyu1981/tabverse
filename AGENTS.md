# AGENTS.md

Instructions for AI coding agents working in this repository. Follow them in
addition to anything in `ARCHITECTURE.md` and `adr/`.

## Package manager

- **Prefer pnpm** for installing and managing Node dependencies in general:
  `pnpm add -D <pkg>`, `pnpm remove <pkg>`, `pnpm <script>`, `pnpm dlx ...`
  instead of the npm equivalents.
- Do not mix lockfiles: only one package manager's lockfile may exist in the
  repo at a time.
- Note: the toolchain was set up with npm, so `package-lock.json` is what is
  committed today and CI (`.github/workflows/ci.yml`) runs `npm ci`. If you
  touch dependency management, either migrate the repo to pnpm completely
  (lockfile + CI + README scripts) or stay on npm for that change - say which
  you did, and never leave both lockfiles behind.

## Git commits

- **Never commit unless explicitly asked.** No "just committing while I was
  here", no fixup commits, no commits bundled into another task. Leave the
  changes in the working tree and report what is pending.
- When asked to commit: make **exactly one** commit for that request, with
  - a concise title line (imperative mood, what the change does),
  - details in the body (why, notable decisions, how it was verified).
- After that single commit: stop. Do not push, do not create follow-up
  commits, do not amend - wait for the next instruction.
