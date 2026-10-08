/**
 * The official-server wizard, from the extension's side (adr/0020).
 *
 * The custom flow is a form: a URL, a code the person copied, a device name. The
 * wizard replaces the copying with a browser window the server owns: this
 * extension opens it with its own id and a nonce in the URL (the console's
 * query, `?pair=1&ext=…&nonce=…`), the person signs in and agrees there, the
 * server mints a device and a token, and the page
 * sends the token back over `chrome.runtime.sendMessage` - the channel the
 * manifest's `externally_connectable` entry opens to exactly one origin.
 *
 * What this module owns:
 *  - the official server's address, in one place (the manifest's match pattern
 *    and this constant have to agree, so there is only one to change);
 *  - the nonce: a value only this window and this extension know, which is what
 *    makes an unsolicited "here is a token" message ignorable;
 *  - opening the window, and closing it again once the token is in.
 *
 * The receiving end - the message handler, the origin check, the save - is in
 * `background.ts`, because a message can arrive while no page is open and the
 * service worker is the context that is always there.
 */

import { logger } from '../../global';

/**
 * Where the wizard lives. It is a constant rather than a setting: the wizard
 * is *the* official server, and a build that wants to point somewhere else
 * changes this and the manifest together (see tools/manifestPolicy.test.mts,
 * which pins the two).
 */
export const OFFICIAL_SERVER_URL = 'https://tabversed.liyu1981.xyz';

/** The origin allowed to message this extension. */
export const OFFICIAL_SERVER_ORIGIN = new URL(OFFICIAL_SERVER_URL).origin;

/**
 * Where the console itself is: the server's address plus the prefix the page is
 * served under (adr/0023). Exported because the dialog tells the person where
 * the window opens.
 */
export const OFFICIAL_CONSOLE_URL = `${OFFICIAL_SERVER_URL}/console`;

/** The message the console page sends, and the only one this extension takes. */
export const PAIR_CREDENTIALS_MESSAGE = 'tabverse_pair_credentials';

export interface PairCredentialsMessage {
  type: typeof PAIR_CREDENTIALS_MESSAGE;
  /** Echoes the nonce from the URL; see `newPairNonce`. */
  nonce: string;
  /** Where the token is valid - the server that issued it. */
  baseUrl: string;
  credentials: {
    user_id: string;
    device_id: string;
    token: string;
    server_rev: number;
    issued_at?: number;
  };
}

