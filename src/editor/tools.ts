// Tool registry and canvas interactions. Every tool mutates the canonical project through commands
// or gestures; nothing treats the renderer as the source of truth.
import { brushOutline, detectPressure, detectTilt, processSamples, splitSamples, type RawSample } from '../domain/brush';
import { parseHex, toHex8 } from '../domain/color';
import { identityTransform } from '../domain/defaults';
import { evaluateFrame, type EvalObject } from '../domain/evaluator';
import { segmentsBounds } from '../domain/geometry';
import { newId } from '../domain/ids';
import { apply, applyVector, DEG, dist, invert, type Rect, rotate, transformMatrix } from '../domain/math';
import { addObjects, locateObject, mapObjects, removeObjects, replaceObject, setObjectTransform } from '../domain/ops';
import { evaluateLayer, isLayerEffectivelyVisible, sampleObject } from '../domain/evaluator';
import type { Paint, PathObject, Project, SceneObject, Segment, ShapeObject, Style, TextObject, Transform, Vec } from '../domain/schema';
import { getAssetImage } from '../features/assets';
import { editablePath } from './pathEdit';
import { enterPathEdit, exitPathEdit, pathEditCancel, pathEditDown, pathEditHover, pathEditKey, pathEditMove, pathEditUp } from './pathEditTool';
import { renderScene, cachedLocalBounds } from './renderer';
import { frameObjects, hitObject, hitTest, objectsInRect, selectionInfo, screenToDoc, zoomAt, type SelectionInfo } from './scene';
import {
  beginGesture, cancelGesture, commit, endGesture, getState, pushRecentColor, setOverlay, store, toast, updateGesture, type ToolId,
} from './state';

export interface PointerInfo {
  doc: Vec;
  screen: Vec;
  pressure: number;
  tiltX: number;
  tiltY: number;
  pointerType: string;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  time: number;
  clickCount: number;
  handle: string | null;
  coalesced: { doc: Vec; pressure: number; tiltX: number; tiltY: number; time: number }[];
}

export interface Tool {
  down(e: PointerInfo): void;
  move(e: PointerInfo): void;
  up(e: PointerInfo): void;
  hover?(e: PointerInfo): void;
  leave?(): void;
  cancel(): void;
  key?(e: KeyboardEvent): boolean;
}

export interface ToolMeta { id: ToolId; label: string; shortcut: string; help: string; transient?: boolean; drawing?: boolean }

export const TOOL_LIST: ToolMeta[] = [
  { id: 'select', label: 'Select', shortcut: 'V', help: 'Click an object to select it, drag to move it, or drag on empty space to box-select. Shift-click adds to the selection. Double-click a path, shape or brush stroke to edit its points.' },
  { id: 'transform', label: 'Move, Rotate & Scale', shortcut: 'Q', help: 'Select objects and use the handles to move, rotate and scale them. Shift keeps proportions; Alt scales from the center.' },
  { id: 'brush', label: 'Brush', shortcut: 'B', help: 'Draw freehand strokes. Pen pressure and tilt change the width when your device supports them.', drawing: true },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', help: 'Drag across brush strokes to cut them apart, or switch to Delete mode to remove whole objects.', drawing: true },
  { id: 'shape', label: 'Shape', shortcut: 'U', help: 'Drag to draw a rectangle, ellipse, triangle or polygon. Shift makes it even; Alt draws from the center.', drawing: true },
  { id: 'pen', label: 'Pen', shortcut: 'P', help: 'Click to place points, drag to make curves, click the first point to close. Enter finishes, Esc cancels.', drawing: true },
  { id: 'text', label: 'Text', shortcut: 'T', help: 'Click the stage to add text, or click existing text to edit it. Ctrl/⌘+Enter commits, Esc cancels.', drawing: true },
  { id: 'bucket', label: 'Paint Bucket', shortcut: 'K', help: 'Click inside a closed shape to fill it with the current fill color.', drawing: true },
  { id: 'eyedropper', label: 'Eyedropper', shortcut: 'I', help: 'Click the stage to copy the color under the pointer into your fill swatch. Alt-click fills the other swatch.', transient: true },
  { id: 'hand', label: 'Hand', shortcut: 'H', help: 'Drag to pan around the stage. Hold Space to use it from any tool.', transient: true },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z', help: 'Click to zoom in, Alt-click to zoom out, or drag a box to zoom to that area.', transient: true },
];

