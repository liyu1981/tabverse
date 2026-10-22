/**
 * Vitest runs in a `node` environment with no `chrome` global, but the UI is
 * rendered to static markup in tests and asserts on the English it produces -
 * 242 assertions across 27 files pin strings like `title="Add to this window"`.
 *
 * So the tests do not get a permissive stub: they get the *real* English
 * catalog behind `chrome.i18n.getMessage`. That keeps the assertions honest -
 * extraction into `_locales/` cannot quietly turn a component's label into an
 * empty string and still pass - and it means a test sees the same text the
 * browser would.
 *
 * The `$1`/`$2` substitution rules are Chrome's.
 */
import enMessages from './public/_locales/en/messages.json';

type MessageTable = Record<string, { message: string }>;

const catalog = enMessages as unknown as MessageTable;

function getMessage(key: string, substitutions?: string | string[]): string {
  const entry = catalog[key];
  if (entry === undefined) {
    return '';
  }
  if (substitutions === undefined) {
    return entry.message;
  }
  const slots = Array.isArray(substitutions) ? substitutions : [substitutions];
  return entry.message.replace(/\$(\d+)/g, (_match, index: string) => {
    const value = slots[Number(index) - 1];
    return value === undefined ? '' : value;
  });
}

const globals = globalThis as { chrome?: Record<string, unknown> };
// A test that installs its own chrome mock (src/dev/chromeMock.ts) keeps it:
// this only fills in what is missing.
globals.chrome ??= {};
const chromeApi = globals.chrome as { i18n?: unknown };
if (chromeApi.i18n === undefined) {
  chromeApi.i18n = { getMessage, getUILanguage: () => 'en' };
}
