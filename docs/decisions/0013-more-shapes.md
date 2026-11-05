# 0013 — Stars, null objects and emoji faces

**Status:** accepted

## Context
The Shape tool drew rectangles, ellipses, triangles and polygons. Users asked for stars, an After Effects-style
null object for rigging, and emoji faces, plus a quick way to pick between shapes.

## Decision
- **Star** is a shape type (`geometry.shape = 'star'`). Its point count reuses `sides`, and the optional
  `geometry.star = { outer, inner, scale }` holds the outer and inner radii as fractions of the half box size,
  plus a multiplier for both. Older files without it get `DEFAULT_STAR`. All fields are additive, so
  `schemaVersion` stays 1.
- **Null** is a shape type too (`'null'`), so it gets transforms, keyframes, selection, links and undo for free.
  `drawSource` draws it only when `RenderOptions.guides` is set: on the stage and in Linked Objects thumbnails.
  Onion skins, raster exports, the eyedropper and the SVG export never set `guides`, and the SVG writer also
  skips nulls explicitly, so a null can never appear in output. It is drawn as a green box with crosshairs at
  about 1.5 screen pixels whatever the zoom. It is picked anywhere inside its box, and is refused by Combine,
  the paint bucket and point editing.
- **Emoji** (`'smiley'`, and `'glasses'` for the sunglasses face) are not shape types. They are groups of ordinary shapes and paths laid out in a
  100×100 box (`emojiObject`), scaled by the group transform to the dragged size, and marked
  `metadata.emoji`. They need no special support in rendering, export, hit testing or links.
- **UI.** `SHAPE_CHOICES` drives the Shape tool options, a selected shape's type switcher (which offers only
  `SWITCHABLE_SHAPES`, since nulls and emoji are different kinds of object), and the tool rail's
  hold-for-shapes pop-up. Holding the Shape tool for 450 ms, or right-clicking it, opens the pop-up. Its icon
  shows the current shape, with a corner mark for the hidden choices.

## Consequences
- Emoji colors are fixed until groups can be ungrouped or edited part by part.
