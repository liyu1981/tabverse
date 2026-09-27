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
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
