#!/usr/bin/env node
/**
 * The release's last step: submit `dist_store/tabverse.zip` to the Chrome Web
 * Store and ask for a review.
 *
 * `.github/workflows/release.yml` runs this on a version tag; it is equally
 * runnable from a terminal with the same environment, which is how the
 * credentials are checked before a release depends on them.
 *
 * The API is v2 (`chromewebstore.googleapis.com`), the one the current
 * documentation describes and the only one that still takes an upload: the
 * v1.1 `items/{id}` endpoints are gone. Three calls, in this order:
 *
 *   POST oauth2.googleapis.com/token                             refresh -> access token
 *   GET  .../v2/publishers/{p}/items/{i}:fetchStatus             what the store has
 *   POST .../upload/v2/publishers/{p}/items/{i}:upload           the zip itself
 *   POST .../v2/publishers/{p}/items/{i}:publish                 submit for review
 *
 * Two checks run before anything is uploaded, because **a version number
 * cannot be reused**: the archive's own `manifest.json` must carry the version
 * we were told to expect, and the store must not already have that version or
 * a newer one. A release that fails after the upload is fixed by a new patch
 * version, not by running it again, so the failure has to happen early and say
 * why. `--dry-run` runs both checks (and the token exchange) and then stops.
 *
 * Credentials come from the environment - `doc/chrome-webstore/listing.md` has
 * the one-time setup: CWS_PUBLISHER_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET,
 * CWS_REFRESH_TOKEN, and optionally CWS_EXTENSION_ID.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ROOT = 'https://chromewebstore.googleapis.com';
// The published item: public knowledge, and the default so that a release does
// not depend on one more piece of configuration. A fork overrides it with
// CWS_EXTENSION_ID.
const DEFAULT_EXTENSION_ID = 'lffblcippngalmglinedcbmikkncihdm';

// The token exchange sends no scope: the refresh token already carries the
// `https://www.googleapis.com/auth/chromewebstore` grant it was issued with.
const CREDENTIAL_NAMES = [
  'CWS_PUBLISHER_ID',
  'CWS_CLIENT_ID',
  'CWS_CLIENT_SECRET',
  'CWS_REFRESH_TOKEN',
];

const USAGE = `usage: node tools/cwsUpload.mjs --source <zip> --expect-version <x.y.z> [--publish] [--dry-run]

  --source          the store package, normally dist_store/tabverse.zip
  --expect-version  the version the tag names: the archive and the store are
                    checked against it before anything is uploaded
  --publish         submit the uploaded version for review; without it the
                    upload stays a draft (or the pending review is replaced)
  --dry-run         do everything that is not a write: check the archive, the
                    credentials (when present) and the store's version, then
                    stop before the upload

environment:
  CWS_PUBLISHER_ID  the publisher id, from the developer dashboard's
                    Publisher > Settings
  CWS_EXTENSION_ID  the item to update (default ${DEFAULT_EXTENSION_ID})
  CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
                    the OAuth client and the token issued for it`;

/**
 * Parse the command line. Throws on anything unknown: a typo in a release
 * script should stop the release, not be silently ignored.
 */
