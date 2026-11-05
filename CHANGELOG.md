# Changelog

## Unreleased — spec stack swap-in
- Timeline frame actions: press and hold (or right-click) a frame or keyframe for **Copy**, **Paste here** and **Delete**, acting on the selected frames/keyframes. After Copy, click any frame to paste there (Esc cancels). Pasting inserts the frames and moves later frames right; nothing is overwritten. Deleting frames closes the gap; deleting a drawing keyframe lets the previous drawing hold through; deleting a tween keyframe removes it. Double-click a keyframe to choose its ease (Linear, Ease in, Ease out, Ease in-out).
- Timeline keyframes: click a drawing keyframe (dot) or tween keyframe (diamond) to select it, Shift/Cmd/Ctrl-click to add more, or drag across frames to select every key inside. Drag a selected key to move all selected keys together by whole frames (one undo step). Moving a drawing key retimes when that drawing starts: the drawing before it holds longer or shorter, and a drawing followed by empty frames moves as a whole. Keys stop at a neighboring key rather than overwriting it, and tween keys stay inside their drawing. Esc clears the selection.
- Combine shapes: with two or more shapes, closed paths or brush strokes selected, the new **Combine shapes** section in Properties (and **Edit › Combine**) offers **Unite** (merge into one shape), **Minus front** (cut the front shapes out of the back one), **Intersect** (keep only the overlap), **Exclude** (keep everything but the overlap) and **Divide** (split along every overlap into separate pieces). Each is one undo step. Results with holes or separate pieces are stored as compound paths (new optional `geometry.subpaths` field).
- Properties panel: every section header is now a button that hides or shows that section, and each section's open/closed state is remembered in this browser. Appearance moved above Animation. The object **Locked** checkbox was removed (layers can still be locked from the timeline).
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
