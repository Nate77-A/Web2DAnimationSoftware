# 0007 — Animated SVG supported-feature matrix

**Status:** accepted · **Stage:** 5D

| Feature | CSS only | CSS + JavaScript |
|---|---|---|
| Static vector shapes, paths, strokes, dashes | ✓ | ✓ |
| Solid / linear / radial fills (userSpaceOnUse gradients) | ✓ | ✓ |
| Text (fonts not embedded) | ✓ | ✓ |
| Bitmaps (embedded data URIs, global + per-bitmap compression) | ✓ | ✓ |
| Tweened position / rotation / scale / opacity | ✓ (per-frame CSS keyframes, linear between frames) | ✓ (exact per-frame values) |
| Frame-by-frame drawings / exposure changes / path changes | ✗ — analyzer blocks export and explains | ✓ (visibility swaps) |
| Layer blend modes | ✓ (`mix-blend-mode`) | ✓ |
| Crop to artboard | ✓ (clipPath) | ✓ |
| Fixed or responsive sizing | ✓ | ✓ |

The analyzer (`analyzeSvg`) runs before export and lists every unsupported item. Exports never reference
network resources. Source assets are never modified by bitmap compression.
