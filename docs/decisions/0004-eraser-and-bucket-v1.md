# 0004 — Eraser and Paint Bucket semantics (version one)

**Status:** accepted · **Stage:** 2E

**Eraser**
- *Split strokes* (default): brush strokes store their processed centerline samples (position, pressure, tilt,
  time). The swept eraser circles are mapped into each stroke's local space; samples inside a circle are removed
  and each surviving run becomes its own stroke with a regenerated outline. Shapes, pen paths, text and bitmaps are untouched.
- *Delete objects*: any object the eraser touches is removed.
- *Erase all layers* is off by default (active layer only). Locked layers/objects are never affected.
- Pixel erasing of imported bitmaps is deferred and stated in the UI.

**Paint Bucket**
- Fills a closed shape, closed path, or text with the current fill paint (solid, linear or radial).
- Open paths show a message explaining how to close them; bitmaps show "pixel fill not available".
- Raster boundary flood-fill is a separate future subsystem.
