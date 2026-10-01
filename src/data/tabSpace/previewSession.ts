/**
 * Which browser run wrote a tab preview.
 *
 * A thumbnail row is keyed by `chromeTabId`, and a chrome tab id is scoped to a
 * browser session *and recycled*: after a restart, id 42 can be a live tab
 * showing a completely different page. So "this row has no open tab" is not
 * quite the ownership rule we want - the rule is "this row has no *open* tab",
 * and the only way to tell those two apart is to record which run wrote it.
 *
 * `chrome.storage.session` is exactly the right home for that: its contents
 * live for one browser run and are cleared when the browser exits (Chrome 102+;
 * our floor is 140), and both the service worker and the pages can read them.
 * A page and the worker therefore agree on "this session" without talking to
 * each other, and the worker - which is the only thing that reaps the table -
 * knows at once that everything from the previous run is unowned.
 *
 * The same area holds the "we already swept this session" flag. The service
 * worker is torn down when Chrome decides it is idle, so an in-memory flag would
 * re-run the sweep on every wake-up; in `storage.session` it survives for the
 * whole browser run and clears itself by being different next time.
 */

const PREVIEW_SESSION_KEY = 'tabverse_preview_session';
const PREVIEW_SESSION_SWEEPED_KEY = 'tabverse_preview_session_swept';

interface SessionAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The session area, or null where there is no extension runtime (tests). */
function sessionArea(): SessionAreaLike | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return null;
  }
  return chrome.storage.session as unknown as SessionAreaLike;
}

function mintId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // older engines, and the unit tests
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Set by the tests; null means "mint one and remember it". */
let overrideId: string | null = null;
let cachedId: string | null = null;
let sweptForInMemory: string | null = null;

/**
 * The id of the current browser run, minted once per run and remembered by
 * this context. Never rejects: without a runtime (tests) or without session
 * storage it falls back to a per-process id, which is the same lifetime the
 * real thing has.
 */
export function currentPreviewSessionId(): Promise<string> {
  if (overrideId !== null) {
    return Promise.resolve(overrideId);
  }
  if (cachedId !== null) {
    return Promise.resolve(cachedId);
  }
  const area = sessionArea();
  if (!area) {
    cachedId = mintId();
    return Promise.resolve(cachedId);
  }
  return area
    .get(PREVIEW_SESSION_KEY)
    .then(async (items) => {
      const existing = items[PREVIEW_SESSION_KEY];
      if (typeof existing === 'string' && existing) {
        cachedId = existing;
        return existing;
      }
      const fresh = mintId();
      await area.set({ [PREVIEW_SESSION_KEY]: fresh });
      cachedId = fresh;
      return fresh;
    })
    .catch(() => {
      // a session storage that will not answer is not worth failing a preview
      // write over; a per-process id keeps the rows attributable to something
      cachedId = mintId();
      return cachedId;
    });
}

/**
 * Whether this browser run has already swept the preview table. False after a
 * restart (nothing is stored), which is exactly when the sweep is needed.
 */
export async function isPreviewSessionSwept(
  sessionId: string,
): Promise<boolean> {
  const area = sessionArea();
  if (!area) {
    return sweptForInMemory === sessionId;
  }
  try {
    const items = await area.get(PREVIEW_SESSION_SWEEPED_KEY);
    return items[PREVIEW_SESSION_SWEEPED_KEY] === sessionId;
  } catch {
    return false;
  }
}

/** Records that this browser run has swept the preview table. */
export async function markPreviewSessionSwept(
  sessionId: string,
): Promise<void> {
  sweptForInMemory = sessionId;
  const area = sessionArea();
  if (!area) {
    return;
  }
  try {
    await area.set({ [PREVIEW_SESSION_SWEEPED_KEY]: sessionId });
  } catch {
    // best effort: a missed mark costs one extra sweep, nothing else
  }
}

/**
 * Test hook: pins the session id (or `null` to go back to minting one). Also
 * forgets the swept flag, so a test can play "this browser just started".
 */
export function setPreviewSessionIdForTest(id: string | null): void {
  overrideId = id;
  cachedId = null;
  sweptForInMemory = null;
}
