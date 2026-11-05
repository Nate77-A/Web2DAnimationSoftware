// Timeline copy / paste / delete / ease for frames and keyframes (pure; used by the timeline's hold menu).
//
// Copy  - frames: every layer's drawings inside the range, clipped to it.
//         keyframes: drawing keys copy their whole drawing; tween keys alone copy the key values.
// Paste - frames are inserted at the target frame on the target layer (and the layers below it for multi-layer
//         clips). Later frames move right; a drawing that is cut by the paste point continues after the pasted
//         frames. Nothing is overwritten. Tween keys are pasted onto the same objects at the new frame.
// Delete - frames are removed and later frames move left; a drawing key is cleared so the drawing before it
//          holds through its frames; a tween key is removed from every object keyed on that frame.
import { newId } from './ids';
import type { KeyRef } from './keyframes';
import { cloneContent, cloneObject, growDuration, locateObject, removeFrames, removeKeyframe, setKeyframeEase, shiftSpans } from './ops';
import type { Ease, Exposure, Keyframe, Layer, Project, SceneObject } from './schema';

export interface ClipSpan { start: number; end: number; objects: SceneObject[] } // frames relative to the clip start
export interface ClipLayer { offset: number; spans: ClipSpan[] } // offset: rows below the top copied layer
export type TimelineClip =
  | { kind: 'frames'; length: number; layers: ClipLayer[] }
  | { kind: 'tweenKeys'; length: number; keys: { objectId: string; rel: number; key: Keyframe }[] };

const byStart = (a: Exposure, b: Exposure) => a.startFrame - b.startFrame;
/** Row in the timeline, top layer first. */
const rowOf = (p: Project, layerId: string) => p.layers.length - 1 - p.layers.findIndex((l) => l.id === layerId);
const withKeysShifted = (o: SceneObject, d: number): SceneObject => (o.keyframes.length ? { ...o, keyframes: o.keyframes.map((k) => ({ ...k, frame: k.frame + d })) } : o);
const spanAt = (l: Layer, f: number) => l.exposureTrack.find((e) => f >= e.startFrame && f <= e.endFrame) ?? null;
const contentOf = (l: Layer, e: Exposure) => l.objectTracks.find((c) => c.id === e.contentId);

type Pick = { layer: Layer; span: Exposure; from: number; to: number };

/** Builds a frames clip from (parts of) drawings; `layerIds` also keeps layers that contribute only empty frames. */
function clipFromSpans(p: Project, picks: Pick[], start: number, end: number, layerIds = picks.map((x) => x.layer.id)): TimelineClip {
  const ids = [...new Set(layerIds)];
  const top = Math.min(...ids.map((id) => rowOf(p, id)));
  const layers: ClipLayer[] = ids.map((id) => ({
    offset: rowOf(p, id) - top,
    spans: picks.filter((x) => x.layer.id === id).map(({ layer, span, from, to }) => ({
      start: from - start, end: to - start,
      objects: structuredClone(contentOf(layer, span)?.objects ?? []).map((o) => withKeysShifted(o, -start)),
    })),
  }));
  return { kind: 'frames', length: end - start + 1, layers };
}

/** Copies the frames start..end of the given layers (empty frames included). */
export function copyFrames(p: Project, layerIds: string[], start: number, end: number): TimelineClip {
  const picks = p.layers.filter((l) => layerIds.includes(l.id)).flatMap((layer) => layer.exposureTrack
    .filter((e) => e.endFrame >= start && e.startFrame <= end)
    .map((span) => ({ layer, span, from: Math.max(span.startFrame, start), to: Math.min(span.endFrame, end) })));
  return clipFromSpans(p, picks, start, end, layerIds.filter((id) => p.layers.some((l) => l.id === id)));
}

