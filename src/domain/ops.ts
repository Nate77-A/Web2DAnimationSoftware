// Pure, immutable project operations. Every user-visible mutation is built from these and then
// recorded as a command (see editor/history.ts). Untouched branches are structurally shared.
import { createLayer } from './defaults';
import { exposureAt, sampleObject } from './evaluator';
import { newId } from './ids';
import type { Content, Ease, Exposure, Keyframe, Layer, Project, SceneObject, Transform } from './schema';

// ---------------------------------------------------------------- helpers

export function mapLayer(p: Project, layerId: string, fn: (l: Layer) => Layer): Project {
  let changed = false;
  const layers = p.layers.map((l) => {
    if (l.id !== layerId) return l;
    const n = fn(l);
    if (n !== l) changed = true;
    return n;
  });
  return changed ? { ...p, layers } : p;
}

export function growDuration(p: Project): Project {
  let max = 0;
  for (const l of p.layers) for (const e of l.exposureTrack) max = Math.max(max, e.endFrame + 1);
  return max > p.durationFrames ? { ...p, durationFrames: max } : p;
}

function sortSpans(spans: Exposure[]): Exposure[] {
  return [...spans].sort((a, b) => a.startFrame - b.startFrame);
}

export function cloneObject(o: SceneObject): SceneObject {
  const c = structuredClone(o) as SceneObject;
  const reid = (x: SceneObject) => {
    x.id = newId('obj');
    if (x.kind === 'group') x.children.forEach(reid);
  };
  reid(c);
  return c;
}

/** Clones objects with new ids; parent links between objects in the batch point at the new copies. */
export function cloneObjects(objs: SceneObject[]): SceneObject[] {
  const copies = objs.map(cloneObject);
  const ids = new Map(objs.map((o, i) => [o.id, copies[i].id]));
  return copies.map((c) => (c.link && ids.has(c.link.parentId) ? { ...c, link: { ...c.link, parentId: ids.get(c.link.parentId)! } } : c));
}

export function cloneContent(c: Content | undefined): Content {
  return { id: newId('content'), objects: c ? cloneObjects(c.objects) : [] };
}

function shiftKeyframes(c: Content, delta: number): Content {
  if (!delta || !c.objects.some((o) => o.keyframes.length)) return c;
  return {
    ...c,
    objects: c.objects.map((o) => o.keyframes.length
      ? { ...o, keyframes: o.keyframes.map((k) => ({ ...k, frame: Math.max(0, k.frame + delta) })) }
      : o),
  };
}

/** Shifts every span starting at or after `from` by delta, moving their keyframes with them. */
export function shiftSpans(layer: Layer, from: number, delta: number): Layer {
  const moved = new Set<string>();
  const exposureTrack = layer.exposureTrack.map((e) => {
    if (e.startFrame < from) return e;
    moved.add(e.contentId);
    return { ...e, startFrame: e.startFrame + delta, endFrame: e.endFrame + delta };
  });
  const objectTracks = layer.objectTracks.map((c) => (moved.has(c.id) ? shiftKeyframes(c, delta) : c));
  return { ...layer, exposureTrack, objectTracks };
}

// ---------------------------------------------------------------- objects

export interface ObjectLocation { layerIndex: number; contentIndex: number; objectIndex: number; layer: Layer; content: Content; object: SceneObject }

export function locateObject(p: Project, id: string): ObjectLocation | null {
  for (let li = 0; li < p.layers.length; li++) {
    const layer = p.layers[li];
    for (let ci = 0; ci < layer.objectTracks.length; ci++) {
      const content = layer.objectTracks[ci];
      const oi = content.objects.findIndex((o) => o.id === id);
      if (oi >= 0) return { layerIndex: li, contentIndex: ci, objectIndex: oi, layer, content, object: content.objects[oi] };
    }
  }
  return null;
}

