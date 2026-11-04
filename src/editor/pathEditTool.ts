// Path edit mode for the Select and Move/Rotate/Scale tools. Double-click a path, shape or brush stroke
// to edit its points:
//   drag an anchor ............ move it (all selected anchors move together; Shift locks to an axis)
//   drag a handle ............. reshape the curve (smooth anchors stay smooth; Alt breaks the pair)
//   drag the path ............. bend that curve so the grabbed point follows the pointer
//   hold an anchor ............ toggle sharp <-> smooth (drag right after it turns smooth to pull handles)
//   Shift-click anchors ....... add to / remove from the selection
//   double-click the path ..... insert an anchor there (the path keeps its shape)
//   double-click an anchor .... show an X button that deletes it; any other click just hides the button
//   Delete, arrow keys ........ remove or nudge selected anchors;  Esc / Enter / click away: finish
// Each drag is a single undoable gesture.
import type { EvalObject } from '../domain/evaluator';
import { apply, applyVector, invert, type Matrix } from '../domain/math';
import { locateObject, mapObjects } from '../domain/ops';
import { bendCurve, curveCount, deleteAnchors, hasHandles, insertAnchor, moveAnchors, setHandle, toggleSmooth } from '../domain/pathEdit';
import type { Segment, Vec } from '../domain/schema';
import { nearestOnPath } from './paperAdapter';
import { applyEditedPath, editablePath, type EditablePath } from './pathEdit';
import { docToScreen, frameObjects, hitObject } from './scene';
import {
  activeTool, beginGesture, cancelGesture, commit, commitMerge, endGesture, getState, store, toast, updateGesture,
  type AppState, type PathEditState,
} from './state';
import type { PointerInfo } from './tools';

const HOLD_MS = 500;
const HIT_PX = 7; // anchor / handle pick radius in screen pixels
const CURVE_PX = 6; // path pick distance in screen pixels
const DRAG_PX = 3; // movement before a press counts as a drag
const DOUBLE_MS = 400; // two presses this close in time and place make a double-click

// Double-clicks are counted from presses made inside edit mode only, so the double-click that entered
// edit mode can't combine with the next press into a "triple" that inserts or deletes an anchor.
let lastPress: { time: number; screen: Vec } | null = null;
function isDoublePress(e: PointerInfo): boolean {
  const prev = lastPress;
  lastPress = { time: e.time, screen: e.screen };
  if (!prev || e.time - prev.time > DOUBLE_MS || Math.hypot(e.screen[0] - prev.screen[0], e.screen[1] - prev.screen[1]) > 6) return false;
  lastPress = null; // a third quick press starts a new pair
  return true;
}

export interface PathEditTarget { eo: EvalObject; path: EditablePath; matrix: Matrix }

/** The object being edited, evaluated on the current frame, or null when it is not on stage. */
export function pathEditTarget(s: AppState = getState()): PathEditTarget | null {
  const pe = s.pathEdit;
  if (!pe) return null;
  const eo = frameObjects(s, {}).find((x) => x.source.id === pe.id);
  const path = eo ? editablePath(eo.source) : null;
  return eo && path ? { eo, path, matrix: eo.matrix } : null;
}

export function canEditPath(id: string): boolean {
  const loc = locateObject(getState().project, id);
  return !!loc && !loc.object.locked && !loc.layer.locked && !!editablePath(loc.object);
}

export function enterPathEdit(id: string) {
  const loc = locateObject(getState().project, id);
  if (!loc || !editablePath(loc.object)) return;
  if (loc.object.locked || loc.layer.locked) { toast('Unlock this object and its layer to edit its points.', 'warning'); return; }
  lastPress = null;
  store.set({ selection: [id], activeLayerId: loc.layer.id, pathEdit: { id, selected: [], curve: null, hold: null, hover: null, deletePrompt: null } });
}

export function exitPathEdit() {
  if (!getState().pathEdit) return;
  stopHold();
  if (drag) { cancelGesture(); drag = null; }
  store.set({ pathEdit: null });
}

const setPE = (patch: Partial<PathEditState>) => {
  const pe = getState().pathEdit;
  if (pe) store.set({ pathEdit: { ...pe, ...patch } });
};