export const isDrawingTool = (id: ToolId) => !!TOOL_LIST.find((t) => t.id === id)?.drawing;

// ------------------------------------------------------------------ shared helpers

function activeLayerEditable(): boolean {
  const s = getState();
  const layer = s.project.layers.find((l) => l.id === s.activeLayerId);
  if (!layer) return false;
  if (layer.locked) { toast(`"${layer.name}" is locked. Unlock it in the timeline to draw.`, 'warning'); return false; }
  if (!isLayerEffectivelyVisible(s.project, layer)) { toast(`"${layer.name}" is hidden. Show it to draw on it.`, 'warning'); return false; }
  return true;
}

export function styleFromSwatches(): Style {
  const s = getState();
  return { fill: s.fill, stroke: s.stroke, ...s.strokeStyle, fillRule: 'nonzero' };
}

function baseObject(name: string, style: Style) {
  return { id: newId('obj'), name, visible: true, locked: false, opacity: 1, style, metadata: {}, keyframes: [] };
}

/** Builds a path object with pivot at its bounds center and an identity transform. */
export function makePathObject(name: string, segments: Segment[], closed: boolean, style: Style, brush: PathObject['brush'] = null, id?: string): PathObject {
  const b = segmentsBounds(segments, closed);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  return { ...baseObject(name, style), ...(id ? { id } : {}), kind: 'path', geometry: { segments, closed }, brush, transform: identityTransform(cx, cy, cx, cy) };
}

let nameCounters: Record<string, number> = {};
function nextName(kind: string) {
  nameCounters[kind] = (nameCounters[kind] ?? 0) + 1;
  return `${kind} ${nameCounters[kind]}`;
}

// ------------------------------------------------------------------ transform handles

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';
export const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const handleUnit: Record<Exclude<HandleId, 'rot'>, Vec> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

export function handleLocal(b: Rect, h: Exclude<HandleId, 'rot'>): Vec {
  const u = handleUnit[h];
  return [b.x + b.width * u[0], b.y + b.height * u[1]];
}

/** Handle positions in document space: rotated box for single selection, AABB for multi. */
export function handleGeometry(info: SelectionInfo): { points: Record<HandleId, Vec>; corners: Vec[]; center: Vec; matrix: (p: Vec) => Vec } {
  let toDoc: (p: Vec) => Vec;
  let b: Rect;
  if (info.single) {
    b = cachedLocalBounds(info.single.source);
    const m = info.single.matrix;
    toDoc = (p) => apply(m, p);
  } else {
    b = info.bounds;
    toDoc = (p) => p;
  }
  const points = {} as Record<HandleId, Vec>;
  for (const h of HANDLE_IDS) points[h] = toDoc(handleLocal(b, h as Exclude<HandleId, 'rot'>));
  const top = points.n, center = toDoc([b.x + b.width / 2, b.y + b.height / 2]);
  const dir: Vec = [top[0] - center[0], top[1] - center[1]];
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const zoom = getState().viewport.zoom;
  points.rot = [top[0] + (dir[0] / len) * (28 / zoom), top[1] + (dir[1] / len) * (28 / zoom)];
  return { points, corners: [points.nw, points.ne, points.se, points.sw], center, matrix: toDoc };
}

// ------------------------------------------------------------------ select / transform

interface DragOrig { id: string; t: Transform; opacity: number }

function sampledOrig(project: Project, ids: string[], frame: number): DragOrig[] {
  return ids.flatMap((id) => {
    const loc = locateObject(project, id);
    if (!loc) return [];
    const smp = sampleObject(loc.object, frame);
    return [{ id, t: smp.transform, opacity: smp.opacity }];
  });
}

function applyTransforms(base: Project, frame: number, next: Map<string, Partial<Transform>>): Project {
  return mapObjects(base, next.keys(), (o) => setObjectTransform(o, frame, next.get(o.id)!));
}

