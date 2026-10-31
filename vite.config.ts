import { defineConfig, type Plugin } from 'vite';

// Chrome refuses ES modules and crossorigin assets on file:// pages. Emitting the app as a
// classic (IIFE) script lets dist/index.html be opened by double-click, fully offline.
const fileProtocolFriendly: Plugin = {
  name: 'file-protocol-friendly',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml(html) {
    return html
      .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
      .replace(/ crossorigin/g, '');
  },
};

export default defineConfig({
  base: './',
  plugins: [fileProtocolFriendly],
  server: { port: 5173, open: true },
  build: {
    target: 'es2022',
    modulePreload: false,
    rollupOptions: { output: { format: 'iife' } },
  },
});
