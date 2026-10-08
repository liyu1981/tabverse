/**
 * The official-server pairing flow, as the console page performs it
 * (adr/0020).
 *
 * The extension opens this console in a window at its pairing page -
 * `/console/pair?ext=<extension id>&nonce=<uuid>` (adr/0024) - signs in (the
 * console's own session), asks for a device name, and this module does the rest:
 *
 *   1. POST /console/api/v1/console/pair with the session -> one device + one token,
 *      returned once;
 *   2. `chrome.runtime.sendMessage(ext, {credentials, nonce})` -> the extension,
 *      which checks the nonce and saves the config.
 *
 * The token passes through this page, so two rules hold everywhere: it is never
 * rendered into the DOM (it goes straight into the message), and the message is
 * only ever addressed to the extension id the URL named. If there is no
 * extension there - the link was opened in another browser, or the build is old -
 * the page says so instead of pretending, and points at the code-based setup
 * that always works.
 *
 * Split from the view so it is a plain function of (api, chrome-like, url) and
 * can be tested without a DOM, the way the rest of `data/` is.
 */

import { api } from './api';
import type { DeviceCredentials } from './types';

/** The extension messaging surface this module uses, so tests can supply one. */
export interface ExtensionMessaging {
  /** Chrome's `runtime`, or undefined when the page is not in an extension-aware browser. */
  runtime?: {
    sendMessage(
      extensionId: string,
      message: unknown,
      callback?: (response?: any) => void,
    ): void;
    lastError?: { message?: string };
  };
}

export interface PairRequest {
  extensionId: string;
  nonce: string;
}

export type PairOutcome =
  /** The credentials were minted and the extension acknowledged them. */
  | { kind: 'sent'; credentials: DeviceCredentials }
  /** Minted, but nothing was listening - the token is shown once and nothing else. */
  | { kind: 'unreachable'; credentials: DeviceCredentials; reason: string }
  /** The extension id in the URL was empty or malformed: nothing was minted. */
  | { kind: 'no-extension' }
  /** The server refused (session gone, impersonating, ...). */
  | { kind: 'refused'; message: string };

/**
 * Where the pairing page lives: a client side route of the console, so the
 * server sends its shell for this path and the query below is all the page is
 * told about who opened it.
 */
export const PAIR_PATH = '/console/pair';

/** Reads `?ext=…&nonce=…` out of the pairing page's query string. */
export function readPairRequest(search: string): PairRequest | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const extensionId = (params.get('ext') || '').trim();
  const nonce = (params.get('nonce') || '').trim();
  if (!extensionId || !nonce) return null;
  return { extensionId, nonce };
}

/**
 * The pair request this window's URL names, if any.
 *
 * The *path* decides (adr/0024): `/console/pair` is the pairing page and its
 * query carries the two things the extension opened the window with, while the
 * console's own state (account, tab, tabverse) lives in the query of `/console`
 * itself. Neither half can be mistaken for the other, which is why nothing here
 * has to look for a marker key.
 */
export function readPairFromUrl(): PairRequest | null {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    // A trailing slash is a link somebody typed; the shell serves it too.
    const path = window.location.pathname.replace(/\/+$/, '');
    return path === PAIR_PATH ? readPairRequest(window.location.search) : null;
  } catch {
    return null;
  }
}

/**
 * Mints a device and hands the token to the extension.
 *
 * `sendToExtension` returns the extension's response (or undefined when nothing
 * answered). The token is only ever *sent*, never returned to a caller that
 * might render it - the `unreachable` outcome still carries the credentials
 * because the person is entitled to them (they can paste them as a code), but
 * the view does not put them on the page.
 */
export async function runPairFlow(
  request: PairRequest,
  deviceName: string,
  sendToExtension: (
    request: PairRequest,
    credentials: DeviceCredentials,
  ) => Promise<unknown>,
): Promise<PairOutcome> {
  let credentials: DeviceCredentials;
  try {
    credentials = await api.pairExtension({
      device_name: deviceName,
      extension_id: request.extensionId,
    });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : 'the server refused to pair this browser';
    return { kind: 'refused', message };
  }

  try {
    const response = await sendToExtension(request, credentials);
    // An extension that answered says so; silence means nothing was listening.
    if (response && (response as any).ok === false) {
      return {
        kind: 'unreachable',
        credentials,
        reason:
          (response as any).error || 'the extension did not accept the pairing',
      };
    }
    return { kind: 'sent', credentials };
  } catch (e) {
    return {
      kind: 'unreachable',
      credentials,
      reason: e instanceof Error ? e.message : 'the extension did not answer',
    };
  }
}