function createSelectTool(withHandles: boolean): Tool {
  let mode: 'none' | 'move' | 'marquee' | 'scale' | 'rotate' = 'none';
  let start: Vec = [0, 0];
  let orig: DragOrig[] = [];
  let info: SelectionInfo | null = null;
  let handle: HandleId | null = null;
  let moved = false;
  let editing = false; // this press belongs to path edit mode

  const finishMarquee = (e: PointerInfo) => {
    const r = getState().overlay.marquee;
    setOverlay({ marquee: null });
    if (!r) return;
    const ids = objectsInRect(getState(), r);
    store.set((s) => ({ selection: e.shift ? [...new Set([...s.selection, ...ids])] : ids }));
  };

  return {
    down(e) {
      editing = !!getState().pathEdit && pathEditDown(e);
      if (editing) { mode = 'none'; return; }
      const s = getState();
      start = e.doc;
      moved = false;
      if (e.handle && withHandles) {
        info = selectionInfo(s);
        if (!info) return;
        handle = e.handle as HandleId;
        mode = handle === 'rot' ? 'rotate' : 'scale';
        orig = sampledOrig(s.project, info.objects.map((o) => o.source.id), s.currentFrame);
        beginGesture();
        return;
      }
      const hit = hitTest(s, e.doc);
      if (hit) {
        const id = hit.source.id;
        if (e.clickCount >= 2 && hit.source.kind === 'text') {
          store.set({ selection: [id], editingTextId: id });
          mode = 'none';
          return;
        }
        if (e.clickCount >= 2 && !e.shift && editablePath(hit.source)) {
          cancelGesture();
          enterPathEdit(id);
          mode = 'none';
          return;
        }
        if (e.shift) {
          store.set({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] });
          mode = 'none';
          return;
        }
        if (!s.selection.includes(id)) store.set({ selection: [id], activeLayerId: hit.layerId });
        mode = 'move';
        orig = sampledOrig(getState().project, getState().selection, s.currentFrame);
        beginGesture();
      } else {
        if (!e.shift) store.set({ selection: [] });
        mode = 'marquee';
        setOverlay({ marquee: { x: e.doc[0], y: e.doc[1], width: 0, height: 0 } });
      }
    },
    move(e) {
      if (editing) { pathEditMove(e); return; }
      const s = getState();
      const frame = s.currentFrame;
      if (mode === 'marquee') {
        setOverlay({ marquee: { x: Math.min(start[0], e.doc[0]), y: Math.min(start[1], e.doc[1]), width: Math.abs(e.doc[0] - start[0]), height: Math.abs(e.doc[1] - start[1]) } });
        return;
      }
      if (mode === 'move') {
        let dx = e.doc[0] - start[0], dy = e.doc[1] - start[1];
        if (!moved && Math.hypot(dx, dy) * s.viewport.zoom < 2) return;
        moved = true;
        if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        updateGesture((base) => applyTransforms(base, frame, new Map(orig.map((o) => [o.id, { x: o.t.x + dx, y: o.t.y + dy }]))));
        return;
      }
      if (mode === 'rotate' && info) {
        const g = handleGeometry(info);
        const c: Vec = info.single ? [orig[0].t.x, orig[0].t.y] : g.center;
        const a0 = Math.atan2(start[1] - c[1], start[0] - c[0]);
        const a1 = Math.atan2(e.doc[1] - c[1], e.doc[0] - c[0]);
        let delta = (a1 - a0) / DEG;
        if (e.shift) {
          const target = Math.round(((info.single ? orig[0].t.rotation : 0) + delta) / 15) * 15;
          delta = target - (info.single ? orig[0].t.rotation : 0);
        }
        const r = rotate(delta);
        updateGesture((base) => applyTransforms(base, frame, new Map(orig.map((o) => {
          const v = applyVector(r, [o.t.x - c[0], o.t.y - c[1]]);
          return [o.id, { rotation: o.t.rotation + delta, x: c[0] + v[0], y: c[1] + v[1] }];
        }))));
        moved = true;
        return;
      }
      if (mode === 'scale' && info && handle && handle !== 'rot') {
        moved = true;
        const h = handle;
        const horiz = h !== 'n' && h !== 's', vert = h !== 'e' && h !== 'w';
        const corner = horiz && vert;
        const opposite: Record<string, HandleId> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };
        if (info.single) {
          const o = orig[0];
          const b = cachedLocalBounds(info.single.source);
          const hl = handleLocal(b, h);
          const al: Vec = e.alt ? [b.x + b.width / 2, b.y + b.height / 2] : handleLocal(b, opposite[h] as Exclude<HandleId, 'rot'>);
          const rInv = rotate(-o.t.rotation);
          const q = (p: Vec): Vec => applyVector(rInv, [p[0] - o.t.x, p[1] - o.t.y]);
          const S0 = (p: Vec): Vec => [o.t.scaleX * (p[0] - o.t.pivotX), o.t.scaleY * (p[1] - o.t.pivotY)];
          const qa = S0(al), qh = S0(hl), qp = q(e.doc);
          let rx = horiz && Math.abs(qh[0] - qa[0]) > 1e-6 ? (qp[0] - qa[0]) / (qh[0] - qa[0]) : 1;
          let ry = vert && Math.abs(qh[1] - qa[1]) > 1e-6 ? (qp[1] - qa[1]) / (qh[1] - qa[1]) : 1;
          if (e.shift) {
            if (corner) { const k = Math.abs(rx) > Math.abs(ry) ? rx : ry; rx = k; ry = k; }
            else if (horiz) ry = Math.abs(rx); else rx = Math.abs(ry);
          }
          const sx = safeScale(o.t.scaleX * rx), sy = safeScale(o.t.scaleY * ry);
          const aOld = qa;
          const aNew: Vec = [sx * (al[0] - o.t.pivotX), sy * (al[1] - o.t.pivotY)];
          const d = applyVector(rotate(o.t.rotation), [aOld[0] - aNew[0], aOld[1] - aNew[1]]);
          updateGesture((base) => applyTransforms(base, frame, new Map([[o.id, { scaleX: sx, scaleY: sy, x: o.t.x + d[0], y: o.t.y + d[1] }]])));
        } else {
          const b = info.bounds;
          const hp = handleLocal(b, h);
          const ap: Vec = e.alt ? [b.x + b.width / 2, b.y + b.height / 2] : handleLocal(b, opposite[h] as Exclude<HandleId, 'rot'>);
          let fx = horiz && Math.abs(hp[0] - ap[0]) > 1e-6 ? (e.doc[0] - ap[0]) / (hp[0] - ap[0]) : 1;
          let fy = vert && Math.abs(hp[1] - ap[1]) > 1e-6 ? (e.doc[1] - ap[1]) / (hp[1] - ap[1]) : 1;
          if (e.shift) {
            if (corner) { const k = Math.abs(fx) > Math.abs(fy) ? fx : fy; fx = fy = k; }
            else if (horiz) fy = Math.abs(fx); else fx = Math.abs(fy);
          }
          updateGesture((base) => applyTransforms(base, frame, new Map(orig.map((o) => [o.id, {
            x: ap[0] + (o.t.x - ap[0]) * fx, y: ap[1] + (o.t.y - ap[1]) * fy,
            scaleX: safeScale(o.t.scaleX * fx), scaleY: safeScale(o.t.scaleY * fy),
          }]))));
        }
      }
    },
    up(e) {
      if (editing) { editing = false; pathEditUp(); return; }
      if (mode === 'marquee') finishMarquee(e);
      else if (mode === 'move') { if (moved) endGesture('Move', orig.map((o) => o.id)); else cancelGesture(); }
      else if (mode === 'scale') endGesture('Scale', orig.map((o) => o.id));
      else if (mode === 'rotate') endGesture('Rotate', orig.map((o) => o.id));
      mode = 'none';
      info = null;
    },
    hover(e) { if (getState().pathEdit) pathEditHover(e); },
    cancel() {
      if (editing) { editing = false; pathEditCancel(); return; }
      if (mode === 'marquee') setOverlay({ marquee: null });
      else if (mode !== 'none') cancelGesture();
      mode = 'none';
    },
    key(e) { return pathEditKey(e); },
  };
}

