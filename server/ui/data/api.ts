/**
 * The console's client for its own server (adr/0018).
 *
 * Design notes, in the spirit of `src/data/repo/serverApi.ts`:
 *  - `fetchFn` is injected, so every test in this directory runs without a
 *    network and without a DOM;
 *  - errors normalize to `ApiError`, because the views branch on them: a 401
 *    means the session is gone, a 403 is the read-only answer, and a 409 is a
 *    precondition the server explains in a sentence ("revoke it first") which
 *    the UI shows as it is rather than calling a failure;
 *  - the XSRF token is held here rather than in a store, because it is a
 *    property of the *connection* (a readable cookie the server hands out with
 *    `/console/me`) and not of any screen.
 */

import type {
  AdminSearchResult,
  ArchiveOutcome,
  Impersonation,
  Invite,
  Me,
  RecordPage,
  ServerConfig,
  TabspaceBundle,
  TabspacePage,
  Totals,
  UserDetail,
  UserList,
  UserSummary,
} from './types';

export interface HttpResponseLike {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<HttpResponseLike>;

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** The session is gone: the page has to go back to the sign-in form. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** The server refused on a precondition and said what is missing (409). */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export interface ListParams {
  limit?: number;
  offset?: number;
  q?: string;
  entity?: string;
  deleted?: boolean;
  archived?: boolean;
}

export interface ConsoleApi {
  readonly csrfHeader: string;
  setCsrf(header: string, token: string): void;
  getConfig(): Promise<ServerConfig>;
  whoAmI(): Promise<Me | null>;
  requestSigninLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  impersonation(): Promise<Impersonation>;
  startImpersonation(userId: string): Promise<void>;
  stopImpersonation(): Promise<void>;
  totals(): Promise<Totals>;
  listUsers(query?: string): Promise<UserSummary[]>;
  getUser(userId: string): Promise<UserDetail>;
  renameUser(userId: string, name: string): Promise<void>;
  setRole(userId: string, role: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  createInvite(userId: string, ttlSeconds: number): Promise<Invite>;
  revokeDevice(userId: string, deviceId: string): Promise<void>;
  setDeviceArchived(
    userId: string,
    deviceId: string,
    archived: boolean,
  ): Promise<ArchiveOutcome>;
  setDeviceRecordsArchived(
    userId: string,
    deviceId: string,
    archived: boolean,
  ): Promise<ArchiveOutcome>;
  revokeToken(userId: string, tokenHash: string): Promise<void>;
  setTokenArchived(
    userId: string,
    tokenHash: string,
    archived: boolean,
  ): Promise<ArchiveOutcome>;
  listTabspaces(userId: string, params: ListParams): Promise<TabspacePage>;
  getTabspace(userId: string, tabspaceId: string): Promise<TabspaceBundle>;
  deleteTabspace(userId: string, tabspaceId: string): Promise<void>;
  listRecords(userId: string, params: ListParams): Promise<RecordPage>;
  search(
    userId: string,
    params: { q: string; entity?: string; archived?: boolean },
  ): Promise<AdminSearchResult>;
}

export function createConsoleApi(fetchFn: FetchLike = fetch): ConsoleApi {
  let csrfHeader = '';
  let csrfToken = '';

  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrfHeader && csrfToken && method !== 'GET' && method !== 'HEAD') {
      headers[csrfHeader] = csrfToken;
    }
    const res = await fetchFn(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) {
      return null as T;
    }
    const text = await res.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(res.status, 'bad_response', text.slice(0, 200));
      }
    }
    if (!res.ok) {
      throw new ApiError(
        res.status,
        (data && data.error) || 'http_error',
        (data && data.message) || `HTTP ${res.status}`,
      );
    }
    return data as T;
  };

  const query = (
    params: Record<string, string | number | boolean | undefined>,
  ) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '' || value === false) continue;
      search.set(key, value === true ? '1' : String(value));
    }
    const encoded = search.toString();
    return encoded ? '?' + encoded : '';
  };

  const userPath = (userId: string, rest = '') =>
    `/api/v1/admin/users/${encodeURIComponent(userId)}${rest}`;

  const listParams = (params: ListParams) =>
    query({
      limit: params.limit,
      offset: params.offset,
      q: params.q,
      entity: params.entity,
      deleted: params.deleted,
      archived: params.archived,
    });

  return {
    get csrfHeader() {
      return csrfHeader;
    },

    setCsrf(header: string, token: string) {
      csrfHeader = header || '';
      csrfToken = token || '';
    },

    getConfig: () => call<ServerConfig>('GET', '/api/v1/admin/config'),

    /**
     * `null` means the server could not say who this is at all (it is older than
     * accounts); a 401 is answered with the signed-out document rather than an
     * error, so boot() has one branch and not two.
     */
    async whoAmI() {
      try {
        return await call<Me>('GET', '/api/v1/console/me');
      } catch (e) {
        if (e instanceof ApiError && e.isUnauthorized) return null;
        return null;
      }
    },

    /**
     * The library owns the send and reads the address from the *query string*
     * (`address`, with `user` for the name and `site` for the audience) - a
     * POST body is ignored, and getting it wrong is a bare 400. This is our
     * endpoint rather than the library's: it creates the account before the link
     * goes out, which is the order the session check needs.
     */
    async requestSigninLink(email: string) {
      const search = new URLSearchParams({
        user: email,
        address: email,
        site: window.location.origin,
      });
      await call('POST', `/api/v1/console/signin-link?${search.toString()}`);
    },

    signOut: () => call('POST', '/api/v1/console/signout'),
    impersonation: () =>
      call<Impersonation>('GET', '/api/v1/console/impersonation'),

    startImpersonation: (userId: string) =>
      call(
        'POST',
        `/api/v1/admin/users/${encodeURIComponent(userId)}/impersonate`,
      ),

    stopImpersonation: () => call('POST', '/api/v1/console/impersonate/stop'),

    totals: () => call<Totals>('GET', '/api/v1/admin/totals'),

    async listUsers(queryText?: string) {
      const data = await call<UserList>(
        'GET',
        '/api/v1/admin/users' + query({ q: queryText }),
      );
      return data.users || [];
    },

    getUser: (userId: string) => call<UserDetail>('GET', userPath(userId)),
    renameUser: (userId: string, name: string) =>
      call('PUT', userPath(userId), { name }),
    setRole: (userId: string, role: string) =>
      call('PUT', userPath(userId, '/role'), { role }),

    /** The server demands the id back as `?confirm=`; the page asks for the
     *  name to be typed first (adr/0015). */
    deleteUser: (userId: string) =>
      call(
        'DELETE',
        userPath(userId) + '?confirm=' + encodeURIComponent(userId),
      ),

    createInvite: (userId: string, ttlSeconds: number) =>
      call<Invite>('POST', userPath(userId, '/invites'), {
        ttl_seconds: ttlSeconds,
      }),

    revokeDevice: (userId: string, deviceId: string) =>
      call(
        'DELETE',
        userPath(userId, `/devices/${encodeURIComponent(deviceId)}`),
      ),

    setDeviceArchived: (userId: string, deviceId: string, archived: boolean) =>
      call<ArchiveOutcome>(
        archived ? 'PUT' : 'DELETE',
        userPath(userId, `/devices/${encodeURIComponent(deviceId)}/archive`),
      ),

    setDeviceRecordsArchived: (
      userId: string,
      deviceId: string,
      archived: boolean,
    ) =>
      call<ArchiveOutcome>(
        archived ? 'PUT' : 'DELETE',
        userPath(
          userId,
          `/devices/${encodeURIComponent(deviceId)}/records/archive`,
        ),
      ),

    revokeToken: (userId: string, tokenHash: string) =>
      call(
        'DELETE',
        userPath(userId, `/tokens/${encodeURIComponent(tokenHash)}`),
      ),

    setTokenArchived: (userId: string, tokenHash: string, archived: boolean) =>
      call<ArchiveOutcome>(
        archived ? 'PUT' : 'DELETE',
        userPath(userId, `/tokens/${encodeURIComponent(tokenHash)}/archive`),
      ),

    listTabspaces: (userId: string, params: ListParams) =>
      call<TabspacePage>(
        'GET',
        userPath(userId, '/tabspaces') + listParams(params),
      ),

    getTabspace: (userId: string, tabspaceId: string) =>
      call<TabspaceBundle>(
        'GET',
        userPath(userId, `/tabspaces/${encodeURIComponent(tabspaceId)}`),
      ),

    deleteTabspace: (userId: string, tabspaceId: string) =>
      call(
        'DELETE',
        userPath(userId, `/tabspaces/${encodeURIComponent(tabspaceId)}`) +
          '?confirm=' +
          encodeURIComponent(tabspaceId),
      ),

    listRecords: (userId: string, params: ListParams) =>
      call<RecordPage>(
        'GET',
        userPath(userId, '/records') + listParams(params),
      ),

    search: (
      userId: string,
      params: { q: string; entity?: string; archived?: boolean },
    ) =>
      call<AdminSearchResult>(
        'GET',
        userPath(userId, '/search') + query(params),
      ),
  };
}

/**
 * The client the app uses. Tests build their own with a stub `fetchFn` and
 * hand it to the stores through `setApi`, so nothing in this directory reaches
 * the network by accident.
 */
export let api: ConsoleApi = createConsoleApi();

export function setApi(next: ConsoleApi): void {
  api = next;
}
