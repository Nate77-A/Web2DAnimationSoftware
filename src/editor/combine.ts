// Combine shapes: boolean operations on two or more selected vector objects (Paper.js path booleans).
// Objects are combined as they look on the current frame (their evaluated matrix), and the result is a new
// path in document space. Results that leave holes or separate pieces become compound paths (geometry.subpaths).
//
//   unite      merge everything into one outline                         style of the front object
//   subtract   cut every front object out of the back object             style of the back object
//   intersect  keep only the area every object covers                    style of the front object
//   exclude    keep everything except where objects overlap (holes)      style of the front object
//   divide     split along every overlap into separate pieces            each piece: style of the top object there
import paper from 'paper/dist/paper-core';
import { identityTransform } from '../domain/defaults';
import { brushOutline } from '../domain/brush';
import { evaluateLayer, type EvalObject } from '../domain/evaluator';
import { releaseChildren } from '../domain/links';
import { objectSubpaths, segmentsBounds, type Subpath } from '../domain/geometry';
import { newId } from '../domain/ids';
import { invert, unionRects } from '../domain/math';
import { removeObjects, replaceObject } from '../domain/ops';
import type { BrushSample, PathObject, Project, SceneObject } from '../domain/schema';
import { segmentsToPaper, subpathsToPaper, type PaperShape } from './paperAdapter';
import { frameObjects } from './scene';
import { commit, getState, store, toast, type AppState } from './state';

export type CombineOp = 'unite' | 'subtract' | 'intersect' | 'exclude' | 'divide';

export const COMBINE_OPS: { id: CombineOp; label: string; command: string; help: string }[] = [
  { id: 'unite', label: 'Unite', command: 'Unite shapes', help: 'Merge the selected shapes into one shape that covers all of them. Takes the front shape’s style.' },
  { id: 'subtract', label: 'Minus front', command: 'Minus front', help: 'Cut the shapes in front out of the shape at the back. Keeps the back shape’s style.' },
  { id: 'intersect', label: 'Intersect', command: 'Intersect shapes', help: 'Keep only the area where all the selected shapes overlap. Takes the front shape’s style.' },
  { id: 'exclude', label: 'Exclude', command: 'Exclude overlap', help: 'Keep everything except where the shapes overlap, which becomes a hole. Takes the front shape’s style.' },
  { id: 'divide', label: 'Divide', command: 'Divide shapes', help: 'Cut the shapes apart along every overlap into separate pieces you can move or recolor. Each piece keeps the style of the shape on top there.' },
];

const MIN_AREA = 0.01; // document units²; smaller fragments are discarded

/** The selected objects, back to front, if they can be combined; otherwise a reason to show the user. */
export function combineTargets(s: AppState = getState()): { ok: true; items: EvalObject[] } | { ok: false; reason: string } {
  if (s.selection.length < 2) return { ok: false, reason: 'Select two or more shapes to combine them.' };
  const set = new Set(s.selection);
  const items = frameObjects(s, {}).filter((eo) => set.has(eo.source.id)).reverse();
  if (items.length < 2) return { ok: false, reason: 'Select two or more shapes on the current frame.' };
  for (const { source: o } of items) {
    if (o.kind === 'text') return { ok: false, reason: 'Text can’t be combined. Deselect it to combine the other shapes.' };
    if (o.kind === 'bitmap') return { ok: false, reason: 'Images can’t be combined. Deselect them to combine the other shapes.' };
    if (o.kind === 'group') return { ok: false, reason: 'Groups can’t be combined.' };
    if (o.kind === 'path' && !o.geometry.closed) return { ok: false, reason: `“${o.name}” is an open path. Close it first (Pen: click its first point).` };
    if (o.locked) return { ok: false, reason: `“${o.name}” is locked.` };
  }
  return { ok: true, items };
}

/** Object outline in document space, as drawn on the current frame. */
function toPaper(eo: EvalObject): PaperShape {
  const item = subpathsToPaper(objectSubpaths(eo.source)!);
  item.fillRule = eo.source.style.fillRule;
  const [a, b, c, d, tx, ty] = eo.matrix;
  item.transform(new paper.Matrix(a, b, c, d, tx, ty));
  return item;
}

const opts = { insert: false };
const isEmpty = (p: PaperShape | null) => !p || Math.abs(p.area) < MIN_AREA;