export function mapObjects(p: Project, ids: Iterable<string>, fn: (o: SceneObject) => SceneObject): Project {
  const set = new Set(ids);
  if (!set.size) return p;
  let changed = false;
  const layers = p.layers.map((layer) => {
    let lc = false;
    const objectTracks = layer.objectTracks.map((c) => {
      if (!c.objects.some((o) => set.has(o.id))) return c;
      const objects = c.objects.map((o) => {
        if (!set.has(o.id)) return o;
        const n = fn(o);
        if (n !== o) lc = true;
        return n;
      });
      return lc ? { ...c, objects } : c;
    });
    if (!lc) return layer;
    changed = true;
    return { ...layer, objectTracks };
  });
  return changed ? { ...p, layers } : p;
}

/** Ensures the layer has content exposed at `frame`, creating a one-frame keyframe span if empty. */
export function ensureContentAt(p: Project, layerId: string, frame: number): { project: Project; contentId: string } {
  const layer = p.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error('Layer not found');
  const e = exposureAt(layer, frame);
  if (e) return { project: p, contentId: e.contentId };
  const content: Content = { id: newId('content'), objects: [] };
  const project = growDuration(mapLayer(p, layerId, (l) => ({
    ...l,
    exposureTrack: sortSpans([...l.exposureTrack, { startFrame: frame, endFrame: frame, contentId: content.id }]),
    objectTracks: [...l.objectTracks, content],
  })));
  return { project, contentId: content.id };
}

export function addObjects(p: Project, layerId: string, frame: number, objs: SceneObject[]): Project {
  const { project, contentId } = ensureContentAt(p, layerId, frame);
  return mapLayer(project, layerId, (l) => ({
    ...l,
    objectTracks: l.objectTracks.map((c) => (c.id === contentId ? { ...c, objects: [...c.objects, ...objs] } : c)),
  }));
}

export function removeObjects(p: Project, ids: Iterable<string>): Project {
  const set = new Set(ids);
  return {
    ...p,
    layers: p.layers.map((l) => (l.objectTracks.some((c) => c.objects.some((o) => set.has(o.id)))
      ? { ...l, objectTracks: l.objectTracks.map((c) => ({ ...c, objects: c.objects.filter((o) => !set.has(o.id)) })) }
      : l)),
  };
}

export function replaceObject(p: Project, id: string, replacements: SceneObject[]): Project {
  return {
    ...p,
    layers: p.layers.map((l) => (l.objectTracks.some((c) => c.objects.some((o) => o.id === id))
      ? { ...l, objectTracks: l.objectTracks.map((c) => ({ ...c, objects: c.objects.flatMap((o) => (o.id === id ? replacements : [o])) })) }
      : l)),
  };
}

export type ArrangeMode = 'front' | 'forward' | 'backward' | 'back';

