# ADR 0034: a release is a tag

Status: accepted (2026-10). Extension packaging; the server's artefacts are
built by the same workflow but released on their own.

## Context

Tabverse is in the Chrome Web Store, so every version a user gets goes through
it: build `dist_store/tabverse.zip`, upload it in the developer dashboard,
publish, wait for review. That was a checklist in
`doc/chrome-webstore/listing.md`, done by hand, on one machine. It was wrong in
three ways.

**The uploaded package was not the package CI built.** `ci.yml` already builds
and archives a store zip on every push, but a release then uploaded a zip
assembled later from a working tree. Nothing compared the two, and nothing
recorded what had been uploaded.

**The version could disagree with itself.** `package.json` is what the manifest
is generated from, `src/global.ts` is what the About panel shows, and the tag is
what GitHub calls the release. Three values, kept in step by remembering to run
`tools/version_update`.

**It needed a browser, and therefore a person.** Publishing from the dashboard
needs the publisher signed in on a machine with a GUI, so a release could not be
cut from anywhere else, and a release with that laptop closed simply waited. The
GitHub release was hand-made for the same reason: the zip's name and contents
depended on who did it.

## Decisions

1. **A tag is the release.** Pushing `v*.*.*` runs
   `.github/workflows/release.yml`. `workflow_dispatch` serves two other cases
   with the same workflow: with `tag` it releases that tag's tree again (a
   retry), and with no tag and `dry_run` it rehearses the commit it was
   dispatched from - the only way to rehearse code that has not been tagged
   yet. A dispatch with no tag refuses to release.

2. **The release gates on what CI gates on.** The same typecheck, format, lint,
   test and build steps, in the release job. A tag can be pushed from a commit
   that never went through a pull request, so the release cannot assume the
   checks passed somewhere else.

3. **One version, checked three ways.** The workflow refuses to build unless the
   tag, `package.json` and `src/global.ts` agree, and `tools/cwsUpload.mjs`
   refuses to upload unless the manifest *inside the zip* carries that version
   too. A mislabelled release is a red build, not a store item whose About panel
   is a version behind.

4. **The store client lives in this repository, not in a `uses:` line.**
   `tools/cwsUpload.mjs` is the whole client: token refresh, `fetchStatus`, the
   media upload, `publish` - the three endpoints of API v2, over `fetch`, with no
   dependency. It takes the outside world as arguments, so its tests drive the
   ordering, the failure paths and the version guard with a fake fetch and no
   network. A third-party action would have been less code but an unpinned link
   in the one place that can publish to users' browsers, and its bugs would have
   been someone else's release notes.

5. **Credentials: an OAuth client for the publisher account.** Three repository
   secrets (client id, secret, refresh token) and a repository variable for the
   publisher id; the extension id defaults to the published item, and a fork can
   override it. The token is issued with the
   `https://www.googleapis.com/auth/chromewebstore` scope by the account that
   owns the item, and the consent screen has to be published - while it is in
   "Testing", Google expires its refresh tokens after seven days, which would
   turn into a release failing a week later for no visible reason.

6. **The GitHub release is created first, the store submission last.** The two
   halves have different retry costs: creating a release can be repeated
   (`gh release upload --clobber`), submitting a version cannot. So everything
   retryable happens before the one step that is not, and a failed submission
   still leaves a tag with a downloadable package on it.

7. **A version number is spent by its first upload.** The store will not accept
   the same version twice, so the tool checks the published *and* the
   already-submitted version from `fetchStatus` before uploading and fails with
   an explanation if either is equal or newer. A submission that fails after the
   upload is fixed by bumping the patch version and tagging again - not by
   re-running the workflow, which is why that has to fail early and say so.

8. **Publishing is the submission, and nothing else.** `--publish` calls
   `publish` with `DEFAULT_PUBLISH`: the item goes live when the review passes,
   which is the whole point of the tag. Review is not skipped (the API only
   accepts `skipReview` for eligible changes) and validation warnings are
   reported in the log rather than blocking. The workflow does not touch the
   listing: name, description, screenshots, privacy answers and visibility stay
   dashboard work, and the API cannot change them.

9. **A dry run exists, and it is what a fork gets.** `workflow_dispatch` with
   `dry_run`, or a repository with no store secrets, builds and validates the
   package - and prints the version the store currently has - without releasing
   or submitting anything. So the first release can be rehearsed, and a fork's
   tag does not fail at a step it was never able to run.

## Consequences

- Cutting a release needs a maintainer with tag rights *and* the secrets. A
  contribution from a fork cannot publish to the store; that is the intent.
- A dispatched run is the workflow from the dispatching commit but the tree of
  the ref it checks out, so a retry of a tag predating this machinery runs the
  new steps against an old tree (and has no `tools/cwsUpload.mjs` to run).
  Releasing an old tag again is therefore only meaningful for tags cut after
  this decision; everything before it is already on the store.
- Review is asynchronous and outside the pipeline: the workflow ends at
  "submitted", and the approval or rejection is read in the dashboard (or with
  `fetchStatus`). A rejection costs a patch version.
- The secrets are long-lived OAuth credentials in a repository; rotating them is
  re-doing the playground exchange and updating three values, and revoking the
  refresh token in the Google account is what stops a leaked one.
- `pnpm run build-store` and the release workflow now produce the same file from
  the same commit; the manual checklist keeps only what the API cannot do
  (listing, disclosure answers) and the one-time credential setup.
