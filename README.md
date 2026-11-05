# 2D Animation Studio

A browser-first, offline-capable 2D drawing and animation editor. It has a vector scene model, a purpose-built
timeline and pressure-aware Pointer Events input, all in a modern dark theme. It is built from the
*2D Animation Studio Product Specification* and follows the staged *Claude Build Process*. Stages 0–5 are implemented,
and Stage 6 hardening is partly done: there is a regression suite, an accessibility pass and a manual device matrix.

## Run it

```bash
npm install          # React, Paper.js, Zustand, Dexie, Zod, JSZip; Vite, TypeScript, tsx, Playwright for dev
npm run dev          # Vite dev server on http://localhost:5173 with HMR
npm run build        # dist/  — static PWA (Workbox service worker + manifest), deploy anywhere
npm run preview      # serve the production build locally
npm run build:single # dist-single/index.html — everything inlined in one file
npm run check        # typecheck (app + tests) + unit tests + production build
npx playwright install chromium     # once, to download the test browser
npm run build && npm run test:e2e   # Playwright desktop workflows (85 checks)
npm run build && npm run test:visual  # desktop + iPad-sized screenshots into test-results/
```

No server is required. After the first load, the PWA build works offline.

## Deploy to GitHub Pages

`.github/workflows/deploy-pages.yml` typechecks, tests and builds the app, then publishes `dist/` to GitHub Pages
on every push to `main` (it can also be run by hand from the Actions tab). The build uses relative asset paths,
so it works at `https://<user>.github.io/<repo>/` without any extra configuration.

One-time setup: push this folder to a GitHub repository, then open **Settings → Pages → Build and deployment**
and set **Source** to **GitHub Actions**.

## What's in the first release

| Area | Features |
|---|---|
| Workspace | Floating Linked Objects window (Window menu) for parent/child links between objects. Top bar (File / Edit / View / Timeline / Window menus with shortcuts, undo/redo, project name, autosave status, Export). The tool rail has 12 tools plus fill/stroke swatches. Panels show and hide from the Window menu. Properties are context-sensitive. A resizable timeline is docked below |
| Stage | Artboard on a pasteboard with a transparency checkerboard. Zoom runs from 12.5 % to 3200 %, anchored at the pointer. The `125%` zoom field and `1920 × 1080` size popover sit top-right. Fit to stage, Space/middle/finger pan, two-finger pinch, center and safe-area guides, onion skin, and coordinate debug markers |
| Tools | Select, Move/Rotate/Scale (constant-size handles; Shift and Alt modifiers; pivot; flip; reset). Path edit mode: double-click a path, shape or brush stroke to drag anchors and handles, bend the path between anchors, double-click to add or delete anchors, and hold an anchor to toggle smooth/sharp. Combine shapes: Unite, Minus front, Intersect, Exclude and Divide. Brush (pressure, tilt, smoothing, caps, opacity). Paint Brush (paints fills with the fill color; same-color strokes merge into one shape). Eraser (split brush strokes and rub out Paint Brush paint / delete objects, all-layers toggle). Shape (rectangle with corner radius, ellipse, triangle, N-sided polygon). Pen (Bézier, click-drag handles, Enter finishes / Esc cancels). Text (in-place editing with full typography). Paint Bucket, Eyedropper, Hand, Zoom |
| Color | Solid, linear and radial paints, RGBA/hex input, alpha, a gradient stop editor (drag, keyboard, add/remove), recent colors |
| Bitmaps | PNG/JPEG/WebP import by menu or drag-and-drop. Input is validated by magic bytes, size and dimensions, and identical images are stored once using a SHA-256 hash. Images are stored offline in IndexedDB |
| Timeline | Keyframes (drawing dots and tween diamonds) can be selected by click, Shift-click or drag, and dragged to retime them. Layers can be added, deleted, duplicated, reordered (drag or buttons), renamed, hidden, locked, soloed and given a blend mode. Frames use exposure spans: insert (F5), delete (Shift+F5), duplicate (F6), blank (F7), clear, range selection. Motion tweens key position, scale, rotation and opacity, with linear and ease presets and auto-key. Playback has loop, a clickable `24 fps` control with presets and custom values, a timeline zoom slider, fit-selection and `=`/`-` |
| Persistence | Debounced autosave keeps the last known-good copy and recovers from corrupt data without overwriting it. There is a project catalog, and native `.anims` Open / Save / Save As (ZIP of manifest plus assets, validated on open) |
| Export | PNG (single frame or ZIP sequence, alpha, size, range, compression level). Animated GIF (palette quality, loop, transparency, warnings, encoded in a worker). MP4 (WebCodecs H.264, support shown before export). Animated SVG (capability analyzer, CSS-only or CSS+JS, fixed/responsive, crop to artboard, embedded bitmaps with global and per-bitmap compression). Every export renders from the same pure evaluator as the stage preview |

## Architecture

```
.github        GitHub Pages deploy workflow
public         Static files copied as-is (icon, web app manifest)
scripts        Playwright e2e and screenshot scripts, static server for dist/
src/domain     Versioned ProjectV1 schema (Zod), migrations, pure timeline evaluator, geometry, brush, immutable ops
src/editor     Zustand store + command history, Stage Adapter (Paper.js geometry + Canvas2D), input coordinator, tools, hit testing
src/timeline   Timeline UI and requestAnimationFrame playback
src/features   IndexedDB persistence (Dexie), assets, .anims format, exporters (png/gif/mp4/svg)
src/workers    GIF encoder worker (typed message contract)
src/app        Shell: top bar, menus, tool rail, properties panel, dialogs, theme tokens
src/test       Unit tests (schema/migrations, evaluator fixtures at frames 1/12/24, frame ops, history, GIF/MP4 contracts)
docs/decisions Architecture decision records
docs/spec      Product specification and build process (.docx)
```

Key rules from the build process are enforced in code:

- The project schema is the contract. The renderer is never serialized.
- Every mutation is an undoable command.
- Exports consume `evaluateFrame(project, frame)`, not screenshots of the viewport.

Paper.js, Vite, Zustand and Dexie are now in place behind the original seams. ffmpeg.wasm, a GIF library,
Vitest and ESLint are still substituted; see `docs/decisions/0001-stack-and-substitutions.md`.

## Docs

- `docs/decisions/` — stack, file format, history, eraser and bucket semantics, MP4 path, fonts, SVG feature matrix, input arbitration
- `docs/known-limitations.md`
- `docs/manual-test-matrix.md` — iPad Pencil and device checks that automation can't cover
- `CHANGELOG.md`