export function arrangeObjects(p: Project, ids: string[], mode: ArrangeMode): Project {
  const set = new Set(ids);
  return {
    ...p,
    layers: p.layers.map((l) => ({
      ...l,
      objectTracks: l.objectTracks.map((c) => {
        if (!c.objects.some((o) => set.has(o.id))) return c;
        const sel = c.objects.filter((o) => set.has(o.id));
        const rest = c.objects.filter((o) => !set.has(o.id));
        if (mode === 'front') return { ...c, objects: [...rest, ...sel] };
        if (mode === 'back') return { ...c, objects: [...sel, ...rest] };
        const arr = [...c.objects];
        if (mode === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) if (set.has(arr[i].id) && !set.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        } else {
          for (let i = 1; i < arr.length; i++) if (set.has(arr[i].id) && !set.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
        }
        return { ...c, objects: arr };
      }),
    })),
  };
}

/**
 * Auto-key semantics: if the object has keyframes, the edit is written into a keyframe at `frame`
 * (created if missing); otherwise the base transform/opacity are edited.
 */
export function setObjectTransform(o: SceneObject, frame: number, patch: Partial<Transform>, opacity?: number): SceneObject {
  if (!o.keyframes.length) {
    return { ...o, transform: { ...o.transform, ...patch }, ...(opacity !== undefined ? { opacity } : {}) };
  }
  const cur = sampleObject(o, frame);
  const t = { ...cur.transform, ...patch };
  // Pivot is not keyed; keep it on the base transform.
  const base = patch.pivotX !== undefined || patch.pivotY !== undefined
    ? { ...o.transform, pivotX: t.pivotX, pivotY: t.pivotY } : o.transform;
  const existing = o.keyframes.find((k) => k.frame === frame);
  const key: Keyframe = {
    frame, x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY,
    opacity: opacity ?? cur.opacity, ease: existing?.ease ?? 'linear',
  };
  const keyframes = [...o.keyframes.filter((k) => k.frame !== frame), key].sort((a, b) => a.frame - b.frame);
  return { ...o, transform: base, keyframes };
}

export function addKeyframe(o: SceneObject, frame: number): SceneObject {
  const cur = sampleObject(o, frame);
  const existing = o.keyframes.find((k) => k.frame === frame);
  const key: Keyframe = { frame, ...pickKeyed(cur.transform), opacity: cur.opacity, ease: existing?.ease ?? 'linear' };
  return { ...o, keyframes: [...o.keyframes.filter((k) => k.frame !== frame), key].sort((a, b) => a.frame - b.frame) };
}

export function removeKeyframe(o: SceneObject, frame: number): SceneObject {
  if (!o.keyframes.some((k) => k.frame === frame)) return o;
  const cur = sampleObject(o, frame);
  const keyframes = o.keyframes.filter((k) => k.frame !== frame);
  // When the last key is removed, bake the current values into the base transform.
  return keyframes.length ? { ...o, keyframes } : { ...o, keyframes, transform: cur.transform, opacity: cur.opacity };
}

export function setKeyframeEase(o: SceneObject, frame: number, ease: Ease): SceneObject {
  return { ...o, keyframes: o.keyframes.map((k) => (k.frame === frame ? { ...k, ease } : k)) };
}

function pickKeyed(t: Transform) {
  return { x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY };
}

/**
 * Create Motion Tween: holds the selection's span for at least one second (inserting frames if needed),
 * then keys the current values at the span start and end. Move the playhead to the end and transform
 * the object to complete the tween.
 */
export function createTween(p: Project, ids: string[], frame: number): { project: Project; endFrame: number } | null {
  const loc = ids.map((id) => locateObject(p, id)).find(Boolean);
  if (!loc) return null;
  const layer = loc.layer;
  const span = layer.exposureTrack.find((e) => e.contentId === loc.content.id);
  if (!span) return null;
  const next = sortSpans(layer.exposureTrack).find((s) => s.startFrame > span.startFrame);
  // Hold for at least one second. If the next keyframe is in the way, insert frames to make room
  // (later artwork shifts right, as when inserting frames).
  const end = Math.max(span.endFrame, span.startFrame + p.fps - 1);
  if (end <= span.startFrame) return null;
  let project = mapLayer(p, layer.id, (l) => {
    const room = next ? end - (next.startFrame - 1) : 0;
    const shifted = room > 0 ? shiftSpans(l, next!.startFrame, room) : l;
    return { ...shifted, exposureTrack: shifted.exposureTrack.map((e) => (e.contentId === span.contentId ? { ...e, endFrame: end } : e)) };
  });
  const idSet = new Set(ids.filter((id) => loc.content.objects.some((o) => o.id === id)));
  project = mapObjects(project, idSet, (o) => {
    const start = addKeyframe(o, span.startFrame);
    return o.keyframes.some((k) => k.frame >= end) ? start : addKeyframe(start, end);
  });
  void frame;
  return { project: growDuration(project), endFrame: end };
}

// ---------------------------------------------------------------- frames

/**
 * Inserts a new keyframe span at frame t holding `content`:
 *  - t inside a span that started earlier -> split the span at t
 *  - t is the start of a span -> shift that span and later ones right by one frame
 *  - t empty -> new one-frame span
 */
function insertKeyAt(layer: Layer, t: number, content: Content): Layer {
  const s = exposureAt(layer, t);
  if (s && s.startFrame < t) {
    return {
      ...layer,
      exposureTrack: sortSpans([
        ...layer.exposureTrack.filter((e) => e !== s),
        { ...s, endFrame: t - 1 },
        { startFrame: t, endFrame: s.endFrame, contentId: content.id },
      ]),
      objectTracks: [...layer.objectTracks, content],
    };
  }
  const base = s ? shiftSpans(layer, t, 1) : layer;
  return {
    ...base,
    exposureTrack: sortSpans([...base.exposureTrack, { startFrame: t, endFrame: t, contentId: content.id }]),
    objectTracks: [...base.objectTracks, content],
  };
}

/** Duplicate Frame: copies the frame at f to f+1 as independent, editable content. */
export function duplicateFrame(p: Project, layerId: string, f: number): { project: Project; target: number } {
  const layer = p.layers.find((l) => l.id === layerId)!;
  const e = exposureAt(layer, f);
  const src = e ? layer.objectTracks.find((c) => c.id === e.contentId) : undefined;
  const copy = cloneContent(src);
  return { project: growDuration(mapLayer(p, layerId, (l) => insertKeyAt(l, f + 1, copy))), target: f + 1 };
}

/** Add Blank Frame: inserts an empty keyframe at f+1. */
export function addBlankKeyframe(p: Project, layerId: string, f: number): { project: Project; target: number } {
  const blank: Content = { id: newId('content'), objects: [] };
  return { project: growDuration(mapLayer(p, layerId, (l) => insertKeyAt(l, f + 1, blank))), target: f + 1 };
}

/** Insert Frame: extends the hold at f by `count` frames, shifting later spans right. */
export function insertFrames(p: Project, layerId: string, f: number, count = 1): Project {
  return growDuration(mapLayer(p, layerId, (l) => {
    const s = exposureAt(l, f);
    if (s) {
      const shifted = shiftSpans(l, s.endFrame + 1, count);
      return { ...shifted, exposureTrack: shifted.exposureTrack.map((e) => (e.contentId === s.contentId && e.startFrame === s.startFrame ? { ...e, endFrame: e.endFrame + count } : e)) };
    }
    const prev = sortSpans(l.exposureTrack).filter((e) => e.endFrame < f).pop();
    if (!prev) return l;
    return { ...l, exposureTrack: l.exposureTrack.map((e) => (e === prev ? { ...e, endFrame: f } : e)) };
  }));
}

/**
 * Delete Frames [start..end]: removes those frames from the layer. Spans shrink (and disappear when
 * empty) and every later frame shifts left, so the following artwork moves earlier in time.
 */
export function removeFrames(p: Project, layerId: string, start: number, end: number): Project {
  const n = end - start + 1;
  return mapLayer(p, layerId, (l) => {
    const keep: Exposure[] = [];
    const dropped = new Set<string>();
    const deltas = new Map<string, number>();
    for (const e of l.exposureTrack) {
      if (e.endFrame < start) { keep.push(e); continue; }
      if (e.startFrame > end) {
        keep.push({ ...e, startFrame: e.startFrame - n, endFrame: e.endFrame - n });
        deltas.set(e.contentId, -n);
        continue;
      }
      // Span overlaps the removed range: keep the frames before and after it.
      const before = Math.max(0, Math.min(e.endFrame, start - 1) - e.startFrame + 1);
      const after = Math.max(0, e.endFrame - Math.max(e.startFrame, end + 1) + 1);
      const len = before + after;
      if (len <= 0) { dropped.add(e.contentId); continue; }
      const newStart = Math.min(e.startFrame, start);
      if (newStart !== e.startFrame) deltas.set(e.contentId, newStart - e.startFrame);
      keep.push({ ...e, startFrame: newStart, endFrame: newStart + len - 1 });
    }
    return {
      ...l,
      exposureTrack: sortSpans(keep),
      objectTracks: l.objectTracks
        .filter((c) => !dropped.has(c.id))
        .map((c) => (deltas.has(c.id) ? shiftKeyframes(c, deltas.get(c.id)!) : c)),
    };
  });
}

export function clearFrame(p: Project, layerId: string, f: number): Project {
  return mapLayer(p, layerId, (l) => {
    const e = exposureAt(l, f);
    if (!e) return l;
    return { ...l, objectTracks: l.objectTracks.map((c) => (c.id === e.contentId ? { ...c, objects: [] } : c)) };
  });
}

// ---------------------------------------------------------------- layers

function reorder(p: Project, layers: Layer[]): Project {
  return { ...p, layers: layers.map((l, i) => (l.order === i ? l : { ...l, order: i })) };
}

export function addLayer(p: Project, aboveLayerId?: string): { project: Project; layerId: string } {
  const n = p.layers.length + 1;
  let name = `Layer ${n}`;
  for (let k = n; p.layers.some((l) => l.name === name); k++) name = `Layer ${k + 1}`;
  const layer = createLayer(name, p.layers.length);
  const idx = aboveLayerId ? p.layers.findIndex((l) => l.id === aboveLayerId) + 1 : p.layers.length;
  const layers = [...p.layers];
  layers.splice(idx <= 0 ? layers.length : idx, 0, layer);
  return { project: reorder(p, layers), layerId: layer.id };
}

export function deleteLayer(p: Project, layerId: string): Project {
  if (p.layers.length <= 1) return p;
  return reorder(p, p.layers.filter((l) => l.id !== layerId));
}

export function duplicateLayer(p: Project, layerId: string): { project: Project; layerId: string } {
  const idx = p.layers.findIndex((l) => l.id === layerId);
  const src = p.layers[idx];
  const map = new Map<string, Content>();
  for (const c of src.objectTracks) map.set(c.id, cloneContent(c));
  const copy: Layer = {
    ...src,
    id: newId('layer'),
    name: `${src.name} copy`,
    solo: false,
    exposureTrack: src.exposureTrack.map((e) => ({ ...e, contentId: map.get(e.contentId)!.id })),
    objectTracks: [...map.values()],
  };
  const layers = [...p.layers];
  layers.splice(idx + 1, 0, copy);
  return { project: reorder(p, layers), layerId: copy.id };
}

export function moveLayer(p: Project, layerId: string, toIndex: number): Project {
  const from = p.layers.findIndex((l) => l.id === layerId);
  if (from < 0) return p;
  const layers = [...p.layers];
  const [l] = layers.splice(from, 1);
  layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
  return reorder(p, layers);
}

export function updateLayer(p: Project, layerId: string, patch: Partial<Layer>): Project {
  return mapLayer(p, layerId, (l) => ({ ...l, ...patch }));
}

/** Changing dimensions never scales artwork unless `scaleArtwork` is set (confirmed by the user). */
export function resizeDocument(p: Project, width: number, height: number, scaleArtwork: boolean): Project {
  if (!scaleArtwork) return { ...p, width, height };
  const sx = width / p.width, sy = height / p.height;
  const s = Math.min(sx, sy);
  const scaleT = <T extends { x: number; y: number; scaleX: number; scaleY: number }>(t: T): T => ({ ...t, x: t.x * sx, y: t.y * sy, scaleX: t.scaleX * s, scaleY: t.scaleY * s });
  return {
    ...p,
    width, height,
    layers: p.layers.map((l) => ({
      ...l,
      objectTracks: l.objectTracks.map((c) => ({
        ...c,
        objects: c.objects.map((o) => ({ ...o, transform: scaleT(o.transform), keyframes: o.keyframes.map(scaleT) })),
      })),
    })),
  };
}

/** All keyframe frame numbers (absolute) for objects in a layer's content. */
export function layerKeyFrames(layer: Layer): Set<number> {
  const out = new Set<number>();
  for (const c of layer.objectTracks) for (const o of c.objects) for (const k of o.keyframes) out.add(k.frame);
  return out;
}
