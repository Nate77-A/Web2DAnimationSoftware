# Changelog

## Unreleased — spec stack swap-in
- Path edit mode: double-click a pen path, shape or brush stroke with the Select tool (or use **Edit points** in Properties) to edit its points. Drag anchors (Shift-click for several; Shift-drag locks to an axis), drag handles (smooth anchors stay smooth; Alt breaks them), drag the path between two anchors to bend it, and hold an anchor for half a second to toggle it between sharp and smooth. Double-click the path to add an anchor there (the shape doesn't change), or double-click an anchor to show an X button that deletes it; clicking anywhere else hides the button. Delete also removes selected anchors, arrow keys nudge them, and Esc/Enter or clicking away finishes. Shapes become paths on their first edit. Brush strokes are edited along a fitted centerline (stored as the new optional `brush.spine` field) and re-drawn with their original pressure.
- Fix: Esc never reached the app while the timeline was visible (the closed frame-rate popover swallowed it), so it could not cancel a pen path, finish text editing or deselect.
- Fix: long stage-header hints could push the window layout wider than the screen.
- Hover help: every button now shows a tooltip with its name, keyboard shortcut and a one-line explanation of what it does. Tooltips also appear on keyboard focus and stay inside the window (`src/app/Tooltip.tsx`; buttons use `data-tip`, `data-tip-keys` and `data-tip-desc`).
- Repo layout: the project now lives at the repository root (previously `WorkingFiles/`). The spec documents moved to `docs/spec/`, and generated builds plus `.DS_Store` files were removed. Added `.gitignore`.
- Deploy: a GitHub Actions workflow publishes the PWA build to GitHub Pages.
- Scripts: `typecheck` also checks the tests; added `test:visual`. The e2e select-all keystroke now works on macOS.
- Build: Vite replaces the esbuild script. `vite-plugin-pwa` (Workbox) replaces the hand-written service worker, and `vite-plugin-singlefile` produces `build:single` / `build:artifact`. `index.html` moved to the project root. Added `npm run preview`.
- State: the editor store runs on Zustand (vanilla store + `useStore`/`useShallow`); the `store.get/set/subscribe` facade and `useSelector` are unchanged.
- Persistence: the IndexedDB repository runs on Dexie, with the same database name, stores and key paths, so existing autosaves open as-is (the IDB version becomes 10, which is Dexie's ×10 scheme).
- Stage Adapter: vector paths are built as Paper.js paths (rendered via `Path2D` from Paper path data), and hit testing uses Paper's `contains` / `getNearestPoint` in place of a scratch canvas.
- Types: real `@types/react` / `@types/react-dom`; the React typing shim is removed.
- Bundle grew from ~585 KB to ~910 KB minified (~290 KB gzip), mostly Paper.js.

## 0.1.0 — first usable beta
- Stage 0: Dark shell, ProjectV1 schema with migrations and Zod validation, IndexedDB autosave with recovery, File/Window menus.
- Stage 1: Viewport (pan/zoom 12.5–3200 %), Pointer Events coordinator (pen/mouse/touch), tool registry and contextual properties.
- Stage 2: Select/transform, shapes, brush with pressure/tilt, pen Bézier paths, text, eraser and bucket v1, undo/redo for every mutation.
- Stage 3: Bitmap import with hashing and offline storage, solid/gradient paints, eyedropper.
- Stage 4: Layers (visibility/lock/solo/blend/reorder), exposure-span frames, motion tweens with eases, playback, fps, onion skin.
- Stage 5: PNG sequence, animated GIF (worker), MP4 (WebCodecs), animated SVG with capability analyzer; native .anims save/open.
- Stage 6 (partial): 32 unit tests, 33-check Playwright workflow suite, accessibility pass, manual device matrix.
