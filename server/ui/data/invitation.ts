/**
 * The invitation a link carried: `?invite=<code>&email=<address>` on the
 * console.
 *
 * The link is opened before sign-in, and signing in (a provider round trip, or
 * following an emailed link) comes back to a bare `/console`, which drops the
 * query. So the invitation is saved the first time it is seen and read back from
 * sessionStorage, which survives that redirect in the same tab.
 */
export interface Invitation {
  email: string;
  code: string;
}

const STORAGE_KEY = 'tabverse.invitation';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    // Storage can be blocked; the URL still fills this page load in.
    return null;
  }
}

/** The invitation `?invite=&email=` carries, or null when the URL has neither. */
export function invitationFromSearch(search: string): Invitation | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const code = params.get('invite') || '';
  const email = params.get('email') || '';
  if (!code && !email) return null;
  return { email, code };
}

export function saveInvitation(invitation: Invitation): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(invitation));
  } catch {
    // A full or blocked store only costs the redirect persistence.
  }
}

/** The invitation to pre-fill with: the URL first, then the saved one. */
export function loadInvitation(): Invitation | null {
  if (typeof window !== 'undefined' && window.location) {
    const fromUrl = invitationFromSearch(window.location.search);
    if (fromUrl) {
      saveInvitation(fromUrl);
      return fromUrl;
    }
  }
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Invitation;
  } catch {
    return null;
  }
}

export function clearInvitation(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

/** Drop `?invite=&email=` from the address bar, once they have been used. */
export function stripInvitationFromUrl(): void {
  if (typeof window === 'undefined' || !window.location) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('invite') && !params.has('email')) return;
  params.delete('invite');
  params.delete('email');
  const rest = params.toString();
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (rest ? '?' + rest : ''),
  );
}
