import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { connectSrcFor, withConnectSrc } from './tools/manifestPolicy.mts';

const fromRoot = (p: string) => new URL(p, import.meta.url).pathname;

const pkg = JSON.parse(readFileSync(fromRoot('package.json'), 'utf-8')) as {
  version: string;
};

/**
 * Emits dist/manifest.json from src/manifest.json with the version taken
 * from package.json, so a release bumps the version in exactly one place.
 *
 * It also resolves the manifest's `connect-src`, the one CSP directive that
 * decides which sync server the extension may talk to: the permissive default
 * from tools/manifestPolicy.mts, or the allow list in TABVERSE_ALLOWED_SERVERS
 * for a user who wants to pin the extension to specific servers (ADR 0010).
 */
function extensionManifest(): Plugin {
  return {
    name: 'tabverse:manifest',
    apply: 'build',
    generateBundle() {
      const manifest = JSON.parse(
        readFileSync(fromRoot('src/manifest.json'), 'utf-8'),
      );
      manifest.version = pkg.version;

      const policy = manifest.content_security_policy?.extension_pages;
      if (!policy) {
        this.error(
          'src/manifest.json has no content_security_policy.extension_pages',
        );
      }
      manifest.content_security_policy.extension_pages = withConnectSrc(
        policy,
        connectSrcFor(process.env.TABVERSE_ALLOWED_SERVERS),
      );

      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  // Four pages exist: popup + manager always; icon/devdata are developer
  // tools that must not ship in the store package.
  const input: Record<string, string> = {
    background: fromRoot('src/background.ts'),
    popup: fromRoot('popup.html'),
    manager: fromRoot('manager.html'),
  };
  if (isDev) {
    input.icon = fromRoot('icon.html');
    input.devdata = fromRoot('devdata.html');
  }

  return {
    plugins: [react(), extensionManifest()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'chrome116',
      // readable output while developing; production uses the default
      // minifier (`true`), not 'esbuild' -- the esbuild package is not a
      // dependency of this Vite/Rolldown setup and asking for it fails the
      // build with ERR_MODULE_NOT_FOUND
      minify: !isDev,
      // hidden: the map is emitted but not referenced from the bundle, so
      // it cannot be fetched from inside the store package by accident
      sourcemap: isDev ? true : 'hidden',
      rollupOptions: {
        input,
        output: {
          // the manifest points at background.js, everything else lives in
          // assets/ next to the html pages that reference it
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    css: {
      devSourcemap: isDev,
    },
  };
});