/** Copies keyframes: drawing keys bring their whole drawing; tween keys alone copy their values. */
export function copyKeys(p: Project, keys: KeyRef[]): TimelineClip | null {
  const drawing = keys.filter((k) => k.kind === 'drawing');
  if (drawing.length) {
    const picks = drawing.flatMap((k) => {
      const layer = p.layers.find((l) => l.id === k.layerId);
      const span = layer?.exposureTrack.find((e) => e.startFrame === k.frame);
      return layer && span ? [{ layer, span, from: span.startFrame, to: span.endFrame }] : [];
    });
    return picks.length ? clipFromSpans(p, picks, Math.min(...picks.map((x) => x.from)), Math.max(...picks.map((x) => x.to))) : null;
  }
  const first = Math.min(...keys.map((k) => k.frame));
  const out: { objectId: string; rel: number; key: Keyframe }[] = [];
  for (const k of keys) {
    const layer = p.layers.find((l) => l.id === k.layerId);
    const span = layer && spanAt(layer, k.frame);
    for (const o of (span && contentOf(layer, span)?.objects) ?? []) {
      const key = o.keyframes.find((x) => x.frame === k.frame);
      if (key) out.push({ objectId: o.id, rel: k.frame - first, key: { ...key } });
    }
  }
  if (!out.length) return null;
  return { kind: 'tweenKeys', length: Math.max(...out.map((x) => x.rel)) + 1, keys: out };
}

/** Inserts `clip` at `frame`, with its top layer on `layerId`. Returns null with a reason when nothing fits. */
export function pasteClip(p: Project, clip: TimelineClip, layerId: string, frame: number): { project: Project } | { reason: string } {
  if (clip.kind === 'tweenKeys') {
    let placed = 0;
    let project = p;
    for (const { objectId, rel, key } of clip.keys) {
      const loc = locateObject(project, objectId);
      if (!loc) continue;
      const f = frame + rel;
      const span = loc.layer.exposureTrack.find((e) => e.contentId === loc.content.id);
      if (!span || f < span.startFrame || f > span.endFrame || loc.layer.locked) continue;
      project = {
        ...project,
        layers: project.layers.map((l) => (l.id !== loc.layer.id ? l : {
          ...l,
          objectTracks: l.objectTracks.map((c) => (c.id !== loc.content.id ? c : {
            ...c,
            objects: c.objects.map((o) => (o.id !== objectId ? o : {
              ...o, keyframes: [...o.keyframes.filter((x) => x.frame !== f), { ...key, frame: f }].sort((a, b) => a.frame - b.frame),
            })),
          })),
        })),
      };
      placed++;
    }
    return placed ? { project } : { reason: 'Tween keys can only be pasted onto frames of the drawing they came from.' };
  }
  const targetRow = rowOf(p, layerId);
  const display = [...p.layers].reverse();
  let project = p;
  let pasted = 0, locked = 0;
  for (const cl of clip.layers) {
    const target = display[targetRow + cl.offset];
    if (!target) continue;
    if (target.locked) { locked++; continue; }
    project = { ...project, layers: project.layers.map((l) => (l.id === target.id ? insertSpans(l, frame, clip.length, cl.spans) : l)) };
    pasted++;
  }
  if (!pasted) return { reason: locked ? 'The target layer is locked.' : 'There is no layer there to paste onto.' };
  return { project: growDuration(project) };
}

function insertSpans(layer: Layer, t: number, length: number, spans: ClipSpan[]): Layer {
  // A drawing that runs across the paste point continues after the pasted frames (as its own copy).
  let l = layer;
  const cut = spanAt(l, t);
  if (cut && cut.startFrame < t) {
    const rest = cloneContent(contentOf(l, cut));
    l = {
      ...l,
      exposureTrack: [...l.exposureTrack.filter((e) => e !== cut), { ...cut, endFrame: t - 1 }, { startFrame: t, endFrame: cut.endFrame, contentId: rest.id }],
      objectTracks: [...l.objectTracks, rest],
    };
  }
  l = shiftSpans(l, t, length);
  const added = spans.map((s) => ({ id: newId('content'), objects: s.objects.map((o) => withKeysShifted(cloneObject(o), t)), s }));
  return {
    ...l,
    exposureTrack: [...l.exposureTrack, ...added.map((a) => ({ startFrame: t + a.s.start, endFrame: t + a.s.end, contentId: a.id }))].sort(byStart),
    objectTracks: [...l.objectTracks, ...added.map((a) => ({ id: a.id, objects: a.objects }))],
  };
}