const safeScale = (v: number) => (Math.abs(v) < 0.001 ? (v < 0 ? -0.001 : 0.001) : v);

// ------------------------------------------------------------------ brush

function createBrushTool(): Tool {
  let raw: RawSample[] = [];
  let id = '';
  let pointerType = 'mouse';
  let active = false;

  const build = (): PathObject | null => {
    const s = getState();
    const opts = s.toolOptions.brush;
    const spacing = Math.max(0.5, 1.5 / s.viewport.zoom);
    const { opacity: _o, ...settings } = opts;
    void _o;
    const samples = processSamples(raw, settings, spacing);
    if (!samples.length) return null;
    const hasPressure = detectPressure(raw, pointerType);
    const hasTilt = detectTilt(raw);
    const segs = brushOutline(samples, settings, hasPressure, hasTilt);
    const paint: Paint = s.stroke.type !== 'none' ? s.stroke : s.fill.type !== 'none' ? s.fill : { type: 'solid', color: '#000000FF' };
    const style: Style = { fill: paint, stroke: { type: 'none' }, strokeWidth: 0, cap: 'round', join: 'round', dash: [], fillRule: 'nonzero' };
    const obj = makePathObject('Brush stroke', segs, true, style, { samples, hasPressure, hasTilt, settings }, id);
    return { ...obj, opacity: opts.opacity };
  };

  const push = (e: PointerInfo) => {
    const pts = e.coalesced.length ? e.coalesced : [{ doc: e.doc, pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY, time: e.time }];
    for (const c of pts) raw.push({ x: c.doc[0], y: c.doc[1], pressure: c.pressure, tiltX: c.tiltX, tiltY: c.tiltY, t: c.time });
  };

  return {
    down(e) {
      if (!activeLayerEditable()) return;
      active = true;
      raw = [];
      id = newId('obj');
      pointerType = e.pointerType;
      push(e);
      beginGesture();
      const s = getState();
      const layerId = s.activeLayerId, frame = s.currentFrame;
      const obj = build();
      if (obj) updateGesture((base) => addObjects(base, layerId, frame, [obj]));
    },
    move(e) {
      if (!active) return;
      push(e);
      const s = getState();
      const layerId = s.activeLayerId, frame = s.currentFrame;
      const obj = build();
      if (obj) updateGesture((base) => addObjects(base, layerId, frame, [obj]));
    },
    up() {
      if (!active) return;
      active = false;
      endGesture('Brush stroke', [id]);
    },
    hover(e) {
      const s = getState();
      setOverlay({ brushCursor: { pos: e.doc, r: s.toolOptions.brush.size / 2 } });
    },
    leave() { setOverlay({ brushCursor: null }); },
    cancel() { if (active) cancelGesture(); active = false; setOverlay({ brushCursor: null }); },
  };
}

