# 0012 — Parent/child links between objects

**Status:** accepted

## Context
Animators rig characters by making one object follow another: a hand follows an arm, which follows a body.
Children must move, rotate and scale with their parent while still being animatable on their own.

## Decision
- **Model.** `SceneObject.link = { parentId, bind }` (optional and additive, so `schemaVersion` stays 1). A child
  is drawn at `parentWorld × bind × own`, where `bind` is the inverse of the parent's world matrix when the
  link was made. Linking therefore never moves the child, and its own transform and keyframes are untouched
  (the same idea as a "Child Of" constraint with an inverse matrix).
- **Lookup.** The parent is found on the same frame in any layer (`objectAt`). If it isn't on stage, the child
  is drawn on its own there. Chains are followed recursively. Cycles are refused by `linkObject` and guarded
  against in evaluation.
- **Evaluation.** `evaluateLayer(..., project)` resolves links, and every caller passes the project (stage,
  hit testing, eraser, paint merging), so editing, rendering and raster exports agree. The animated SVG export
  uses `worldMatrix` per frame and treats a child as animated when its parent moves.
- **Editing.** The select/transform tools work in document space: `DragOrig.t` is a linked child's on-stage
  transform (`transformIn(parentSpace, own)`), and results are converted back with the inverse parent space.
  Nudge uses `ownDelta`. Decomposition is exact for rotation, uniform scale and flips; a skew from a
  non-uniformly scaled, rotated parent is approximated.
- **Unlinking** (`unlinkObject`) bakes the on-stage transform into the child's own transform, and each keyframe
  at its own frame, so nothing moves. Deleting or combining a parent releases its children this way
  (`releaseChildren`). Copies (`cloneObjects`) re-point links inside the copied batch, and pasting doesn't
  offset children that come with their parent.
- **UI.** Window › Linked Objects is a floating, draggable window (position remembered per browser) with a tree
  of the current frame's objects by layer. Dragging a row onto another links it; dropping on a layer name or
  using the row's unlink button unlinks it. Invalid drops (itself, its descendants) are shown in red. Properties
  shows "Follows …" with an Unlink button. Dashed lines on stage show links while the window is open.

## Consequences
- Children don't inherit opacity, and links are per drawing keyframe.
- Removing a parent by deleting frames or erasing it falls back to drawing the child on its own (no bake).
- Not yet supported: a keyboard way to link, and locking a child's rotation or scale independently of its parent.
