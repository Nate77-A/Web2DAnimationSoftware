// Timeline keyframes: listing, selecting and moving them. Two kinds appear on a layer's track:
//   drawing  - where an exposure span (a drawing) starts
//   tween    - motion-tween keys of the objects in a span (all objects keyed on that frame move together)
//
// Moving follows the familiar keyframe-timeline rules:
//   - A moved drawing key changes when its drawing starts. A span that ran up to the next drawing still does,
//     so the previous drawing holds longer or shorter and the following drawing is untouched. A span followed
//     by empty frames (or the last span) keeps its length and moves as a whole.
//   - Tween keys of a span that moves as a whole travel with it; otherwise only the key on the span's first
//     frame follows the drawing key.
//   - A key never passes a neighboring key or lands on another key; such a move is rejected (returns null).
import type { Exposure, Layer, Project } from './schema';

export interface KeyRef { layerId: string; frame: number; kind: 'drawing' | 'tween' }

export const keyId = (k: KeyRef) => `${k.layerId}:${k.kind}:${k.frame}`;

const byStart = (a: Exposure, b: Exposure) => a.startFrame - b.startFrame;

/** Frames of the tween keys shown inside a span (keys of any object in its content). */
export function spanTweenKeys(layer: Layer, span: Exposure): number[] {
  const content = layer.objectTracks.find((c) => c.id === span.contentId);
  const set = new Set<number>();
  for (const o of content?.objects ?? []) for (const k of o.keyframes) if (k.frame >= span.startFrame && k.frame <= span.endFrame) set.add(k.frame);
  return [...set].sort((a, b) => a - b);
}

/** Every key on a layer. */
export function layerKeys(layer: Layer): KeyRef[] {
  const out: KeyRef[] = [];
  for (const span of [...layer.exposureTrack].sort(byStart)) {
    out.push({ layerId: layer.id, frame: span.startFrame, kind: 'drawing' });
    for (const f of spanTweenKeys(layer, span)) out.push({ layerId: layer.id, frame: f, kind: 'tween' });
  }
  return out;
}

/** Keys on the given layers between two frames (inclusive). */
export function keysInRange(p: Project, layerIds: string[], start: number, end: number): KeyRef[] {
  return p.layers.filter((l) => layerIds.includes(l.id)).flatMap((l) => layerKeys(l).filter((k) => k.frame >= start && k.frame <= end));
}

/** Keys from `keys` that still exist (e.g. after undo). */
export function existingKeys(p: Project, keys: KeyRef[]): KeyRef[] {
  const all = new Set(p.layers.flatMap(layerKeys).map(keyId));
  return keys.filter((k) => all.has(keyId(k)));
}

/** Moves the keys by `delta` frames, or returns null when the move is not allowed. */
export function moveKeys(p: Project, keys: KeyRef[], delta: number): Project | null {
  if (!delta) return p;
  const live = existingKeys(p, keys);
  if (!live.length) return null;
  let layers = p.layers;
  for (const layerId of new Set(live.map((k) => k.layerId))) {
    const layer = layers.find((l) => l.id === layerId)!;
    const next = moveLayerKeys(layer, live.filter((k) => k.layerId === layerId), delta);
    if (!next) return null;
    layers = layers.map((l) => (l.id === layerId ? next : l));
  }
  const lastFrame = Math.max(...layers.flatMap((l) => l.exposureTrack.map((e) => e.endFrame)), 0);
  return { ...p, layers, durationFrames: Math.max(p.durationFrames, lastFrame + 1) };
}

function moveLayerKeys(layer: Layer, keys: KeyRef[], d: number): Layer | null {
  const spans = [...layer.exposureTrack].sort(byStart);
  const drawing = new Set(keys.filter((k) => k.kind === 'drawing').map((k) => k.frame));
  const tween = new Set(keys.filter((k) => k.kind === 'tween').map((k) => k.frame));

  // New span starts; order must be kept and frames stay non-negative.
  const starts = spans.map((s) => (drawing.has(s.startFrame) ? s.startFrame + d : s.startFrame));
  if (starts.some((s, i) => s < 0 || (i > 0 && s <= starts[i - 1]))) return null;
  const moved = spans.map((s, i): Exposure => {
    const next = spans[i + 1];
    let end: number;
    if (next && s.endFrame + 1 === next.startFrame) end = starts[i + 1] - 1; // still runs up to the next drawing
    else {
      end = starts[i] + (s.endFrame - s.startFrame); // followed by empty frames: keep the length
      if (next && end >= starts[i + 1]) end = starts[i + 1] - 1;
    }
    return { ...s, startFrame: starts[i], endFrame: end };
  });

  const spanOf = new Map(spans.map((s, i) => [s.contentId, { old: s, now: moved[i] }]));
  const objectTracks = [];
  for (const c of layer.objectTracks) {
    const sp = spanOf.get(c.id);
    if (!sp) { objectTracks.push(c); continue; }
    const { old, now } = sp;
    const ds = now.startFrame - old.startFrame, de = now.endFrame - old.endFrame;
    const rigid = ds !== 0 && ds === de;
    const shift = (f: number) => {
      if (f < old.startFrame || f > old.endFrame) return 0; // keys outside the span are left alone
      if (rigid) return ds;
      if (ds && f === old.startFrame) return ds;
      return tween.has(f) ? d : 0;
    };
    const objects = [];
    for (const o of c.objects) {
      if (!o.keyframes.length) { objects.push(o); continue; }
      const keyframes = o.keyframes.map((k) => ({ ...k, frame: k.frame + shift(k.frame) }));
      const inside = o.keyframes.map((k, i) => [k, keyframes[i]] as const).filter(([k]) => k.frame >= old.startFrame && k.frame <= old.endFrame);
      if (inside.some(([, k]) => k.frame < now.startFrame || k.frame > now.endFrame)) return null; // a key would leave its drawing
      if (new Set(keyframes.map((k) => k.frame)).size !== keyframes.length) return null; // two keys on one frame
      objects.push({ ...o, keyframes: keyframes.sort((a, b) => a.frame - b.frame) });
    }
    objectTracks.push({ ...c, objects });
  }
  return { ...layer, exposureTrack: moved, objectTracks };
}

/**
 * Largest move toward `delta` that is allowed (stops at the first blocked step), so a drag halts at a
 * neighboring key instead of jumping past it. Returns the project and the delta actually applied.
 */
export function clampedMove(p: Project, keys: KeyRef[], delta: number): { project: Project; delta: number } {
  const step = Math.sign(delta);
  let best = { project: p, delta: 0 };
  for (let d = step; d !== delta + step; d += step) {
    const next = moveKeys(p, keys, d);
    if (!next) break;
    best = { project: next, delta: d };
  }
  return best;
}