// ------------------------------------------------------------------ eraser

/** v1 semantics: split brush strokes along the swept path, or delete any touched object (docs/decisions/0004). */
function applyEraser(base: Project, frame: number, layerIds: string[], circles: { x: number; y: number; r: number }[], mode: 'split' | 'delete'): Project {
  let p = base;
  for (const layerId of layerIds) {
    const layer = p.layers.find((l) => l.id === layerId);
    if (!layer) continue;
    for (const eo of evaluateLayer(layer, frame)) {
      const o = eo.source;
      if (o.locked) continue;
      if (mode === 'delete') {
        if (circles.some((c) => hitObject(eo, [c.x, c.y], c.r))) p = removeObjects(p, [o.id]);
        continue;
      }
      if (o.kind !== 'path' || !o.brush) continue;
      const inv = invert(eo.matrix);
      const sc = Math.hypot(eo.matrix[0], eo.matrix[1]) || 1;
      const local = circles.map((c) => { const q = apply(inv, [c.x, c.y]); return { x: q[0], y: q[1], r: c.r / sc }; });
      const runs = splitSamples(o.brush.samples, local);
      if (runs.length === 1 && runs[0].length === o.brush.samples.length) continue;
      // The edited centerline no longer matches the split pieces; it is re-fitted on the next edit.
      const { spine: _spine, ...meta } = o.brush;
      void _spine;
      const pieces: SceneObject[] = runs.map((samples, i) => {
        const segs = brushOutline(samples, meta.settings, meta.hasPressure, meta.hasTilt);
        return { ...o, id: i === 0 ? o.id : newId('obj'), geometry: { segments: segs, closed: true }, brush: { ...meta, samples } };
      });
      p = replaceObject(p, o.id, pieces);
    }
  }
  return p;
}