/** Handles drawn on the overlay: those of selected anchors and the ones facing them or the bent curve. */
export function visibleHandles(path: EditablePath, pe: PathEditState): { index: number; which: 'hi' | 'ho' }[] {
  const n = path.segments.length;
  const out = new Map<string, { index: number; which: 'hi' | 'ho' }>();
  const add = (index: number, which: 'hi' | 'ho') => {
    if (index < 0 || index >= n) return;
    if (!path.closed && ((index === 0 && which === 'hi') || (index === n - 1 && which === 'ho'))) return;
    const v = path.segments[index][which];
    if (Math.hypot(v[0], v[1]) > 1e-6) out.set(`${index}${which}`, { index, which });
  };
  const wrap = (i: number) => (path.closed ? (i + n) % n : i);
  for (const i of pe.selected) { add(i, 'hi'); add(i, 'ho'); add(wrap(i - 1), 'ho'); add(wrap(i + 1), 'hi'); }
  if (pe.curve !== null) { add(pe.curve, 'ho'); add(wrap(pe.curve + 1), 'hi'); }
  return [...out.values()];
}

// ------------------------------------------------------------------ hit testing

type Hit =
  | { kind: 'handle'; index: number; which: 'hi' | 'ho' }
  | { kind: 'anchor'; index: number }
  | { kind: 'curve'; index: number; t: number }
  | { kind: 'body' }
  | { kind: 'none' };

function pick(t: PathEditTarget, pe: PathEditState, doc: Vec): Hit {
  const v = getState().viewport;
  const screen = (p: Vec) => docToScreen(v, apply(t.matrix, p));
  const at = docToScreen(v, doc);
  const near = (p: Vec) => Math.hypot(p[0] - at[0], p[1] - at[1]) <= HIT_PX;
  const segs = t.path.segments;
  for (const h of visibleHandles(t.path, pe)) {
    const s = segs[h.index];
    if (near(screen([s.p[0] + s[h.which][0], s.p[1] + s[h.which][1]]))) return { kind: 'handle', ...h };
  }
  // Selected anchors first so overlapping points stay grabbable.
  const order = [...pe.selected, ...segs.keys()];
  for (const i of order) if (i < segs.length && near(screen(segs[i].p))) return { kind: 'anchor', index: i };
  const lp = apply(invert(t.matrix), doc);
  const scale = Math.min(Math.hypot(t.matrix[0], t.matrix[1]), Math.hypot(t.matrix[2], t.matrix[3])) || 1;
  const hit = nearestOnPath(segs, t.path.closed, lp);
  if (hit && hit.index < curveCount(segs, t.path.closed) && hit.dist * scale * v.zoom <= CURVE_PX) return { kind: 'curve', index: hit.index, t: hit.t };
  if (hitObject(t.eo, doc, 2 / v.zoom)) return { kind: 'body' };
  return { kind: 'none' };
}

// ------------------------------------------------------------------ drag state

interface Drag {
  hit: Exclude<Hit, { kind: 'body' } | { kind: 'none' }>;
  id: string;
  startDoc: Vec;
  startScreen: Vec;
  base: EditablePath;
  inv: Matrix;
  indices: number[];
  moved: boolean;
  converted: 'smooth' | 'sharp' | null;
}

let drag: Drag | null = null;
let holdTimer = 0;

function stopHold() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  if (getState().pathEdit?.hold !== null) setPE({ hold: null });
}

function write(segments: Segment[]) {
  if (!drag) return;
  const { id, base } = drag;
  updateGesture((p) => mapObjects(p, [id], (o) => applyEditedPath(o, segments, base.closed)));
}

const toLocal = (d: Drag, doc: Vec): Vec => apply(d.inv, doc);
const localDelta = (d: Drag, doc: Vec): Vec => applyVector(d.inv, [doc[0] - d.startDoc[0], doc[1] - d.startDoc[1]]);