/**
 * The one place that talks to `chrome.runtime`: address the extension by id and
 * echo the nonce so the extension can bind this answer to the window it opened.
 *
 * It is a promise around the callback API because the callback is what reports
 * "no receiver" - `sendMessage` resolves with undefined when nobody is there,
 * and `chrome.runtime.lastError` is set in the callback.
 */
export function sendCredentialsToExtension(
  messaging: ExtensionMessaging,
  request: PairRequest,
  credentials: DeviceCredentials,
  baseUrl: string = currentOrigin(),
): Promise<unknown> {
  const runtime = messaging.runtime;
  if (!runtime) {
    // A browser without the messaging API (or a test) cannot deliver this; the
    // page shows the "extension not found" state from the outcome, so this is a
    // resolved refusal rather than a throw at the view.
    return Promise.resolve({
      ok: false,
      error: 'this browser cannot talk to the extension',
    });
  }
  return new Promise((resolve) => {
    try {
      runtime.sendMessage(
        request.extensionId,
        {
          type: 'tabverse_pair_credentials',
          nonce: request.nonce,
          baseUrl,
          credentials,
        },
        (response) => {
          const lastError = runtime.lastError;
          if (lastError) {
            resolve({ ok: false, error: lastError.message || 'no receiver' });
            return;
          }
          resolve(response ?? { ok: false, error: 'no receiver' });
        },
      );
    } catch (e) {
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : 'sendMessage failed',
      });
    }
  });
}

/**
 * Keeping the request across a sign-in.
 *
 * The wizard is the one flow where the page is *not* where it started when it
 * becomes able to do its job: a person who is not signed in has to sign in
 * first, and both sign-in paths (the emailed link and every provider) come back
 * to the console at `/console` - `withConsoleReturn` sets `?from=` to the console
 * URL on purpose, so a caller-supplied return target is deliberately ignored.
 * The query carrying `ext` and `nonce` would be lost with it.
 *
 * So the pair page puts the request in `sessionStorage` before it sends the
 * person away, and reads it back after. `sessionStorage` and not `localStorage`
 * because this is one window's business: a second tab on the console must not
 * inherit a pending pairing, and the window the extension opened is the one
 * that finishes it.
 */

const STASH_KEY = 'tabverse_pending_pair';

export interface PairStash {
  request: PairRequest;
  /** Where the person was sent to sign in, for the "back" line in the UI. */
  at: number;
}

/** Remembers the request so a sign-in round trip does not lose it. */
export function stashPairRequest(
  request: PairRequest,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
  const store = storage ?? safeSessionStorage();
  if (!store) return;
  const payload: PairStash = { request, at: Date.now() };
  try {
    store.setItem(STASH_KEY, JSON.stringify(payload));
  } catch {
    // a full or blocked storage must not stop the page from pairing
  }
}

/**
 * Takes the stashed request, once: it is consumed here so a later navigation
 * does not offer to pair again, and an old one (a day) is ignored rather than
 * resurrecting a pairing nobody is standing in.
 */
export function takeStashedPairRequest(
  storage?: Pick<Storage, 'getItem' | 'removeItem'>,
): PairRequest | null {
  const store = storage ?? safeSessionStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(STASH_KEY);
    store.removeItem(STASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PairStash;
    if (!parsed?.request?.extensionId || !parsed.request.nonce) return null;
    if (Date.now() - (parsed.at || 0) > STASH_TTL_MS) return null;
    return parsed.request;
  } catch {
    return null;
  }
}

/** An hour is long enough for a sign-in round trip and short enough to be safe. */
const STASH_TTL_MS = 60 * 60 * 1000;

/**
 * Where this page is served from, which is where the extension should sync.
 * Read defensively: the module is exercised in node, where there is no window.
 */
function currentOrigin(): string {
  try {
    return typeof window !== 'undefined' && window.location
      ? window.location.origin
      : '';
  } catch {
    return '';
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