/** A fresh nonce. `crypto.randomUUID` where it exists, and a fallback that does not. */
export function newPairNonce(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * The URL to open.
 *
 * The pair request travels in the query, on the console's own page
 * (`/console?pair=1&ext=…&nonce=…`, adr/0023): the whole URL is then an
 * ordinary HTTP URL - one the server serves, redirects and logs like any other,
 * and one whose meaning does not depend on a client-side router having run.
 * The nonce is known to the server this opens, so it appearing in an access log
 * costs nothing that the pairing itself does not already give away, and the
 * page stashes the request before any sign-in round trip in case the return
 * target arrives without it (see server/ui/data/pair.ts).
 */
export function officialPairUrl(
  extensionId: string,
  nonce: string,
  baseUrl: string = OFFICIAL_SERVER_URL,
): string {
  const query = new URLSearchParams({
    pair: '1',
    ext: extensionId,
    nonce,
  });
  return `${baseUrl.replace(/\/+$/, '')}/console?${query.toString()}`;
}

/**
 * Opens the wizard in a new window.
 *
 * A window rather than a tab because that is what a person recognises as
 * "something else is happening", and because provider sign-ins (Google, GitHub)
 * are happiest in an ordinary browser window. The window is returned so the
 * caller can close it once the token arrives - it is the extension's own window,
 * and leaving it open after "Tabverse is connected" would be a small lie about
 * what is still to happen.
 */
export async function openOfficialPairWindow(
  url: string,
  deps: {
    windows?: {
      create: (data: chrome.windows.CreateData) => Promise<{ id?: number }>;
      remove: (windowId: number) => Promise<void>;
    };
  } = {},
): Promise<number | null> {
  const windows =
    deps.windows ?? (chrome.windows as unknown as typeof deps.windows);
  try {
    const created = await windows.create({ url, focused: true });
    return typeof created?.id === 'number' ? created.id : null;
  } catch (err) {
    logger.error('could not open the official sync window', err);
    return null;
  }
}

/**
 * Closes a window this extension opened.
 *
 * The extension made it, so it is this one's to close; and a window that cannot
 * be closed (already gone, or the browser refused) is worth a log line and
 * nothing else - the pairing is done, which is what the person was told.
 */
export async function closePairWindow(
  windowId: number | null,
  deps: {
    windows?: { remove: (windowId: number) => Promise<void> };
  } = {},
): Promise<void> {
  if (windowId === null) return;
  const windows =
    deps.windows ?? (chrome.windows as unknown as typeof deps.windows);
  try {
    await windows.remove(windowId);
  } catch (err) {
    logger.log('could not close the official sync window', windowId, err);
  }
}
/**
 * The receiving end: a message that claims to carry a token.
 *
 * Shared by every context that can receive one - the service worker (which is
 * the one that owns the sync config, and is what Chrome wakes for an external
 * message) and the dialog that opened the window. Both run these same checks, so
 * whichever gets there first does the work and the other finds the nonce spent
 * and does nothing; saving twice is harmless, saving from an unchecked message
 * is not.
 *
 * Four things have to be true, and the order is the order of how cheap they are
 * to refuse:
 *
 *  1. it is our message type;
 *  2. it came from the official server's origin (the manifest already narrows
 *     who may send at all; this is the same rule stated where the code can see
 *     it, and it also covers a page that got the messaging API some other way);
 *  3. it answers a pairing *this device started* - the nonce is minted here,
 *     put in the URL, and spent here, so a message nobody asked for has nothing
 *     to match;
 *  4. it actually carries credentials.
 *
 * `chrome.storage.session` holds the pending nonce because the two contexts
 * that need it (the dialog that opens the window, the worker that receives) are
 * different ones, and it is the same reasoning previewSession.ts uses: one
 * browser run, gone when the browser is.
 */

const PENDING_PAIR_KEY = 'tabverse_pending_pair';

/** How long a started pairing stays answerable. */
export const PAIR_PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingPair {
  nonce: string;
  at: number;
}

interface SessionLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function sessionArea(existing?: SessionLike): SessionLike | null {
  if (existing) return existing;
  try {
    return typeof chrome !== 'undefined' && chrome.storage?.session
      ? (chrome.storage.session as unknown as SessionLike)
      : null;
  } catch {
    return null;
  }
}

/** Remembers the pairing this device just started, so its answer can be matched. */
export async function rememberPendingPair(
  nonce: string,
  storage?: SessionLike,
  now: number = Date.now(),
): Promise<void> {
  const area = sessionArea(storage);
  if (!area) return;
  try {
    await area.set({ [PENDING_PAIR_KEY]: { nonce, at: now } as PendingPair });
  } catch (err) {
    logger.log('could not remember the pending pairing', err);
  }
}

/**
 * Takes the pending pairing, once.
 *
 * Spent whether or not it matches, so a wrong nonce cannot be retried: the answer
 * to a pairing is accepted once.
 */
export async function takePendingPair(
  storage?: SessionLike,
  now: number = Date.now(),
): Promise<PendingPair | null> {
  const area = sessionArea(storage);
  if (!area) return null;
  try {
    const items = await area.get(PENDING_PAIR_KEY);
    await area.remove(PENDING_PAIR_KEY);
    const pending = items[PENDING_PAIR_KEY] as PendingPair | undefined;
    if (!pending || typeof pending.nonce !== 'string') return null;
    // an unanswered pairing is not an answerable one
    if (now - (pending.at ?? 0) > PAIR_PENDING_TTL_MS) return null;
    return pending;
  } catch (err) {
    logger.log('could not read the pending pairing', err);
    return null;
  }
}

export interface PairSender {
  origin?: string;
  url?: string;
}

/** The origin a message came from, or '' when it did not come from a page. */
export function senderOrigin(sender: PairSender | undefined): string {
  if (!sender) return '';
  if (sender.origin) return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : '';
  } catch {
    return '';
  }
}

export interface AcceptPairDeps {
  /** Defaults to the official server's origin. */
  expectedOrigin?: string;
  storage?: SessionLike;
  /** Persists the credentials; `adoptCredentials` in production. */
  save?: (
    baseUrl: string,
    credentials: PairCredentialsMessage['credentials'],
  ) => Promise<unknown>;
  /** Tells the open pages the config changed. */
  notify?: () => void;
  now?: number;
}

/**
 * Takes a pairing message or refuses it. True when it was accepted *and* saved.
 */
export async function acceptPairCredentials(
  message: unknown,
  sender: PairSender | undefined,
  deps: AcceptPairDeps = {},
): Promise<boolean> {
  const expected = deps.expectedOrigin ?? OFFICIAL_SERVER_ORIGIN;

  if (
    !message ||
    (message as PairCredentialsMessage).type !== PAIR_CREDENTIALS_MESSAGE
  ) {
    return false;
  }
  if (senderOrigin(sender) !== expected) {
    logger.log(
      'pairing message from an unexpected origin:',
      senderOrigin(sender),
    );
    return false;
  }

  const pending = await takePendingPair(deps.storage, deps.now);
  if (!pending || pending.nonce !== (message as PairCredentialsMessage).nonce) {
    // either nobody asked, or this is not the answer to what was asked
    logger.log('pairing message with no pending nonce, ignored');
    return false;
  }

  const credentials = (message as PairCredentialsMessage).credentials;
  if (
    !credentials ||
    typeof credentials.token !== 'string' ||
    credentials.token.length <= 0 ||
    typeof (message as PairCredentialsMessage).baseUrl !== 'string'
  ) {
    logger.log('pairing message without credentials, ignored');
    return false;
  }

  if (deps.save) {
    await deps.save((message as PairCredentialsMessage).baseUrl, credentials);
  }
  deps.notify?.();
  return true;
}