/** Returns true when edit mode handled the press; false means the click was away from the object. */
export function pathEditDown(e: PointerInfo): boolean {
  const s = getState();
  const pe = s.pathEdit;
  const t = pathEditTarget(s);
  if (!pe || !t) { exitPathEdit(); return false; }
  const double = isDoublePress(e);
  // While the delete button is showing, any press elsewhere only hides it.
  if (pe.deletePrompt !== null) { lastPress = null; setPE({ deletePrompt: null }); return true; }
  const hit = pick(t, pe, e.doc);
  if (double && !e.shift && hit.kind === 'curve') { addAnchorAt(t, pe.id, hit.index, hit.t); return true; }
  if (double && !e.shift && hit.kind === 'anchor') {
    stopHold();
    setPE({ selected: [hit.index], curve: null, deletePrompt: hit.index });
    return true;
  }
  if (hit.kind === 'none') { exitPathEdit(); return false; }
  if (hit.kind === 'body') { setPE({ selected: [], curve: null }); return true; }
  if (hit.kind === 'anchor' && e.shift) {
    setPE({ selected: pe.selected.includes(hit.index) ? pe.selected.filter((i) => i !== hit.index) : [...pe.selected, hit.index], curve: null });
    return true;
  }
  let indices: number[] = [];
  if (hit.kind === 'anchor') {
    indices = pe.selected.includes(hit.index) ? pe.selected : [hit.index];
    setPE({ selected: indices, curve: null, hold: hit.index });
    holdTimer = window.setTimeout(() => onHold(hit.index), HOLD_MS);
  } else if (hit.kind === 'curve') {
    setPE({ selected: e.shift ? pe.selected : [], curve: hit.index });
  }
  drag = { hit, id: pe.id, startDoc: e.doc, startScreen: e.screen, base: t.path, inv: invert(t.matrix), indices, moved: false, converted: null };
  beginGesture();
  return true;
}

function onHold(index: number) {
  holdTimer = 0;
  if (!drag || drag.moved || drag.hit.kind !== 'anchor') return;
  const wasCurved = hasHandles(drag.base.segments[index]);
  const segments = toggleSmooth(drag.base.segments, drag.base.closed, index);
  drag.converted = wasCurved ? 'sharp' : 'smooth';
  drag.base = { ...drag.base, segments };
  write(segments);
  setPE({ hold: null, selected: [index] });
}

export function pathEditMove(e: PointerInfo) {
  const d = drag;
  if (!d) return;
  const far = Math.hypot(e.screen[0] - d.startScreen[0], e.screen[1] - d.startScreen[1]) >= DRAG_PX;
  if (!d.moved && !far) return;
  const segs = d.base.segments;
  if (d.hit.kind === 'anchor') {
    if (d.converted === 'sharp') return;
    if (d.converted === 'smooth') {
      // Just turned smooth: dragging pulls out symmetric handles, like placing a point with the Pen.
      const i = d.hit.index;
      const ho: Vec = [toLocal(d, e.doc)[0] - segs[i].p[0], toLocal(d, e.doc)[1] - segs[i].p[1]];
      if (Math.hypot(ho[0], ho[1]) < 1e-3) return;
      d.moved = true;
      write(segs.map((s, j) => (j === i ? { ...s, ho, hi: [-ho[0], -ho[1]] } : s)));
      return;
    }
    if (!d.moved) stopHold();
    d.moved = true;
    let [dx, dy] = localDelta(d, e.doc);
    if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    write(moveAnchors(segs, d.indices, [dx, dy]));
  } else if (d.hit.kind === 'handle') {
    d.moved = true;
    const { index, which } = d.hit;
    const lp = toLocal(d, e.doc);
    write(setHandle(segs, index, which, [lp[0] - segs[index].p[0], lp[1] - segs[index].p[1]], e.alt));
  } else {
    d.moved = true;
    write(bendCurve(segs, d.base.closed, d.hit.index, d.hit.t, localDelta(d, e.doc)));
  }
}

export function pathEditUp() {
  const d = drag;
  drag = null;
  stopHold();
  if (!d) return;
  const label = d.converted === 'smooth' ? 'Make anchor smooth' : d.converted === 'sharp' ? 'Make anchor sharp'
    : !d.moved ? '' : d.hit.kind === 'anchor' ? (d.indices.length > 1 ? 'Move anchors' : 'Move anchor')
      : d.hit.kind === 'handle' ? 'Adjust handle' : 'Bend path';
  if (!label) { cancelGesture(); return; }
  endGesture(label, [d.id]);
  if (d.base.source === 'shape') toast('The shape is now a path, so its points can be edited.');
}

