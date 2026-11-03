# 0006 — Fonts

**Status:** accepted · **Stage:** 2D / 5D

- The text tool offers a web-safe family list (`FONT_FAMILIES` in `domain/defaults.ts`) plus generic families.
- Availability is detected by width comparison against generic fallbacks; a missing family shows a visible
  warning in the Typography panel and renders with the browser fallback (same in raster exports).
- Fonts are **not** embedded in SVG exports; the analyzer warns when text is present.
- Letter spacing uses `CanvasRenderingContext2D.letterSpacing` where available and per-glyph placement otherwise.
