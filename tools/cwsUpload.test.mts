/**
 * The store submission (`.github/workflows/release.yml` -> `tools/cwsUpload.mjs`).
 *
 * Everything here runs against a fake `fetch`: the flow, the order of the
 * calls, and - the part worth a test - the checks that run *before* anything is
 * uploaded, because a version number cannot be uploaded twice.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  assertVersionIsUnused,
  compareVersions,
  credentialsFromEnv,
  parseArgs,
  run,
} from './cwsUpload.mjs';

const env = {
  CWS_PUBLISHER_ID: 'publisher',
  CWS_CLIENT_ID: 'client',
  CWS_CLIENT_SECRET: 'secret',
  CWS_REFRESH_TOKEN: 'refresh',
};

const ITEM = 'publishers/publisher/items/lffblcippngalmglinedcbmikkncihdm';

type Call = { url: string; method: string; headers: Record<string, string> };

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** A fetch that answers the four calls by their route and records them. */
function store({
  publishedVersion = '0.7.2',
  submittedVersion,
  uploadState = 'SUCCEEDED',
  publishState = 'PENDING_REVIEW',
  uploadAttempts = 1,
}: {
  publishedVersion?: string;
  submittedVersion?: string;
  uploadState?: string;
  publishState?: string;
  uploadAttempts?: number;
} = {}) {
  const calls: Call[] = [];
  let uploads = 0;
  let polls = 0;
  const fetchImpl = vi.fn(async (url: string, init: any = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
    });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return response({ access_token: 'token' });
    }
    if (url.endsWith(':fetchStatus')) {
      // the pre-flight fetchStatus runs before the upload; only the ones after
      // it are polls, and they report the async upload's progress
      polls = uploads > 0 ? polls + 1 : 0;
      const poll = polls;
      return response({
        itemId: 'tabverse',
        publishedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: publishedVersion }],
        },
        ...(submittedVersion === undefined
          ? {}
          : {
              submittedItemRevisionStatus: {
                distributionChannels: [{ crxVersion: submittedVersion }],
              },
            }),
        ...(poll > 0
          ? {
              lastAsyncUploadState:
                poll >= uploadAttempts ? 'SUCCEEDED' : 'IN_PROGRESS',
            }
          : {}),
      });
    }
    if (url.endsWith(':upload')) {
      uploads += 1;
      return response({
        itemId: 'tabverse',
        uploadState,
      });
    }
    if (url.endsWith(':publish')) {
      return response({ itemId: 'tabverse', state: publishState });
    }
    throw new Error(`unexpected request ${url}`);
  });
  return { calls, fetchImpl };
}

function submit(
  fetchImpl: any,
  {
    args = ['--publish'],
    credentials = env,
    zipVersion = '0.7.3',
  }: {
    args?: string[];
    credentials?: Record<string, string>;
    zipVersion?: string;
  } = {},
) {
  return run({
    argv: [
      '--source',
      'dist_store/tabverse.zip',
      '--expect-version',
      '0.7.3',
      ...args,
    ],
    env: credentials,
    fetchImpl,
    readFile: () => Buffer.from('the zip'),
    zipManifest: () => zipVersion,
    sleep: () => Promise.resolve(),
    log: () => undefined,
  });
}

describe('parseArgs', () => {
  it('reads the four flags', () => {
    const options = parseArgs([
      '--source',
      'tabverse.zip',
      '--expect-version',
      '0.7.3',
      '--publish',
      '--dry-run',
    ]);
    expect(options).toEqual({
      source: 'tabverse.zip',
      expectVersion: '0.7.3',
      publish: true,
      dryRun: true,
      help: false,
    });
  });

  it('requires a source and a version', () => {
    expect(() => parseArgs(['--expect-version', '0.7.3'])).toThrow(/--source/);
    expect(() => parseArgs(['--source', 'tabverse.zip'])).toThrow(
      /--expect-version/,
    );
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    expect(() =>
      parseArgs(['--source', 'a.zip', '--expect-version', '1.0.0', '--pubish']),
    ).toThrow(/unknown argument "--pubish"/);
  });

  it('refuses a version that is not dotted integers', () => {
    expect(() =>
      parseArgs(['--source', 'a.zip', '--expect-version', 'v1.0.0']),
    ).toThrow(/not a version like/);
  });
});