/** Deletes frames start..end on the layers; later frames move left. */
export function deleteFrameRange(p: Project, layerIds: string[], start: number, end: number): Project {
  return layerIds.reduce((acc, id) => removeFrames(acc, id, start, end), p);
}

/** Clears drawing keys (the previous drawing holds through) and removes tween keys. */
export function deleteKeys(p: Project, keys: KeyRef[]): Project {
  let project = p;
  for (const layerId of new Set(keys.map((k) => k.layerId))) {
    const ks = keys.filter((k) => k.layerId === layerId);
    project = {
      ...project,
      layers: project.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
        const tweenFrames = new Set(ks.filter((k) => k.kind === 'tween').map((k) => k.frame));
        let objectTracks = layer.objectTracks.map((c) => {
          const span = layer.exposureTrack.find((e) => e.contentId === c.id);
          if (!span) return c;
          return { ...c, objects: c.objects.map((o) => [...tweenFrames].filter((f) => f >= span.startFrame && f <= span.endFrame).reduce(removeKeyframe, o)) };
        });
        // Clear drawing keys right to left so neighbors merge correctly.
        let spans = [...layer.exposureTrack].sort(byStart);
        const cleared = new Set(ks.filter((k) => k.kind === 'drawing').map((k) => k.frame));
        for (let i = spans.length - 1; i >= 0; i--) {
          const s = spans[i];
          if (!cleared.has(s.startFrame)) continue;
          const prev = spans[i - 1];
          spans = prev && prev.endFrame + 1 === s.startFrame
            ? spans.map((x) => (x === prev ? { ...prev, endFrame: s.endFrame } : x)).filter((x) => x !== s)
            : spans.filter((x) => x !== s);
          objectTracks = objectTracks.filter((c) => c.id !== s.contentId);
        }
        return { ...layer, exposureTrack: spans, objectTracks };
      }),
    };
  }
  return project;
}

/** The objects keyed at a timeline key: the key's own frame for tween keys, a drawing's first frame for drawing keys. */
function keyedObjects(p: Project, k: KeyRef): { layer: Layer; contentId: string; objects: SceneObject[] } | null {
  const layer = p.layers.find((l) => l.id === k.layerId);
  const span = layer && spanAt(layer, k.frame);
  const content = span && contentOf(layer, span);
  if (!layer || !content) return null;
  return { layer, contentId: content.id, objects: content.objects.filter((o) => o.keyframes.some((x) => x.frame === k.frame)) };
}

/** Ease of the key (null when its objects disagree), or undefined when nothing is keyed there. */
export function keyEase(p: Project, k: KeyRef): Ease | null | undefined {
  const objs = keyedObjects(p, k)?.objects ?? [];
  if (!objs.length) return undefined;
  const eases = new Set(objs.map((o) => o.keyframes.find((x) => x.frame === k.frame)!.ease));
  return eases.size === 1 ? [...eases][0] : null;
}

export function setKeyEase(p: Project, k: KeyRef, ease: Ease): Project {
  const hit = keyedObjects(p, k);
  if (!hit?.objects.length) return p;
  const ids = new Set(hit.objects.map((o) => o.id));
  return {
    ...p,
    layers: p.layers.map((l) => (l.id !== hit.layer.id ? l : {
      ...l,
      objectTracks: l.objectTracks.map((c) => (c.id !== hit.contentId ? c : { ...c, objects: c.objects.map((o) => (ids.has(o.id) ? setKeyframeEase(o, k.frame, ease) : o)) })),
    })),
  };
}
