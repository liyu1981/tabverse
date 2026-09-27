import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '.vscode/**',
      // generated artifacts: build output, built docs site, test coverage
      'dist/**',
      'dist_crx/**',
      'docs/**',
      'doc/**',
      'coverage/**',
      // Go server, linted by `go vet` / `gofmt` in CI instead
      'server/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
    },
    rules: {
      // TypeScript does a better job than core rules for these, and the core
      // versions produce false positives on overloads/generics.
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-undef': 'off',

      // `cond && doThing()` / `a ? b() : c()` are idiomatic in this codebase.
      // typescript-eslint ships its own variant, so configure both.
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      'no-control-regex': 'off',
      // New in ESLint 10 and full of dead-store cleanups that need manual
      // review; deferred (see ARCHITECTURE.md follow-ups).
      'no-useless-assignment': 'off',

      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // keep formatting concerns out of ESLint; prettier owns them
  prettierConfig,
);