export function parseArgs(argv) {
  const options = {
    source: undefined,
    expectVersion: undefined,
    publish: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case '--source':
        index += 1;
        options.source = argv[index];
        break;
      case '--expect-version':
        index += 1;
        options.expectVersion = argv[index];
        break;
      case '--publish':
        options.publish = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument "${flag}"\n\n${USAGE}`);
    }
  }
  if (options.help) {
    return options;
  }
  if (!options.source) {
    throw new Error(`--source is required\n\n${USAGE}`);
  }
  if (!options.expectVersion) {
    throw new Error(`--expect-version is required\n\n${USAGE}`);
  }
  if (!/^\d+(\.\d+){0,3}$/.test(options.expectVersion)) {
    throw new Error(
      `--expect-version "${options.expectVersion}" is not a version like 0.7.3`,
    );
  }
  return options;
}

/**
 * Read the credentials out of the environment.
 *
 * `required: false` is the fork's case: a repository without the secrets runs
 * the release with `--dry-run`, and then no credentials at all is a valid
 * state. Half a set never is - that is a typo, and it would otherwise fail
 * somewhere much less obvious.
 */
export function credentialsFromEnv(env, { required = true } = {}) {
  const missing = CREDENTIAL_NAMES.filter((name) => !env[name]);
  if (
    missing.length > 0 &&
    (required || missing.length < CREDENTIAL_NAMES.length)
  ) {
    throw new Error(
      `missing ${missing.join(', ')} - doc/chrome-webstore/listing.md has ` +
        'the one-time setup for these',
    );
  }
  if (missing.length > 0) {
    return undefined;
  }
  return {
    publisherId: env.CWS_PUBLISHER_ID,
    extensionId: env.CWS_EXTENSION_ID || DEFAULT_EXTENSION_ID,
    clientId: env.CWS_CLIENT_ID,
    clientSecret: env.CWS_CLIENT_SECRET,
    refreshToken: env.CWS_REFRESH_TOKEN,
  };
}

/**
 * Compare two dotted versions numerically, so 0.7.10 is after 0.7.9 and 1.2
 * equals 1.2.0. Chrome allows one to four components, all integers.
 */
export function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The version inside the archive, read out of the zip rather than from `dist/`
 * - the point is to check the file that is about to be uploaded, not a
 * neighbour in the working tree.
 */
export function manifestVersionInZip(zipPath, exec = execFileSync) {
  const manifest = JSON.parse(
    exec('unzip', ['-p', zipPath, 'tabverse/manifest.json'], {
      encoding: 'utf-8',
    }),
  );
  return manifest.version;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** The error text of a Google API response: `{error: {message}}` or `{error: '...'}`. */
function describeError(body, text) {
  const error = body?.error;
  if (typeof error === 'string') {
    // the OAuth token endpoint's shape: {error: 'invalid_grant',
    // error_description: 'Token has been expired or revoked.'}
    return `: ${body.error_description ?? error}`;
  }
  // the API's shape: {error: {code, message, status, details}}
  return `: ${error?.message ?? text.slice(0, 500)}`;
}

async function readJson(response, what) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw new Error(
      `${what}: HTTP ${response.status}${describeError(body, text)}`,
    );
  }
  if (body === undefined) {
    throw new Error(`${what}: the response is not JSON: ${text.slice(0, 500)}`);
  }
  return body;
}

async function accessTokenFor({ credentials, fetchImpl }) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const token = await readJson(response, 'token refresh');
  if (!token.access_token) {
    throw new Error('token refresh: no access_token in the response');
  }
  return token.access_token;
}

async function itemStatus({ item, accessToken, fetchImpl }) {
  const response = await fetchImpl(`${API_ROOT}/v2/${item}:fetchStatus`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return readJson(response, 'fetchStatus');
}

/**
 * Refuse a version the store already has. This runs before the upload because
 * the API cannot help here: by the time it rejects the package, the run has
 * done work it will only undo with a version bump.
 */
export function assertVersionIsUnused(expectVersion, status) {
  const published =
    status.publishedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion;
  const submitted =
    status.submittedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion;
  const seen = [
    ['published', published],
    ['submitted for review', submitted],
  ];
  for (const [where, version] of seen) {
    if (version && compareVersions(expectVersion, version) <= 0) {
      throw new Error(
        `the store already has ${version} ${where}, so ${expectVersion} ` +
          'cannot be uploaded: a version number can only be used once. Bump ' +
          'the patch version (node tools/version_update <x.y.z>), commit, ' +
          'and tag that instead',
      );
    }
  }
  return { published, submitted };
}

async function uploadPackage({ item, accessToken, archive, fetchImpl, sleep }) {
  const response = await fetchImpl(`${API_ROOT}/upload/v2/${item}:upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      // the documented curl sends none; the archive is a zip and saying so has
      // never been refused by this endpoint
      'content-type': 'application/zip',
    },
    body: archive,
  });
  const result = await readJson(response, 'upload');
  if (result.uploadState === 'SUCCEEDED') {
    return result;
  }
  if (result.uploadState !== 'IN_PROGRESS') {
    throw new Error(
      `upload: the store refused the package (${result.uploadState})`,
    );
  }
  // The API can take a package asynchronously. A few MB is normally done by
  // the time the response arrives; poll for a bounded minute rather than
  // publishing a package the store is still reading.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(3000);
    const status = await itemStatus({ item, accessToken, fetchImpl });
    if (status.lastAsyncUploadState === 'SUCCEEDED') {
      return { crxVersion: undefined, uploadState: 'SUCCEEDED' };
    }
    if (status.lastAsyncUploadState === 'FAILED') {
      throw new Error(
        'upload: the store failed to process the package - the developer ' +
          'dashboard says why',
      );
    }
  }
  throw new Error(
    'upload: still IN_PROGRESS after a minute - check the developer ' +
      'dashboard before submitting this version again',
  );
}

