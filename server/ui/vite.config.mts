import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The console's build (adr/0018).
 *
 * Same toolchain as the extension, its own config: the output goes straight
 * into the Go package that embeds it (`server/internal/webui/dist`), so
 * `go build` and this build are two halves of one artifact. Nothing here is
 * committed - the Go targets run `pnpm run ui:build` first, and the console
 * job in CI does the same.
 *
 * The URL space is the one ADR 0009 established, now under the console's own
 * prefix (adr/0023): the Go handler serves the shell at `/console` and its
 * files at `/console/assets/<name>`. `base` is what makes the emitted
 * `index.html` point there, and the entry/asset name patterns keep the files at
 * the root of the output so `/console/assets/<name>-<hash>.js` is the whole
 * story for the embed.
 */
const fromUi = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  return {
    // The project's own directory: the shell and every source live under it.
    root: fromUi('.'),
    plugins: [react()],
    // Production is served from /console/assets/, which is where the Go handler
    // looks; the dev server serves from /console/ so the page sits at the same
    // path it does in production and its /api and /auth calls can be proxied to
    // a real tabversed.
    base: isDev ? '/console/' : '/console/assets/',
    build: {
      outDir: fromUi('../internal/webui/dist'),
      emptyOutDir: true,
      target: 'es2022',
      // readable output while developing; production uses the default minifier
      minify: !isDev,
      // readable output while developing; production emits no map at all. The
      // console's build output is embedded in the Go binary, so a hidden map
      // would ship ~3 MB of source inside every deployment for no one to read.
      sourcemap: isDev,
      rollupOptions: {
        input: fromUi('index.html'),
        output: {
          entryFileNames: '[name]-[hash].js',
          chunkFileNames: '[name]-[hash].js',
          assetFileNames: '[name]-[hash][extname]',
        },
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      // A console is never useful without a server behind it: /api and /auth
      // go to a local tabversed, everything else is this project.
      proxy: {
        '/api': 'http://127.0.0.1:8223',
        '/auth': 'http://127.0.0.1:8223',
      },
    },
  };
});
