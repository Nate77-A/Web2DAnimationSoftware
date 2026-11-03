// Vite build.
//   vite                          -> dev server on http://localhost:5173
//   vite build                    -> dist/ (multi-file PWA with Workbox service worker)
//   vite build --mode single      -> dist-single/index.html (everything inlined)
//   vite build --mode artifact    -> dist-artifact/index.html (inlined fragment for a claude.ai artifact)
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Single-file builds: no manifest, icon inlined as a data URI. */
function singleFileHtml(): Plugin {
  const icon = fs.readFileSync(new URL('./public/icon.svg', import.meta.url), 'utf8');
  return {
    name: 'single-file-html',
    transformIndexHtml: (html) => html
      .replace(/\s*<link rel="manifest"[^>]*>/, '')
      .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" />`),
  };
}

/** claude.ai artifact: the host supplies doctype/html/head/body, so emit title, style and app only. */
function artifactFragment(outDir: string): Plugin {
  return {
    name: 'artifact-fragment',
    apply: 'build',
    closeBundle() {
      const file = path.join(outDir, 'index.html');
      const html = fs.readFileSync(file, 'utf8');
      // Cut the script out first: the bundle itself contains `<style>` strings (SVG export).
      const jsStart = html.indexOf('<script type="module"'), jsEnd = html.lastIndexOf('</script>') + '</script>'.length;
      const js = html.slice(jsStart, jsEnd);
      const rest = html.slice(0, jsStart) + html.slice(jsEnd);
      const css = rest.slice(rest.indexOf('<style'), rest.indexOf('</style>') + '</style>'.length);
      fs.writeFileSync(file, `<title>2D Animation Studio</title>\n<meta name="theme-color" content="#16191E">\n${css}\n<div id="root"></div>\n${js}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  const single = mode === 'single' || artifact;
  const outDir = artifact ? 'dist-artifact' : single ? 'dist-single' : 'dist';
  return {
    base: './',
    publicDir: single ? false : 'public',
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { port: 5173 },
    build: { outDir, target: ['es2022', 'safari16'] },
    plugins: [
      react(),
      single
        ? [viteSingleFile(), singleFileHtml(), artifact && artifactFragment(path.resolve(outDir))]
        : VitePWA({
          // Registration stays in main.tsx; the manifest is the hand-written public/manifest.webmanifest.
          injectRegister: false,
          manifest: false,
          registerType: 'autoUpdate',
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
            maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
            cleanupOutdatedCaches: true,
          },
        }),
    ],
  };
});
