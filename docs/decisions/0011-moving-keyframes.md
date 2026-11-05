# 0011 — Selecting and moving timeline keyframes

**Status:** accepted

## Context
The timeline shows two kinds of keys on each layer: **drawing keys** (where an exposure span starts) and
**tween keys** (motion-tween keyframes of the objects in a span). Animators need to select one or several
of them and drag them to retime the animation.

## Decision
- **Selection** is `AppState.keySelection: KeyRef[]` (`{ layerId, frame, kind }`). Click selects a key,
  Shift/Cmd/Ctrl-click toggles one, and dragging a frame range selects every key inside it. Esc clears.
  Hit testing: a diamond's frame in the lower part of a row is the tween key; a span's first frame is its
  drawing key.
- **Moving** (`src/domain/keyframes.ts`, pure and unit tested). Every selected key moves by the same whole-frame
  delta:
  - A drawing key moves its span's start. A span that ran up to the next drawing still runs up to it, so the
    previous drawing holds longer or shorter and the following drawing is untouched. A span followed by empty
    frames, or the last span, keeps its length and moves as a whole.
  - Tween keys move with their span when it moves as a whole; otherwise only the key on the span's first frame
    follows the drawing key. A selected tween key moves within its span.
  - A move is rejected if keys would change order, overlap, go before frame 1, or leave a tween key outside its
    drawing. While dragging, `clampedMove` applies the largest allowed step toward the pointer, so the drag
    stops at the obstacle, and a one-time message explains why.
- A drag is one gesture: live preview, one undo step ("Move keyframe(s)"). The duration grows if keys move
  past the end.

## Copy, paste, delete and ease (addendum)
- **Hold menu.** Pressing still for 500 ms (or right-clicking) on a frame or keyframe opens Copy / Paste here /
  Delete (plus Ease… for a single tweened key). It acts on the selected keyframes when a selected key was
  pressed, otherwise on the frame range under the pointer, otherwise on that one frame.
- **Copy** (`src/domain/timelineClipboard.ts`) stores a clip in `AppState.timelineClip` and arms click-to-paste
  (`pasteArmed`), shown by a banner. Frames copy each layer's drawings clipped to the range. Drawing keys copy
  their whole drawing. Tween keys alone copy their values, which paste onto the same objects inside their
  drawing.
- **Paste** inserts at the clicked frame on the clicked layer (and the layers below it for multi-layer clips).
  Later frames shift right, and a drawing cut by the paste point continues after the pasted frames as its own
  copy, so nothing is overwritten. Pasted objects are independent copies with new ids. Locked layers are skipped.
- **Delete**: frames are removed and later frames move left. A drawing key is cleared, so the previous
  contiguous drawing holds through its frames (frames become empty if there is none). A tween key is removed
  from every object keyed on it.
- **Ease**: double-clicking a keyframe opens an ease menu that sets the ease of every object keyed on that frame
  (for a drawing key, the tween key on its first frame). The double-click is confirmed on release, so a quick
  click-then-drag still moves the key.

## Per-object rows (addendum)
- Layers with motion tweens can be expanded (`AppState.expandedLayers`) to show one row per animated object
  (`objectTracks`: the object's keys inside its drawing, in time order then front-most first). Rows sit below
  their layer row in both the layer list and the frames canvas, and every row-based calculation (hit testing,
  ranges, drawing) uses this combined row list.
- A tween key may carry `objectId`. Without it, the key is the layer row's combined diamond and acts on every object
  keyed on that frame. With it, `moveKeys`, `copyKeys`, `deleteKeys`, `keyEase` and `setKeyEase` act on that
  object only. Clicking an object row away from its keys selects the object.

## Consequences
- Keys never overwrite each other, so a drag can't lose work. To swap two drawings, move one aside first.
- Not yet supported: copying keys with a modifier-drag, moving keys between layers, nudging with arrow keys.
