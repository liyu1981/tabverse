/**
 * The extension's single way to turn a message key into user-visible text.
 *
 * Chrome resolves `chrome.i18n.getMessage` against the *browser UI* locale and
 * picks the best match out of `_locales/`; there is no runtime switch, and the
 * manifest's own name/description can only be localized this way. That is why
 * this wraps `chrome.i18n` rather than pulling in a JS i18n library: a second
 * source of truth for the locale would disagree with the manifest on the one
 * field a user sees before installing.
 *
 * The type of `key` is the literal union of the keys in the English catalog, so
 * a typo, or a key that was never written down, is a `tsc` error rather than an
 * empty label at runtime. `tools/i18ncheck.mts` then holds the other half of the
 * guarantee: every other locale has exactly the same keys as `en`.
 *
 * The English catalog is imported *type only*, so no messages ship in the bundle
 * - Chrome reads `_locales/` off disk, and bundling a copy would be dead weight
 * that could drift from it.
 */
import type enMessages from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof enMessages;

/**
 * Resolve a message. `substitutions` fills Chrome's `$1`, `$2`, ... slots.
 *
 * Returns `''` when the key is unknown, which is what `chrome.i18n.getMessage`
 * does - a missing label should be visibly absent, never a raw key shown to a
 * user.
 */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  const message = globalThis.chrome?.i18n?.getMessage(key, substitutions);
  return typeof message === 'string' ? message : '';
}
