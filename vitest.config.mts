import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        // Unit tests must run against the in-memory database. src/storage/db
        // statically imports './dbImpl'; the alias swaps in the fake-indexeddb
        // implementation so the real one is never constructed under test.
        find: /^\.\/dbImpl$/,
        replacement: fileURLToPath(
          new URL('./src/dev/dbImplTest.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      // build time policy that decides which server the extension may talk to
      // (ADR 0010); it lives in tools/ because it never ships in the bundle
      'tools/**/*.test.mts',
      // the server console (adr/0018): its data layer in a node environment,
      // and its views rendered to static markup, which needs no DOM
      'server/ui/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      // The console's views are checked by what they render (ADR 0018), not by
      // line coverage, and a coverage number on generated markup says nothing
      // an operator would act on. The data layer is not excluded - it is where
      // the logic is.
      exclude: ['server/ui/**/*.tsx', 'server/ui/main.tsx'],
    },
  },
});