describe('compareVersions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('0.7.10', '0.7.9')).toBe(1);
    expect(compareVersions('0.7.9', '0.7.10')).toBe(-1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0.1', '1.2')).toBe(1);
  });
});

describe('credentialsFromEnv', () => {
  it('lists everything that is missing', () => {
    expect(() => credentialsFromEnv({ CWS_CLIENT_ID: 'client' })).toThrow(
      /CWS_PUBLISHER_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN/,
    );
  });

  it('defaults the extension id to the published item', () => {
    expect(credentialsFromEnv(env).extensionId).toBe(
      'lffblcippngalmglinedcbmikkncihdm',
    );
    expect(
      credentialsFromEnv({ ...env, CWS_EXTENSION_ID: 'another' }).extensionId,
    ).toBe('another');
  });

  it('allows no credentials only when they are not required', () => {
    // a fork running the release with --dry-run
    expect(credentialsFromEnv({}, { required: false })).toBeUndefined();
    // but half a set is a typo, whichever mode
    expect(() =>
      credentialsFromEnv(
        { CWS_PUBLISHER_ID: 'publisher' },
        { required: false },
      ),
    ).toThrow(/CWS_CLIENT_ID/);
  });
});

describe('assertVersionIsUnused', () => {
  it('accepts a version after the published one', () => {
    expect(() =>
      assertVersionIsUnused('0.7.3', {
        publishedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: '0.7.2' }],
        },
      }),
    ).not.toThrow();
  });

  it('refuses the published version and anything older, explaining the rule', () => {
    const status = {
      publishedItemRevisionStatus: {
        distributionChannels: [{ crxVersion: '0.7.3' }],
      },
    };
    expect(() => assertVersionIsUnused('0.7.3', status)).toThrow(
      /can only be used once/,
    );
    expect(() => assertVersionIsUnused('0.7.2', status)).toThrow(/already has/);
  });

  it('refuses a version already submitted for review', () => {
    expect(() =>
      assertVersionIsUnused('0.7.3', {
        publishedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: '0.7.2' }],
        },
        submittedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: '0.7.3' }],
        },
      }),
    ).toThrow(/submitted for review/);
  });
});

