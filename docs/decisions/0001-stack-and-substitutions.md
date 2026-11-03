# 0001 — Application stack and dependency substitutions

**Status:** accepted · **Stage:** 0

## Context
The product specification selects React + TypeScript + Vite (PWA), Paper.js behind a Stage Adapter,
Zustand, Dexie, Zod, Web Workers, a GIF encoder and ffmpeg.wasm. The first build ran in an environment
whose package registry was unreachable; only React 19, Zod, esbuild, TypeScript, JSZip and Playwright
were available locally.

## Decision
Keep every architectural boundary the spec asks for, and substitute small in-house modules where a
package could not be installed. Each substitute sits behind the same seam the package would have used.

| Spec choice | Used here | Seam / how to swap back |
|---|---|---|
| Vite PWA | **Swapped in.** `vite.config.ts` with `vite-plugin-pwa` (Workbox `generateSW`) and `vite-plugin-singlefile` for single-file/artifact modes | Hand-written manifest kept in `public/`; SW registration stays in `main.tsx` |
| Paper.js | **Swapped in** for geometry. `src/editor/paperAdapter.ts` maps schema segments to `paper.Path` one-to-one. The renderer draws `Path2D(path.pathData)` on Canvas2D, and `scene.ts` hit tests with `contains` / `getNearestPoint` | Raster output stays Canvas2D so exports keep working on `OffscreenCanvas` and in workers, which Paper's view cannot target. Paths are never inserted into a Paper project |
| Zustand | **Swapped in.** `src/editor/store.ts` wraps `zustand/vanilla` + `useStore`/`useShallow` | The `get/set/subscribe` facade is kept so call sites didn't change; `store.api` exposes the raw Zustand store |
| Dexie | **Swapped in.** `src/features/db.ts` defines a `Dexie` subclass with the same DB name, stores and key paths | Repository functions `db.getProject/putProject/...` unchanged |
| GIF encoder library | `src/features/export/gifEncoder.ts` (median-cut + LZW, unit tested with a decoder) | `encodeGif(frames, options)` |
| ffmpeg.wasm | WebCodecs `VideoEncoder` + `mp4Muxer.ts` | See ADR 0005 |
| Vitest | `node:test` via `tsx` (`npm test`) | Test files use `describe/it` + `assert`; port is mechanical |
| ESLint + typescript-eslint | Not run (plugins unavailable); `tsc --strict` with `noUnused*` is the gate | Add ESLint when installing deps |
| @types/react | **Swapped in.** Shim removed; `src/vite-env.d.ts` holds Vite client types and `__APP_VERSION__` | — |
| React Aria | Hand-written ARIA patterns (menubar/menu, toolbar roving focus, radiogroup, dialogs with focus trap) | Components in `src/app/` |

Update (spec stack swap-in): with the registry reachable, Vite, Paper.js, Zustand, Dexie and the React
types replaced their substitutes. The remaining rows are still substitutes.

## Consequences
- The editor is fully functional and offline-capable with no runtime dependencies beyond React, Zod and JSZip.
- Paper.js adoption later is a contained change to `renderer.ts` + `scene.ts` hit testing.
- Lint is a follow-up item when the registry is reachable.