function createEraserTool(): Tool {
  let circles: { x: number; y: number; r: number }[] = [];
  let active = false;
  const targets = () => {
    const s = getState();
    if (!s.toolOptions.eraser.allLayers) return [s.activeLayerId];
    return s.project.layers.filter((l) => !l.locked && isLayerEffectivelyVisible(s.project, l)).map((l) => l.id);
  };
  const step = (e: PointerInfo) => {
    const s = getState();
    const r = s.toolOptions.eraser.size / 2;
    const last = circles[circles.length - 1];
    if (last) {
      // Fill gaps between pointer samples so fast sweeps do not skip strokes.
      const d = dist([last.x, last.y], e.doc);
      const n = Math.floor(d / (r * 0.5));
      for (let i = 1; i <= n; i++) circles.push({ x: last.x + ((e.doc[0] - last.x) * i) / (n + 1), y: last.y + ((e.doc[1] - last.y) * i) / (n + 1), r });
    }
    circles.push({ x: e.doc[0], y: e.doc[1], r });
    const frame = s.currentFrame, layerIds = targets(), mode = s.toolOptions.eraser.mode, cs = circles.slice();
    updateGesture((base) => applyEraser(base, frame, layerIds, cs, mode));
    setOverlay({ eraser: { pos: e.doc, r } });
  };
  return {
    down(e) {
      const s = getState();
      if (!s.toolOptions.eraser.allLayers && !activeLayerEditable()) return;
      active = true;
      circles = [];
      beginGesture();
      step(e);
    },
    move(e) { if (active) step(e); },
    up() { if (active) endGesture('Erase'); active = false; },
    hover(e) { setOverlay({ eraser: { pos: e.doc, r: getState().toolOptions.eraser.size / 2 } }); },
    leave() { setOverlay({ eraser: null }); },
    cancel() { if (active) cancelGesture(); active = false; setOverlay({ eraser: null }); },
  };
}

// ------------------------------------------------------------------ shape