export function pathEditCancel() {
  stopHold();
  if (drag) { cancelGesture(); drag = null; }
}

export function pathEditHover(e: PointerInfo) {
  const s = getState();
  const pe = s.pathEdit, t = pathEditTarget(s);
  if (!pe || !t) return;
  const h = pick(t, pe, e.doc).kind;
  const hover = h === 'anchor' || h === 'handle' || h === 'curve' ? h : null;
  if (hover !== pe.hover) setPE({ hover });
}

function editSegments(label: string, fn: (t: PathEditTarget) => Segment[] | null, merge = false): boolean {
  const s = getState();
  const pe = s.pathEdit, t = pathEditTarget(s);
  if (!pe || !t) return false;
  const next = fn(t);
  if (!next) return false;
  const run = merge ? commitMerge : commit;
  return run(label, (p) => mapObjects(p, [pe.id], (o) => applyEditedPath(o, next, t.path.closed)), [pe.id]);
}

function addAnchorAt(t: PathEditTarget, id: string, curve: number, param: number) {
  const r = insertAnchor(t.path.segments, t.path.closed, curve, param);
  if (!r) return;
  if (commit('Add anchor', (p) => mapObjects(p, [id], (o) => applyEditedPath(o, r.segments, t.path.closed)), [id])) {
    setPE({ selected: [r.index], curve: null });
    if (t.path.source === 'shape') toast('The shape is now a path, so its points can be edited.');
  }
}

/** Deletes anchors; returns false (with a message) when the path would have fewer than two. */
export function deletePathAnchors(indices: number[]): boolean {
  const ok = editSegments(indices.length > 1 ? 'Delete anchors' : 'Delete anchor', (t) => deleteAnchors(t.path.segments, indices));
  if (ok) setPE({ selected: [], curve: null, deletePrompt: null });
  else toast('A path needs at least two points.', 'warning');
  return ok;
}

export function closeDeletePrompt() { setPE({ deletePrompt: null }); }

export function pathEditKey(e: KeyboardEvent): boolean {
  const pe = getState().pathEdit;
  if (!pe) return false;
  if (pe.deletePrompt !== null && e.key === 'Escape') { closeDeletePrompt(); return true; }
  if (e.key === 'Escape' || e.key === 'Enter') { exitPathEdit(); return true; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!pe.selected.length) { toast('Select anchor points to delete them, or press Esc to finish editing.'); return true; }
    deletePathAnchors(pe.selected);
    return true;
  }
  if (e.key.startsWith('Arrow') && pe.selected.length && !e.ctrlKey && !e.metaKey) {
    const step = e.shiftKey ? 10 : 1;
    const doc: Vec = [e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0];
    editSegments('Nudge anchors', (t) => moveAnchors(t.path.segments, pe.selected, applyVector(invert(t.matrix), doc)), true);
    return true;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    const t = pathEditTarget();
    if (t) setPE({ selected: t.path.segments.map((_, i) => i), curve: null });
    return true;
  }
  return false;
}

// Leave edit mode when the object goes away (undo, delete, frame change), is deselected or locked,
// or another tool takes over.
store.subscribe((s, prev) => {
  const pe = s.pathEdit;
  if (!pe) return;
  const tool = activeTool(s);
  const toolOk = tool === 'select' || tool === 'transform' || tool === 'hand' || tool === 'zoom';
  if (!toolOk || !s.selection.includes(pe.id) || s.playing) { exitPathEdit(); return; }
  if (s.project !== prev.project || s.currentFrame !== prev.currentFrame) {
    if (drag) return;
    const loc = locateObject(s.project, pe.id);
    if (!loc || loc.object.locked || loc.layer.locked || !pathEditTarget(s)) { exitPathEdit(); return; }
    const n = editablePath(loc.object)?.segments.length ?? 0;
    if (pe.selected.some((i) => i >= n) || (pe.curve !== null && pe.curve >= n) || (pe.deletePrompt !== null && pe.deletePrompt >= n)) {
      setPE({ selected: pe.selected.filter((i) => i < n), curve: null, deletePrompt: null });
    }
  }
});