function toSubpaths(item: PaperShape): Subpath[] {
  const paths = (item instanceof paper.CompoundPath ? item.children : [item]) as paper.Path[];
  return paths
    .filter((p) => p.segments.length >= 2 && Math.abs(p.area) >= MIN_AREA)
    .map((p) => ({
      closed: true,
      segments: p.segments.map((s) => ({ p: [s.point.x, s.point.y], hi: [s.handleIn.x, s.handleIn.y], ho: [s.handleOut.x, s.handleOut.y] })),
    }));
}

/** New path object in document space (identity transform, pivot at the bounds center). */
function makeResult(item: PaperShape, styleFrom: EvalObject, name: string): PathObject | null {
  const subs = toSubpaths(item);
  if (!subs.length) return null;
  const b = unionRects(subs.map((s) => segmentsBounds(s.segments, true)))!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const src = styleFrom.source;
  const [first, ...rest] = subs;
  return {
    id: newId('obj'), name, visible: true, locked: false, opacity: styleFrom.opacity, metadata: {}, keyframes: [],
    // Holes and overlapping pieces render correctly with even-odd regardless of Paper's winding direction.
    style: { ...src.style, fillRule: 'evenodd' },
    kind: 'path',
    geometry: { segments: first.segments, closed: true, ...(rest.length ? { subpaths: rest } : {}) },
    brush: null,
    transform: identityTransform(cx, cy, cx, cy),
  };
}

/** Pure part: the objects that replace the selection, or a reason nothing can be produced. */
export function combineItems(op: CombineOp, items: EvalObject[]): { objects: PathObject[]; anchor: EvalObject } | { reason: string } {
  const shapes = items.map(toPaper);
  const back = items[0], front = items[items.length - 1];
  const fold = (fn: (a: PaperShape, b: PaperShape) => PaperShape) => shapes.slice(1).reduce((acc, s) => fn(acc, s), shapes[0]);
  if (op === 'divide') {
    let regions: { item: PaperShape; from: EvalObject }[] = [];
    let covered: PaperShape | null = null;
    let overlapped = false;
    items.forEach((eo, i) => {
      const s = shapes[i];
      const next: typeof regions = [];
      for (const r of regions) {
        const outside = r.item.subtract(s, opts) as PaperShape;
        const inside = r.item.intersect(s, opts) as PaperShape;
        if (!isEmpty(outside)) next.push({ item: outside, from: r.from });
        if (!isEmpty(inside)) { next.push({ item: inside, from: eo }); overlapped = true; }
      }
      const fresh = covered ? (s.subtract(covered, opts) as PaperShape) : s;
      if (!isEmpty(fresh)) next.push({ item: fresh, from: eo });
      covered = covered ? (covered.unite(s, opts) as PaperShape) : s;
      regions = next;
    });
    if (!overlapped) return { reason: 'These shapes don’t overlap, so there is nothing to divide.' };
    const objects = regions.map((r) => makeResult(r.item, r.from, 'Piece')).filter((o): o is PathObject => !!o);
    return { objects, anchor: front };
  }
  let result: PaperShape;
  let styleFrom = front, anchor = front;
  if (op === 'unite') result = fold((a, b) => a.unite(b, opts) as PaperShape);
  else if (op === 'intersect') result = fold((a, b) => a.intersect(b, opts) as PaperShape);
  else if (op === 'exclude') result = fold((a, b) => a.exclude(b, opts) as PaperShape);
  else {
    const fronts = shapes.slice(2).reduce((acc, s) => acc.unite(s, opts) as PaperShape, shapes[1]);
    result = shapes[0].subtract(fronts, opts) as PaperShape;
    styleFrom = back; anchor = back;
  }
  const name = op === 'unite' ? 'United shape' : op === 'subtract' ? `${back.source.name} (cut)` : op === 'intersect' ? 'Intersection' : 'Excluded shape';
  const obj = isEmpty(result) ? null : makeResult(result, styleFrom, name);
  if (!obj) {
    return { reason: op === 'intersect' ? 'These shapes don’t overlap, so there is nothing to keep.'
      : op === 'subtract' ? 'The front shapes cover the back shape completely, so nothing would be left.'
        : 'The result would be empty.' };
  }
  return { objects: [obj], anchor };
}

