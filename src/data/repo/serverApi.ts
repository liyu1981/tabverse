/**
 * Typed client for the `tabversed` sync server (see api/openapi.yaml).
 *
 * Design notes:
 *  - `fetchFn` is injected so unit tests never touch the network, and so the
 *    same client works in the service worker, the manager page and jest.
 *  - Errors are normalized to ServerApiError so callers can branch on
 *    `status`/`code` (e.g. 401 -> re-pair the device).
 */

import {
  DeviceCredentials,
  EntityName,
  PullResult,
  PushResult,
  RecordInput,
  SearchHit,
  SyncRecord,
} from './types';

export interface HttpResponseLike {
  status: number;
  json(): Promise<any>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<HttpResponseLike>;

export class ServerApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ServerApiError';
    this.status = status;
    this.code = code;
  }

  /** The device lost its credentials and must pair again. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface SearchOptions {
  entity?: EntityName;
  limit?: number;
}

export interface ServerApiClientOptions {
  /** e.g. https://sync.example.com (scheme required, no trailing slash). */
  baseUrl: string;
  token: string;
  fetchFn?: FetchLike;
}

function defaultFetch(): FetchLike {
  const f = (globalThis as any).fetch;
  if (typeof f !== 'function') {
    throw new ServerApiError(
      0,
      'no_fetch',
      'no fetch implementation available',
    );
  }
  return (url, init) => f(url, init);
}

export class ServerApiClient {
  readonly baseUrl: string;
  readonly token: string;
  private readonly fetchFn: FetchLike;

  constructor(options: ServerApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchFn = options.fetchFn || defaultFetch();
  }

  /** WebSocket endpoint for the realtime change stream. */
  streamUrl(): string {
    return (
      this.baseUrl.replace(/^http/, 'ws') +
      '/console/api/v1/sync/stream?access_token=' +
      encodeURIComponent(this.token)
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    } = {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res: HttpResponseLike;
    try {
      res = await this.fetchFn(this.baseUrl + path, init);
    } catch (err: any) {
      // Network failure: the outbox keeps data and retries later.
      throw new ServerApiError(
        0,
        'network',
        `network error for ${method} ${path}: ${err && err.message}`,
      );
    }

    if (res.status >= 400) {
      let code = 'http_error';
      let message = `HTTP ${res.status} for ${method} ${path}`;
      try {
        const data = await res.json();
        if (data && data.error) {
          code = data.error;
          message = data.message || message;
        }
      } catch {
        // non JSON error body, keep defaults
      }
      throw new ServerApiError(res.status, code, message);
    }
    return (await res.json()) as T;
  }

  /** Delta download: everything with rev > since. */
  pull(since: number, limit?: number): Promise<PullResult> {
    const query = [`since=${Math.max(0, Math.floor(since))}`];
    if (limit) {
      query.push(`limit=${limit}`);
    }
    return this.request<PullResult>(
      'GET',
      `/console/api/v1/sync?${query.join('&')}`,
    );
  }

  /** Batch upload; per record LWW outcomes. */
  push(records: RecordInput[]): Promise<PushResult> {
    if (records.length === 0) {
      return Promise.resolve({ results: [], server_rev: -1 });
    }
    return this.request<PushResult>('POST', '/console/api/v1/sync', {
      records,
    });
  }

  search(
    query: string,
    options: SearchOptions = {},
  ): Promise<{
    query: string;
    hits: SearchHit[];
  }> {
    const parts = [`q=${encodeURIComponent(query)}`];
    if (options.entity) {
      parts.push(`entity=${encodeURIComponent(options.entity)}`);
    }
    if (options.limit) {
      parts.push(`limit=${options.limit}`);
    }
    return this.request<{ query: string; hits: SearchHit[] }>(
      'GET',
      `/console/api/v1/search?${parts.join('&')}`,
    );
  }

  getRecord(entity: EntityName, id: string): Promise<SyncRecord> {
    return this.request<SyncRecord>(
      'GET',
      `/console/api/v1/entities/${encodeURIComponent(entity)}/${encodeURIComponent(
        id,
      )}`,
    );
  }

  deleteRecord(entity: EntityName, id: string): Promise<PushResult> {
    return this.request<PushResult>(
      'DELETE',
      `/console/api/v1/entities/${encodeURIComponent(entity)}/${encodeURIComponent(
        id,
      )}`,
    );
  }

  /** Mint a pairing code for another device of this account. */
  createInvite(
    ttlSeconds = 900,
  ): Promise<{ code: string; expires_at: number }> {
    return this.request('POST', '/console/api/v1/auth/invites', {
      ttl_seconds: ttlSeconds,
    });
  }

  // ---- unauthenticated bootstrap helpers (static) ----

  /** Creates the first account of a server; 409 afterwards. */
  static bootstrap(
    baseUrl: string,
    name: string,
    fetchFn?: FetchLike,
  ): Promise<DeviceCredentials> {
    return ServerApiRaw.post(
      baseUrl,
      '/console/api/v1/auth/bootstrap',
      { name },
      fetchFn,
    );
  }

  /** Redeems a single use pairing code for this device's token. */
  static pair(
    baseUrl: string,
    inviteCode: string,
    deviceName: string,
    fetchFn?: FetchLike,
  ): Promise<DeviceCredentials> {
    return ServerApiRaw.post(
      baseUrl,
      '/console/api/v1/auth/pair',
      { invite_code: inviteCode, device_name: deviceName },
      fetchFn,
    );
  }
}

/** Helper for the two unauthenticated POSTs. */
class ServerApiRaw {
  /**
   * A rejected fetch is ambiguous, and these are the two calls a user makes
   * right after typing a server URL by hand: no route to that host, a closed
   * port, a name that does not resolve, a CORS rejection, or the browser
   * refusing the request outright. Chrome reports the last one (a CSP
   * violation) as the same "Failed to fetch" as the others, which is how a
   * blocked host ends up looking like a dead server. So say what to check.
   */
  static networkHint(): string {
    return (
      ' — check the server URL is reachable from this browser (scheme, host and ' +
      'port, not 127.0.0.1 unless the server is on this machine); a CSP violation ' +
      'in the console means the extension is an older build'
    );
  }

  static async post<T>(
    baseUrl: string,
    path: string,
    body: unknown,
    fetchFn?: FetchLike,
  ): Promise<T> {
    const doFetch = fetchFn || defaultFetch();
    let res: HttpResponseLike;
    try {
      res = await doFetch(baseUrl.replace(/\/+$/, '') + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      throw new ServerApiError(
        0,
        'network',
        `network error for POST ${path}: ${err && err.message}` +
          ServerApiRaw.networkHint(),
      );
    }
    if (res.status >= 400) {
      let code = 'http_error';
      let message = `HTTP ${res.status} for POST ${path}`;
      try {
        const data = await res.json();
        if (data && data.error) {
          code = data.error;
          message = data.message || message;
        }
      } catch {
        // keep defaults
      }
      throw new ServerApiError(res.status, code, message);
    }
    return (await res.json()) as T;
  }
}