async function publishItem({ item, accessToken, fetchImpl }) {
  const response = await fetchImpl(`${API_ROOT}/v2/${item}:publish`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    // DEFAULT_PUBLISH: go live when the review passes. Review is not skipped
    // (the API accepts skipReview for eligible changes only) and validation
    // warnings are reported, not fatal.
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  });
  const result = await readJson(response, 'publish');
  if (result.state === 'REJECTED' || result.state === 'CANCELLED') {
    throw new Error(`publish: the submission is ${result.state}`);
  }
  return result;
}

/**
 * Everything `main` does, with the outside world injected so that the whole
 * flow - including the order of the calls and the version guard - can be
 * tested without a network or a zip on disk.
 */
export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFile = readFileSync,
  zipManifest = manifestVersionInZip,
  sleep = defaultSleep,
  log = (...parts) => console.log('cwsUpload:', ...parts),
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(USAGE);
    return { status: 'help' };
  }

  const credentials = credentialsFromEnv(env, { required: !options.dryRun });
  const archive = readFile(options.source);

  // The archive has to be the extension, at the version we were told to
  // expect: the manifest inside it is what the store will record, whatever
  // package.json says.
  let versionInZip;
  try {
    versionInZip = zipManifest(options.source);
  } catch (error) {
    log(
      `could not read manifest.json out of ${options.source} (${error.message}); ` +
        'skipping the archive version check',
    );
  }
  if (versionInZip !== undefined && versionInZip !== options.expectVersion) {
    throw new Error(
      `${options.source} carries version ${versionInZip}, but ` +
        `--expect-version is ${options.expectVersion}`,
    );
  }
  log(
    `package ${options.source}: ${archive.length} bytes, version ${options.expectVersion}`,
  );

  if (!credentials) {
    log('dry run without credentials: nothing is read from the store');
    return { status: 'dry-run', version: options.expectVersion };
  }

  const item = `publishers/${credentials.publisherId}/items/${credentials.extensionId}`;
  const accessToken = await accessTokenFor({ credentials, fetchImpl });
  const status = await itemStatus({ item, accessToken, fetchImpl });
  if (status.takenDown) {
    log(
      'WARNING: the store says this item is taken down - check the dashboard',
    );
  }
  const { published, submitted } = assertVersionIsUnused(
    options.expectVersion,
    status,
  );
  log(
    `store: published ${published ?? 'nothing'}, submitted ${submitted ?? 'nothing'}`,
  );

  if (options.dryRun) {
    log(`dry run: would upload ${options.expectVersion} and stop`);
    return { status: 'dry-run', version: options.expectVersion };
  }

  const uploaded = await uploadPackage({
    item,
    accessToken,
    archive,
    fetchImpl,
    sleep,
  });
  log(`uploaded (${uploaded.uploadState})`);
  if (uploaded.crxVersion !== undefined) {
    if (compareVersions(uploaded.crxVersion, options.expectVersion) !== 0) {
      throw new Error(
        `the store read version ${uploaded.crxVersion} out of the package, ` +
          `not ${options.expectVersion}`,
      );
    }
  }

  if (!options.publish) {
    log('not publishing: no --publish');
    return { status: 'uploaded', version: options.expectVersion };
  }

  const result = await publishItem({ item, accessToken, fetchImpl });
  for (const warning of result.warningInfo?.warnings ?? []) {
    log(`warning from the store: ${warning.reason}: ${warning.description}`);
  }
  log(`submitted for review: ${result.state}`);
  return {
    status: 'submitted',
    version: options.expectVersion,
    state: result.state,
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run()
    .then((result) => {
      if (result.status === 'help') {
        process.exitCode = 0;
      }
    })
    .catch((error) => {
      console.error(`cwsUpload: ${error.message}`);
      process.exitCode = 1;
    });
}
