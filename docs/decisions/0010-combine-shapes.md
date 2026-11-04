# 0010 — Combine shapes (boolean operations)

**Status:** accepted

## Context
Users want to merge, cut and intersect vector objects. Results can have holes (a square minus a smaller
square) or several separate pieces, but a path object held exactly one outline.

## Decision
- **Operations** (`src/editor/combine.ts`, Paper.js path booleans):

  | Option | Result | Style taken from |
  |---|---|---|
  | Unite | Union of all outlines | front object |
  | Minus front | Back object minus the union of the others | back object |
  | Intersect | Area covered by every object | front object |
  | Exclude | Union minus overlaps (XOR) | front object |
  | Divide | Every overlap region as its own object | the object on top in that region |

  "Front" and "back" follow the stacking order across layers on the current frame.
- **Inputs.** Shapes, closed paths and brush strokes (their filled outlines). Text, images, groups, open paths
  and locked objects are refused with a specific reason, shown in the panel and as a toast.
- Objects are combined in document space through their evaluated matrix on the current frame, so rotated,
  scaled or tweened objects combine as they look. The result is a new path with an identity transform and no
  keyframes. It replaces the front object (the back object for Minus front), keeping its stacking position and
  layer; the other inputs are removed. The whole operation is one undoable command.
- **Compound paths.** `geometry.subpaths` (optional, additive: `schemaVersion` stays 1) holds outlines after the
  first. Rendering, hit testing (Paper `CompoundPath`), bounds and SVG export read all outlines. Results use
  the even-odd fill rule so holes render correctly whatever direction Paper winds them. Path edit mode is
  disabled for compound paths for now.

## Consequences
- Fragments smaller than 0.01 square document units are dropped.
- Not yet supported: point-editing compound paths, a non-destructive "compound path" grouping, and carrying
  animation over to the result.