/** Replaces the selected objects with the combined result as one undoable step. */
export function combineSelection(op: CombineOp): boolean {
  const t = combineTargets();
  if (!t.ok) { toast(t.reason, 'warning'); return false; }
  const r = combineItems(op, t.items);
  if ('reason' in r) { toast(r.reason, 'warning'); return false; }
  const meta = COMBINE_OPS.find((x) => x.id === op)!;
  const ids = r.objects.map((o) => o.id);
  const others = t.items.map((eo) => eo.source.id).filter((id) => id !== r.anchor.source.id);
  const inputs = t.items.map((eo) => eo.source.id);
  // Children of the combined shapes stay where they are (unlinked).
  const ok = commit(meta.command, (p) => removeObjects(replaceObject(releaseChildren(p, inputs, getState().currentFrame), r.anchor.source.id, r.objects as SceneObject[]), others), ids);
  if (ok) store.set({ selection: ids, activeLayerId: r.anchor.layerId });
  return ok;
}

// ------------------------------------------------------------------ Paint Brush merging

/** Metadata key marking shapes painted with the Paint Brush; only these merge with new paint. */
export const PAINT_TAG = 'paintBrush';

const samePaint = (a: SceneObject, b: SceneObject) => JSON.stringify(a.style.fill) === JSON.stringify(b.style.fill);

/** True when two outlines share some area (not just a touching edge). */
function overlaps(a: PaperShape, b: PaperShape): boolean {
  if (!a.bounds.intersects(b.bounds)) return false;
  return !isEmpty(a.intersect(b, opts) as PaperShape);
}

/**
 * Joins the new paint stroke `id` with every Paint Brush shape it overlaps on the same layer and frame that has
 * the same fill and opacity (and no animation). The merged shape takes the new stroke's place on top.
 * Returns null when there is nothing to merge with.
 */
export function mergePaint(p: Project, layerId: string, frame: number, id: string): { project: Project; id: string } | null {
  const layer = p.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  const objs = evaluateLayer(layer, frame, undefined, p); // back to front
  const mine = objs.find((e) => e.source.id === id);
  if (!mine) return null;
  const fresh = toPaper(mine);
  const touching = objs.filter((e) => e !== mine
    && e.source.kind === 'path' && e.source.geometry.closed && e.source.metadata[PAINT_TAG]
    && e.source.visible && !e.source.locked && !e.source.keyframes.length
    && samePaint(e.source, mine.source) && Math.abs(e.opacity - mine.opacity) < 1e-6
    && overlaps(fresh, toPaper(e)));
  if (!touching.length) return null;
  const r = combineItems('unite', [...touching, mine]);
  if ('reason' in r || !r.objects.length) return null;
  const merged: PathObject = { ...r.objects[0], name: 'Paint', metadata: { [PAINT_TAG]: '1' } };
  const project = removeObjects(replaceObject(p, id, [merged]), touching.map((e) => e.source.id));
  return { project, id: merged.id };
}

// ------------------------------------------------------------------ erasing paint

/** True for shapes painted with the Paint Brush (merged or not). */
export const isPaint = (o: SceneObject): boolean => o.kind === 'path' && o.geometry.closed && !!o.metadata[PAINT_TAG];

/** Area swept by the eraser in document space: a round-tipped band through the eraser positions. */
export function eraserSweep(circles: { x: number; y: number; r: number }[]): PaperShape | null {
  if (!circles.length) return null;
  const samples: BrushSample[] = circles.map((c) => [c.x, c.y, 0.5, 0, 0, 0]);
  const settings = { size: circles[0].r * 2, smoothing: 0, cap: 'round' as const, pressure: { enabled: false, min: 1, max: 1 }, tilt: { enabled: false, response: 0 } };
  const sweep = segmentsToPaper(brushOutline(samples, settings, false, false), true);
  sweep.fillRule = 'nonzero';
  return sweep;
}

/**
 * Cuts the eraser sweep out of a Paint Brush shape, keeping its id, style, transform and animation.
 * Returns 'unchanged' when they don't overlap and null when nothing is left.
 */
export function erasePaint(eo: EvalObject, sweep: PaperShape): PathObject | null | 'unchanged' {
  const o = eo.source as PathObject;
  const shape = toPaper(eo);
  if (!overlaps(shape, sweep)) return 'unchanged';
  const rest = shape.subtract(sweep, opts) as PaperShape;
  if (isEmpty(rest)) return null;
  const [a, b, c, d, tx, ty] = invert(eo.matrix);
  rest.transform(new paper.Matrix(a, b, c, d, tx, ty)); // back to the object's own coordinates
  const subs = toSubpaths(rest);
  if (!subs.length) return null;
  const [first, ...more] = subs;
  return {
    ...o,
    style: { ...o.style, fillRule: 'evenodd' },
    geometry: { segments: first.segments, closed: true, ...(more.length ? { subpaths: more } : {}) },
    brush: null, // erased paint is a plain filled shape from now on
  };
}
