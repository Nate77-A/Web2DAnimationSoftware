# Known limitations (beta)

- Eraser splits brush strokes or deletes objects; pixel erasing of bitmaps is not available.
- Paint Bucket fills closed vector shapes only.
- Pen paths are created with the Pen tool; editing existing Bézier anchors after creation is not yet available (transform the whole path instead).
- Multi-selection scaling of rotated objects is approximate (no skew in the transform model).
- MP4 requires WebCodecs H.264 (Chrome/Edge 94+, Safari 16.4+); no alpha.
- GIF: 256 colors per frame, 1-bit transparency, browsers clamp very short frame delays.
- CSS-only SVG cannot swap frame-by-frame drawings; use CSS + JavaScript mode.
- Text fonts are not embedded in exports.
- Raster frame rendering for exports runs time-sliced on the main thread; GIF encoding runs in a worker
  (with a main-thread fallback if workers are blocked).
- Out of scope: audio, nested symbols, bone/IK rigs, FLA import, plugins, advanced masks, 3D, scripting, filters, camera, collaboration, cloud sync, phone layout.
