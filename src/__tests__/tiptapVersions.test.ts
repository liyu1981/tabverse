/**
 * All the TipTap packages move together.
 *
 * They are one library split into packages, and the split is not a stable API:
 * `@tiptap/extension-heading` 3.33 changed its `parseMarkdown` from an arrow
 * function to a method that reads `this.options.levels`, while
 * `@tiptap/markdown` (pinned a version behind, 3.31.3) still built its
 * handlers without the extension context. Every note that starts with a
 * heading then failed to open with `Cannot read properties of undefined
 * (reading 'levels')` - a crash caught by the note's ErrorBoundary, invisible
 * until somebody had such a note.
 *
 * `@tiptap/*`'s peer dependencies are exact (`"@tiptap/core": "3.33.0"`), but
 * pnpm only warns on a mismatch, so nothing stops a mixed set from being
 * installed. This test is that stop: the manifests must name one version, and
 * the installed packages must all be that version - bumping one means bumping
 * all of them (and re-running the note parse test in
 * `src/ui/notebook/__tests__/markdownParse.test.ts`).
 */
import { readFileSync } from 'node:fs';

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const root = new URL('../../', import.meta.url);

function readJson(path: URL): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const pkg: Manifest = readJson(new URL('package.json', root));

function tiptapSpecs(): [string, string][] {
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([name]) => name.startsWith('@tiptap/'))
    .map(([name, spec]) => [
      name,
      // a range prefix is not a version: "^3.33.0" and "3.33.0" are the same
      // package version, and markdown is deliberately pinned exactly
      String(spec)
        .replace(/^[~^>=<\s]+/, '')
        .trim(),
    ]);
}

test('the manifest names one TipTap version', () => {
  const specs = tiptapSpecs();
  expect(specs.length).toBeGreaterThan(0);
  const versions = new Set(specs.map(([, version]) => version));
  expect([...versions], `@tiptap specs: ${JSON.stringify(specs)}`).toHaveLength(
    1,
  );
});

test('what is installed is that one TipTap version', () => {
  const specs = tiptapSpecs();
  const expected = specs[0][1];
  const mismatched: [string, string][] = [];
  for (const [name] of specs) {
    const installed = readJson(
      new URL(`node_modules/${name}/package.json`, root),
    ).version as string;
    if (installed !== expected) {
      mismatched.push([name, installed]);
    }
  }
  expect(
    mismatched,
    `expected every @tiptap package to be ${expected}, found ${JSON.stringify(mismatched)}`,
  ).toEqual([]);
});
