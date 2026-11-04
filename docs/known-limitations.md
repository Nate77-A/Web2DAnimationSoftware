# Known limitations (beta)

- Eraser splits brush strokes or deletes objects; pixel erasing of bitmaps is not available.
- Paint Bucket fills closed vector shapes only.
- Combining shapes creates a new object as it looks on the current frame: keyframes and tweens of the originals are not carried over. Combined shapes with holes or several pieces can't be point-edited yet.
- Editing a shape's points turns it into a plain path, so its shape options (corner radius, polygon sides) no longer apply.
- Brush strokes are edited along a fitted centerline; the stroke is re-drawn along it, so very fine wobbles in the original stroke are smoothed out by the first edit.
- Multi-selection scaling of rotated objects is approximate (no skew in the transform model).
- MP4 requires WebCodecs H.264 (Chrome/Edge 94+, Safari 16.4+); no alpha.
- GIF: 256 colors per frame, 1-bit transparency, browsers clamp very short frame delays.
- CSS-only SVG cannot swap frame-by-frame drawings; use CSS + JavaScript mode.
- Text fonts are not embedded in exports.
- Raster frame rendering for exports runs time-sliced on the main thread; GIF encoding runs in a worker
  (with a main-thread fallback if workers are blocked).
- Out of scope: audio, nested symbols, bone/IK rigs, FLA import, plugins, advanced masks, 3D, scripting, filters, camera, collaboration, cloud sync, phone layout.
