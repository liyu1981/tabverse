#!/usr/bin/env node
/**
 * Holds the second half of the localization guarantee.
 *
 * `src/i18n/index.ts` makes a *typo'd* key a tsc error, because `t()` only
 * accepts a key that exists in the English catalog. What it cannot see is a
 * key that exists in `en` but was never translated, or a translation whose
 * `$1` slots do not match the English they stand for - both fail silently in
 * the browser as a wrong or empty label. That is this script's job.
 *
 * Checks, per locale:
 *   - the file parses, and `en` is there (it is the default_locale; a build
 *     without it does not load at all)
 *   - every key name is one Chrome accepts: [A-Za-z0-9_@]. A dot, a space or a
 *     dash is rejected by the browser, so it must not reach the catalog.
 *   - the key set is exactly `en`'s - no missing, no extra. An extra key is as
 *     much a bug as a missing one: it means a string was translated twice.
 *   - no message is empty
 *   - the `$1`/`$NAME$` substitutions are the same set as the English message's,
 *     so a translation cannot drop or renumber a slot
 *
 * Run: `pnpm run i18n:check`. Exits non-zero on any failure.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(process.cwd(), 'public', '_locales');
const DEFAULT_LOCALE = 'en';
const KEY_NAME = /^[a-zA-Z0-9_@]+$/;

/** The substitutions a message uses, as a sorted list: `1`, `2`, `NAME`. */
function substitutionsOf(message) {
  const found = new Set();
  for (const match of message.matchAll(/\$(\d+)|\$([A-Za-z][A-Za-z0-9_]*)\$/g)) {
    found.add(match[1] ?? match[2]);
  }
  return [...found].sort();
}

function readCatalog(locale) {
  const file = join(LOCALES_DIR, locale, 'messages.json');
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch (error) {
    return { error: `cannot read ${file}: ${error.message}` };
  }
  try {
    return { catalog: JSON.parse(text) };
  } catch (error) {
    return { error: `${file} is not valid JSON: ${error.message}` };
  }
}

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const problems = [];
const fail = (locale, message) => problems.push(`${locale}: ${message}`);

if (!locales.includes(DEFAULT_LOCALE)) {
  console.error(
    `no ${DEFAULT_LOCALE}/ under ${LOCALES_DIR} - Chrome refuses to load a manifest with default_locale and no default catalog`,
  );
  process.exit(1);
}

const enResult = readCatalog(DEFAULT_LOCALE);
if (enResult.error) {
  console.error(enResult.error);
  process.exit(1);
}
const en = enResult.catalog;
const enKeys = Object.keys(en);
const enSubstitutions = new Map(
  enKeys.map((key) => [key, substitutionsOf(en[key].message ?? '')]),
);

for (const locale of locales) {
  const result = readCatalog(locale);
  if (result.error) {
    fail(locale, result.error);
    continue;
  }
  const catalog = result.catalog;
  const keys = Object.keys(catalog);

  for (const key of keys) {
    if (!KEY_NAME.test(key)) {
      fail(
        locale,
        `key "${key}" is not one Chrome accepts (letters, digits, _ and @ only)`,
      );
    }
  }

  if (locale !== DEFAULT_LOCALE) {
    for (const key of enKeys) {
      if (!(key in catalog)) {
        fail(locale, `missing key "${key}"`);
      }
    }
    for (const key of keys) {
      if (!(key in en)) {
        fail(locale, `extra key "${key}" (not in ${DEFAULT_LOCALE})`);
      }
    }
  }

  for (const key of keys) {
    const entry = catalog[key];
    if (entry === null || typeof entry !== 'object') {
      fail(locale, `key "${key}" is not an object with a "message"`);
      continue;
    }
    if (typeof entry.message !== 'string' || entry.message.trim() === '') {
      fail(locale, `key "${key}" has an empty message`);
      continue;
    }
    const expected = enSubstitutions.get(key) ?? [];
    const actual = substitutionsOf(entry.message);
    if (locale !== DEFAULT_LOCALE && actual.join(',') !== expected.join(',')) {
      fail(
        locale,
        `key "${key}" uses $${actual.join('/$') || 'none'} but ${DEFAULT_LOCALE} uses $${expected.join('/$') || 'none'}`,
      );
    }
  }
}

const total = locales.reduce((count, locale) => {
  const result = readCatalog(locale);
  return count + (result.catalog ? Object.keys(result.catalog).length : 0);
}, 0);

if (problems.length > 0) {
  console.error(`i18n:check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error(
    `\n${locales.length} locales, ${enKeys.length} keys in ${DEFAULT_LOCALE}.`,
  );
  process.exit(1);
}

console.log(
  `i18n:check ok - ${locales.length} locales (${locales.join(', ')}), ${enKeys.length} keys each, ${total} messages.`,
);