describe('run', () => {
  it('refreshes a token, checks the store, uploads and publishes, in order', async () => {
    const { calls, fetchImpl } = store();
    const result = await submit(fetchImpl);

    expect(result).toEqual({
      status: 'submitted',
      version: '0.7.3',
      state: 'PENDING_REVIEW',
    });
    expect(
      calls.map((call) =>
        call.url.startsWith('https://oauth2.googleapis.com')
          ? 'token'
          : call.url.slice(call.url.lastIndexOf(':')),
      ),
    ).toEqual(['token', ':fetchStatus', ':upload', ':publish']);
    expect(calls.map((call) => call.method)).toEqual([
      'POST',
      'GET',
      'POST',
      'POST',
    ]);
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    // the item is addressed by publisher and extension id, never by name alone
    expect(calls[1].url).toBe(
      `https://chromewebstore.googleapis.com/v2/${ITEM}:fetchStatus`,
    );
    expect(calls[2].url).toBe(
      `https://chromewebstore.googleapis.com/upload/v2/${ITEM}:upload`,
    );
    // the three API calls carry the token; the token call cannot
    expect(calls[1].headers.authorization).toBe('Bearer token');
    expect(calls[2].headers.authorization).toBe('Bearer token');
    expect(calls[3].headers.authorization).toBe('Bearer token');
  });

  it('publishes with the default publish type, so review decides', async () => {
    const { fetchImpl } = store();
    const sent: any[] = [];
    const spied = vi.fn(async (url: string, init: any = {}) => {
      if (url.endsWith(':publish')) {
        sent.push(JSON.parse(init.body));
      }
      return fetchImpl(url, init);
    });
    await submit(spied);
    expect(sent).toEqual([{ publishType: 'DEFAULT_PUBLISH' }]);
  });

  it('refuses a package that is not the version the tag names, before any request', async () => {
    const { calls, fetchImpl } = store();
    await expect(submit(fetchImpl, { zipVersion: '0.7.2' })).rejects.toThrow(
      /carries version 0.7.2, but --expect-version is 0.7.3/,
    );
    expect(calls).toEqual([]);
  });

  it('does not upload a version the store already has', async () => {
    const { calls, fetchImpl } = store({ publishedVersion: '0.7.3' });
    await expect(submit(fetchImpl)).rejects.toThrow(/can only be used once/);
    expect(calls.map((call) => call.url.endsWith(':upload'))).not.toContain(
      true,
    );
  });

  it('leaves an upload unpublished without --publish', async () => {
    const { calls, fetchImpl } = store();
    const result = await submit(fetchImpl, { args: [] });
    expect(result).toEqual({ status: 'uploaded', version: '0.7.3' });
    expect(calls.map((call) => call.url.endsWith(':publish'))).not.toContain(
      true,
    );
  });

  it('polls rather than publishing a package the store is still reading', async () => {
    const { calls, fetchImpl } = store({
      uploadState: 'IN_PROGRESS',
      uploadAttempts: 2,
    });
    const slept: number[] = [];
    const result = await run({
      argv: [
        '--source',
        'dist_store/tabverse.zip',
        '--expect-version',
        '0.7.3',
        '--publish',
      ],
      env,
      fetchImpl,
      readFile: () => Buffer.from('the zip'),
      zipManifest: () => '0.7.3',
      sleep: async (ms: number) => {
        slept.push(ms);
      },
      log: () => undefined,
    });
    expect(result.status).toBe('submitted');
    expect(slept.length).toBeGreaterThan(0);
    // one pre-flight status, then one poll per IN_PROGRESS answer
    expect(
      calls.filter((call) => call.url.endsWith(':fetchStatus')).length,
    ).toBe(3);
  });

  it('fails when the store refuses the package', async () => {
    const { fetchImpl } = store({ uploadState: 'FAILED' });
    await expect(submit(fetchImpl)).rejects.toThrow(/refused the package/);
  });

  it('fails when the submission is rejected', async () => {
    const { fetchImpl } = store({ publishState: 'REJECTED' });
    await expect(submit(fetchImpl)).rejects.toThrow(/submission is REJECTED/);
  });

  it('surfaces the API message when a call is refused', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return response(
          {
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          },
          400,
        );
      }
      return response({});
    });
    await expect(submit(fetchImpl)).rejects.toThrow(
      /token refresh: HTTP 400: Token has been expired or revoked\./,
    );
  });
});

describe('run --dry-run', () => {
  const dryRun = (credentials: Record<string, string>) =>
    run({
      argv: [
        '--source',
        'dist_store/tabverse.zip',
        '--expect-version',
        '0.7.3',
        '--publish',
        '--dry-run',
      ],
      env: credentials,
      fetchImpl: vi.fn(),
      readFile: () => Buffer.from('the zip'),
      zipManifest: () => '0.7.3',
      log: () => undefined,
    });

  it('touches nothing at all without credentials', async () => {
    const result = await dryRun({});
    expect(result.status).toBe('dry-run');
  });

  it('still checks the token and the store version when credentials exist', async () => {
    const { calls, fetchImpl } = store({ publishedVersion: '0.7.3' });
    await expect(
      run({
        argv: [
          '--source',
          'dist_store/tabverse.zip',
          '--expect-version',
          '0.7.3',
          '--dry-run',
        ],
        env,
        fetchImpl,
        readFile: () => Buffer.from('the zip'),
        zipManifest: () => '0.7.3',
        log: () => undefined,
      }),
    ).rejects.toThrow(/can only be used once/);
    expect(calls.map((call) => call.url.endsWith(':upload'))).not.toContain(
      true,
    );
  });
});