function createShapeTool(): Tool {
  let start: Vec = [0, 0];
  let active = false;
  let id = '';
  return {
    down(e) {
      if (!activeLayerEditable()) return;
      active = true;
      start = e.doc;
      id = newId('obj');
      beginGesture();
    },
    move(e) {
      if (!active) return;
      const s = getState();
      let w = e.doc[0] - start[0], h = e.doc[1] - start[1];
      if (e.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      let cx = start[0] + w / 2, cy = start[1] + h / 2;
      if (e.alt) { cx = start[0]; cy = start[1]; w *= 2; h *= 2; }
      const W = Math.abs(w), H = Math.abs(h);
      if (W * s.viewport.zoom < 2 && H * s.viewport.zoom < 2) return;
      const opts = s.toolOptions.shape;
      const label = { rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', polygon: 'Polygon' }[opts.type];
      const obj: ShapeObject = {
        ...baseObject(label, styleFromSwatches()), id, kind: 'shape',
        geometry: { shape: opts.type, width: W, height: H, sides: opts.sides, cornerRadius: opts.cornerRadius },
        transform: identityTransform(cx, cy, W / 2, H / 2),
      };
      const layerId = s.activeLayerId, frame = s.currentFrame;
      updateGesture((base) => addObjects(base, layerId, frame, [obj]));
    },
    up() {
      if (!active) return;
      active = false;
      const s = getState();
      if (s.project !== s.gestureBase) {
        endGesture('Draw shape', [id]);
        store.set({ selection: [id] });
      } else cancelGesture();
    },
    cancel() { if (active) cancelGesture(); active = false; },
  };
}

// ------------------------------------------------------------------ pen

export function finishPen(close = false) {
  const s = getState();
  const pen = s.overlay.pen;
  setOverlay({ pen: null });
  if (!pen || pen.segments.length < 2) return;
  const segs = pen.segments.map((x) => ({ p: x.p, hi: x.hi, ho: x.ho }));
  const style = styleFromSwatches();
  if (!close) style.fill = { type: 'none' };
  const obj = makePathObject(nextName('Path'), segs, close, style);
  const layerId = s.activeLayerId, frame = s.currentFrame;
  commit('Pen path', (p) => addObjects(p, layerId, frame, [obj]), [obj.id]);
  store.set({ selection: [obj.id] });
}

function createPenTool(): Tool {
  let anchor: Vec | null = null;
  return {
    down(e) {
      const s = getState();
      const pen = s.overlay.pen;
      if (!pen && !activeLayerEditable()) return;
      if (pen && pen.segments.length >= 2) {
        const first = pen.segments[0].p;
        if (dist(first, e.doc) * s.viewport.zoom < 9) { finishPen(true); anchor = null; return; }
      }
      if (pen && e.clickCount >= 2) { finishPen(false); anchor = null; return; }
      anchor = e.doc;
      const segments = [...(pen?.segments ?? []), { p: e.doc, hi: [0, 0] as Vec, ho: [0, 0] as Vec }];
      setOverlay({ pen: { segments, hover: null, dragging: true } });
    },
    move(e) {
      const pen = getState().overlay.pen;
      if (!pen || !anchor) return;
      const ho: Vec = [e.doc[0] - anchor[0], e.doc[1] - anchor[1]];
      const last = pen.segments[pen.segments.length - 1];
      const hi: Vec = e.alt ? last.hi : [-ho[0], -ho[1]];
      setOverlay({ pen: { ...pen, segments: [...pen.segments.slice(0, -1), { ...last, ho, hi }], dragging: true } });
    },
    up() {
      anchor = null;
      const pen = getState().overlay.pen;
      if (pen) setOverlay({ pen: { ...pen, dragging: false } });
    },
    hover(e) {
      const pen = getState().overlay.pen;
      if (pen) setOverlay({ pen: { ...pen, hover: e.doc } });
    },
    cancel() { anchor = null; setOverlay({ pen: null }); },
    key(e) {
      if (!getState().overlay.pen) return false;
      if (e.key === 'Enter') { finishPen(false); return true; }
      if (e.key === 'Escape') { setOverlay({ pen: null }); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const pen = getState().overlay.pen!;
        setOverlay({ pen: pen.segments.length > 1 ? { ...pen, segments: pen.segments.slice(0, -1) } : null });
        return true;
      }
      return false;
    },
  };
}

// ------------------------------------------------------------------ text

function createTextTool(): Tool {
  return {
    down(e) {
      const s = getState();
      const hit = hitTest(s, e.doc);
      if (hit && hit.source.kind === 'text') {
        store.set({ selection: [hit.source.id], editingTextId: hit.source.id, activeLayerId: hit.layerId });
        return;
      }
      if (!activeLayerEditable()) return;
      const t = { ...s.toolOptions.text, content: '' };
      const obj: TextObject = {
        ...baseObject(nextName('Text'), { ...styleFromSwatches(), stroke: { type: 'none' }, strokeWidth: 0 }),
        kind: 'text', text: t,
        transform: identityTransform(e.doc[0], e.doc[1] - t.fontSize * 0.6, 0, 0),
      };
      const layerId = s.activeLayerId, frame = s.currentFrame;
      beginGesture();
      updateGesture((base) => addObjects(base, layerId, frame, [obj]));
      store.set({ selection: [obj.id], editingTextId: obj.id });
    },
    move() {},
    up() {},
    cancel() {},
  };
}

// ------------------------------------------------------------------ bucket

function createBucketTool(): Tool {
  return {
    down(e) {
      const s = getState();
      const hit = hitTest(s, e.doc, 2);
      if (!hit) { toast('Paint Bucket fills a closed vector shape. Click inside one.', 'info'); return; }
      const o = hit.source;
      const closed = o.kind === 'shape' || (o.kind === 'path' && o.geometry.closed) || o.kind === 'text';
      if (!closed) {
        toast(o.kind === 'bitmap' ? 'Bitmap pixel fill is not available in this version.' : 'This path is open. Close it (Pen: click the first point) to fill it.', 'warning');
        return;
      }
      const fill = s.fill;
      commit('Paint bucket', (p) => mapObjects(p, [o.id], (x) => ({ ...x, style: { ...x.style, fill } })), [o.id]);
    },
    move() {},
    up() {},
    cancel() {},
  };
}

// ------------------------------------------------------------------ eyedropper

export function sampleColorAt(p: Vec, allLayers: boolean): string | null {
  const s = getState();
  const scene = evaluateFrame(s.project, s.currentFrame, allLayers ? {} : { layerIds: [s.activeLayerId] });
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  renderScene(ctx, scene, { matrix: [1, 0, 0, 1, -p[0], -p[1]], getImage: getAssetImage, drawBackground: allLayers });
  const d = ctx.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return null;
  return toHex8({ r: d[0], g: d[1], b: d[2], a: d[3] / 255 });
}

function createEyedropperTool(): Tool {
  return {
    down(e) {
      const s = getState();
      const opts = s.toolOptions.eyedropper;
      const hex = sampleColorAt(e.doc, opts.allLayers);
      if (!hex) { toast('Nothing to sample there (transparent).', 'info'); return; }
      const paint: Paint = { type: 'solid', color: hex };
      const target = e.alt ? (opts.target === 'fill' ? 'stroke' : 'fill') : opts.target;
      store.set(target === 'fill' ? { fill: paint } : { stroke: paint });
      pushRecentColor(hex);
      const { r, g, b } = parseHex(hex);
      toast(`Sampled ${target}: rgb(${r}, ${g}, ${b})`, 'success');
    },
    move() {},
    up() {},
    cancel() {},
  };
}

// ------------------------------------------------------------------ hand & zoom

function createHandTool(): Tool {
  let last: Vec | null = null;
  return {
    down(e) { last = e.screen; },
    move(e) {
      if (!last) return;
      const dx = e.screen[0] - last[0], dy = e.screen[1] - last[1];
      last = e.screen;
      store.set((s) => ({ viewport: { ...s.viewport, panX: s.viewport.panX + dx, panY: s.viewport.panY + dy } }));
    },
    up() { last = null; },
    cancel() { last = null; },
  };
}

function createZoomTool(): Tool {
  let start: Vec | null = null;
  let startScreen: Vec = [0, 0];
  return {
    down(e) { start = e.doc; startScreen = e.screen; },
    move(e) {
      if (!start) return;
      if (Math.hypot(e.screen[0] - startScreen[0], e.screen[1] - startScreen[1]) < 4) return;
      setOverlay({ zoomBox: { x: Math.min(start[0], e.doc[0]), y: Math.min(start[1], e.doc[1]), width: Math.abs(e.doc[0] - start[0]), height: Math.abs(e.doc[1] - start[1]) } });
    },
    up(e) {
      const s = getState();
      const box = s.overlay.zoomBox;
      setOverlay({ zoomBox: null });
      if (box && box.width > 0 && box.height > 0) {
        const z = Math.min(s.stageSize.width / box.width, s.stageSize.height / box.height) * 0.9;
        const v = { zoom: Math.min(32, Math.max(0.125, z)), panX: 0, panY: 0 };
        v.panX = s.stageSize.width / 2 - (box.x + box.width / 2) * v.zoom;
        v.panY = s.stageSize.height / 2 - (box.y + box.height / 2) * v.zoom;
        store.set({ viewport: v });
      } else {
        const f = e.alt ? 1 / 2 : 2;
        store.set({ viewport: zoomAt(s.viewport, s.viewport.zoom * f, e.screen) });
      }
      start = null;
    },
    cancel() { start = null; setOverlay({ zoomBox: null }); },
  };
}

// ------------------------------------------------------------------ registry

export const tools: Record<ToolId, Tool> = {
  select: createSelectTool(false),
  transform: createSelectTool(true),
  brush: createBrushTool(),
  eraser: createEraserTool(),
  shape: createShapeTool(),
  pen: createPenTool(),
  text: createTextTool(),
  bucket: createBucketTool(),
  eyedropper: createEyedropperTool(),
  hand: createHandTool(),
  zoom: createZoomTool(),
};

export function setTool(id: ToolId) {
  const s = getState();
  if (s.tool === id && !s.transientTool) return;
  tools[s.transientTool ?? s.tool].cancel();
  if (id !== 'select' && id !== 'transform') exitPathEdit();
  if (s.overlay.pen && id !== 'pen') finishPen(false);
  store.set({ tool: id, transientTool: null, overlay: { ...getState().overlay, eraser: null, brushCursor: null } });
}

/** Convenience used by the eyedropper/screen tools: the screen point at the stage center. */
export function stageCenter(): Vec {
  const s = getState();
  return screenToDoc(s.viewport, [s.stageSize.width / 2, s.stageSize.height / 2]);
}

export { frameObjects, transformMatrix };
export type { EvalObject };
