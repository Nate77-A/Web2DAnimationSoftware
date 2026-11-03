# 0003 — Commands, gestures and undo

**Status:** accepted · **Stage:** 0 / 2

- Every user-visible mutation is a pure `Project -> Project` function from `src/domain/ops.ts`, recorded by
  `commit(label, fn, affectedIds)` as a `Command { id, label, before, after, affectedIds, timestamp }`.
- `before`/`after` are immutable project snapshots with structural sharing: deterministic data, no closures,
  cheap to keep (history limit 200).
- Continuous interactions (drawing, dragging handles, erasing) use **gestures**: `beginGesture` → `updateGesture`
  previews from the same base → `endGesture` records exactly one command; `cancelGesture` restores the base.
- Rapid numeric edits (scrubbing a field, dragging a color slider) use `commitMerge`, which folds edits with the
  same label and targets within 1.2 s into one command so a single undo returns to the pre-drag value.
- Undo/redo re-select the affected objects when they still exist.
- Auto-key: if an object has keyframes, transform/opacity edits write a keyframe at the playhead instead of the base transform.
