# 0009 — Path edit mode

**Status:** accepted

## Context
Users need to reshape existing vector artwork point by point: move anchors, adjust Bézier handles, bend the
path between anchors, and switch anchors between sharp and smooth. The project holds three kinds of path-like
objects: pen paths (`path`, Bézier segments), parametric shapes (`shape`), and brush strokes (`path` with
`brush` samples, whose geometry is a closed outline of several hundred points).

## Decision
- **Entry/exit.** Double-click with the Select or Move/Rotate/Scale tool, or **Edit points** in Properties.
  Esc, Enter, clicking away, switching tools, deselecting, playback or the object leaving the stage exits.
  State lives in `AppState.pathEdit`; the controller is `src/editor/pathEditTool.ts`.
- **What is edited** (`src/editor/pathEdit.ts`):
  - pen path: its segments;
  - shape: its outline, converted to a `path` (same id, style, transform, keyframes) on the first edit;
  - brush stroke: a **centerline** ("spine"). Editing the outline would mean dragging hundreds of points and
    breaking the variable width. The spine is fitted once from the samples with Paper.js `simplify()`. Each
    edit re-lays the samples along the new spine by arc length (pressure, tilt and time keep their relative
    position) and rebuilds the outline with the normal brush code.
- **Schema.** `brush.spine` is an optional, additive field, so `schemaVersion` stays 1 and older files load as-is.
  It is stored so that re-entering edit mode shows the same anchors instead of a fresh fit. The eraser drops it
  when it splits a stroke, and the next edit fits a new spine from the pieces.
- **Gestures.** Bending moves the curve's two inner control points in proportion to their weight at the grabbed
  parameter, so the grabbed point tracks the pointer exactly (`bendCurve`). A smooth anchor's opposite handle
  stays collinear whenever one side changes, unless Alt is held. Holding an anchor still for 500 ms toggles
  sharp ↔ smooth. New smooth handles lie along the neighbor-to-neighbor line, each a third of the distance to
  that neighbor. Every drag or toggle is one undoable gesture.
- **Adding and deleting anchors.** Double-clicking the path splits that curve at the clicked parameter
  (de Casteljau), so the path keeps its exact shape. A straight curve gets a sharp anchor, a curved one gets
  the split's smooth handles. Double-clicking an anchor shows an X button beside it. The X deletes the anchor
  (a path keeps at least two), and any other press, or Esc, only hides it. Double-clicks are counted only
  from presses made inside edit mode, so the double-click that entered edit mode can't combine with the
  next press.
- Geometry is edited in the object's local space through the inverse of its evaluated matrix, so rotated,
  scaled or tweened objects edit correctly. The transform and keyframes are untouched.

## Consequences
- The pure operations live in `src/domain/pathEdit.ts` and are unit tested; e2e covers the full flow.
- Not yet supported: opening a closed path or closing an open one.
