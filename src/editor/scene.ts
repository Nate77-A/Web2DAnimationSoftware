// Editor-side queries over the evaluated current frame: hit testing (Paper.js), selection bounds, viewport math.
import { evaluateLayer, isLayerEffectivelyVisible, type EvalObject } from '../domain/evaluator';
import { apply, invert, type Matrix, type Rect, rectCorners, rectsIntersect, transformRect, unionRects } from '../domain/math';
import type { Vec } from '../domain/schema';
import { paperContains, paperDistance } from './paperAdapter';
import { cachedLocalBounds } from './renderer';
import type { AppState, Viewport } from './state';

export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 32;

export function docToScreen(v: Viewport, p: Vec): Vec { return [p[0] * v.zoom + v.panX, p[1] * v.zoom + v.panY]; }
export function screenToDoc(v: Viewport, p: Vec): Vec { return [(p[0] - v.panX) / v.zoom, (p[1] - v.panY) / v.zoom]; }
export function viewMatrix(v: Viewport): Matrix { return [v.zoom, 0, 0, v.zoom, v.panX, v.panY]; }

/** Zoom about a screen anchor point; document coordinates are never touched. */
export function zoomAt(v: Viewport, zoom: number, anchor: Vec): Viewport {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const d = screenToDoc(v, anchor);
  return { zoom: z, panX: anchor[0] - d[0] * z, panY: anchor[1] - d[1] * z };
}

export function fitViewport(stage: { width: number; height: number }, doc: { width: number; height: number }, margin = 48): Viewport {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((stage.width - margin * 2) / doc.width, (stage.height - margin * 2) / doc.height)));
  return { zoom: z, panX: (stage.width - doc.width * z) / 2, panY: (stage.height - doc.height * z) / 2 };
}

/** Evaluated objects on the current frame, top-most first. */
export function frameObjects(s: AppState, opts: { editableOnly?: boolean; layerIds?: string[] } = {}): EvalObject[] {
  const out: EvalObject[] = [];
  for (let i = s.project.layers.length - 1; i >= 0; i--) {
    const layer = s.project.layers[i];
    if (!isLayerEffectivelyVisible(s.project, layer)) continue;
    if (opts.editableOnly && layer.locked) continue;
    if (opts.layerIds && !opts.layerIds.includes(layer.id)) continue;
    const objs = evaluateLayer(layer, s.currentFrame, undefined, s.project);
    for (let j = objs.length - 1; j >= 0; j--) {
      if (opts.editableOnly && objs[j].source.locked) continue;
      out.push(objs[j]);
    }
  }
  return out;
}

export function worldBounds(eo: EvalObject): Rect {
  return transformRect(eo.matrix, cachedLocalBounds(eo.source));
}

export function worldCorners(eo: EvalObject): Vec[] {
  return rectCorners(cachedLocalBounds(eo.source)).map((p) => apply(eo.matrix, p));
}

/** Hit-tests one object at a document point with a tolerance in document units. */
export function hitObject(eo: EvalObject, p: Vec, tol: number): boolean {
  const inv = invert(eo.matrix);
  const lp = apply(inv, p);
  const sx = Math.hypot(eo.matrix[0], eo.matrix[1]) || 1, sy = Math.hypot(eo.matrix[2], eo.matrix[3]) || 1;
  const ltol = tol / Math.min(sx, sy);
  const o = eo.source;
  const b = cachedLocalBounds(o);
  const pad = ltol + (o.style.stroke.type !== 'none' ? o.style.strokeWidth : 0);
  if (lp[0] < b.x - pad || lp[0] > b.x + b.width + pad || lp[1] < b.y - pad || lp[1] > b.y + b.height + pad) return false;
  // Boxes without a fill to hit: text, images, groups and null objects are picked anywhere inside their bounds.
  if (o.kind === 'text' || o.kind === 'bitmap' || o.kind === 'group' || (o.kind === 'shape' && o.geometry.shape === 'null')) {
    return lp[0] >= b.x - ltol && lp[0] <= b.x + b.width + ltol && lp[1] >= b.y - ltol && lp[1] <= b.y + b.height + ltol;
  }
  const closed = o.kind === 'shape' || o.geometry.closed;
  if (closed && (o.style.fill.type !== 'none' || o.kind === 'path') && paperContains(o, lp)) return true;
  // Round-capped stroke test: within half the stroke width plus tolerance of the outline.
  const half = (o.style.stroke.type !== 'none' ? o.style.strokeWidth : 0) / 2;
  return paperDistance(o, lp) <= half + ltol;
}

export function hitTest(s: AppState, p: Vec, tolScreenPx = 4, opts: { editableOnly?: boolean; layerIds?: string[] } = { editableOnly: true }): EvalObject | null {
  const tol = tolScreenPx / s.viewport.zoom;
  for (const eo of frameObjects(s, opts)) if (hitObject(eo, p, tol)) return eo;
  return null;
}

export function objectsInRect(s: AppState, r: Rect): string[] {
  return frameObjects(s, { editableOnly: true }).filter((eo) => rectsIntersect(worldBounds(eo), r)).map((eo) => eo.source.id);
}

export interface SelectionInfo {
  objects: EvalObject[];
  bounds: Rect; // axis-aligned in document space
  single: EvalObject | null;
}

export function selectionInfo(s: AppState): SelectionInfo | null {
  if (!s.selection.length) return null;
  const set = new Set(s.selection);
  const objects = frameObjects(s, {}).filter((eo) => set.has(eo.source.id));
  if (!objects.length) return null;
  const bounds = unionRects(objects.map(worldBounds))!;
  return { objects, bounds, single: objects.length === 1 ? objects[0] : null };
}
