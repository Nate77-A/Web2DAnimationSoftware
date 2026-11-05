// Pure timeline evaluator: (Project, frame) -> renderable scene. The stage preview and every exporter
// call this same function, so preview frames equal exported frames.
import { parentSpace } from './links';
import { type Matrix, multiply, transformMatrix, lerp } from './math';
import type { BlendMode, Content, Ease, Exposure, Keyframe, Layer, Project, SceneObject, Transform } from './schema';

export interface EvalObject {
  source: SceneObject;
  layerId: string;
  transform: Transform;
  opacity: number;
  matrix: Matrix;
}

export interface EvalLayer { id: string; blendMode: BlendMode; objects: EvalObject[] }

export interface EvaluatedScene {
  frame: number;
  width: number;
  height: number;
  background: string | null;
  layers: EvalLayer[]; // bottom -> top
}

export interface EvaluateOptions {
  /** Include layers hidden by visibility/solo (editor uses this for nothing; exports never). */
  includeHidden?: boolean;
  /** Restrict to these layers (eyedropper "active layer only"). */
  layerIds?: string[];
  /** Skip objects with these ids (e.g. text being edited in place). */
  skipObjectIds?: Set<string>;
}

export function exposureAt(layer: Layer, frame: number): Exposure | null {
  for (const e of layer.exposureTrack) if (frame >= e.startFrame && frame <= e.endFrame) return e;
  return null;
}

export function contentAt(layer: Layer, frame: number): Content | null {
  const e = exposureAt(layer, frame);
  return e ? layer.objectTracks.find((c) => c.id === e.contentId) ?? null : null;
}

/** Solo makes only soloed layers visible; multiple solo layers may coexist. */
export function isLayerEffectivelyVisible(project: Project, layer: Layer): boolean {
  const anySolo = project.layers.some((l) => l.solo);
  return anySolo ? layer.solo : layer.visible;
}

export function applyEase(t: number, ease: Ease): number {
  switch (ease) {
    case 'linear': return t;
    case 'easeIn': return t * t * t;
    case 'easeOut': return 1 - (1 - t) ** 3;
    case 'easeInOut': return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }
}

/** Keyed property sampling. Before first key: first values; after last: last values; between: eased lerp. */
export function sampleObject(o: SceneObject, frame: number): { transform: Transform; opacity: number } {
  const keys = o.keyframes;
  if (!keys.length) return { transform: o.transform, opacity: o.opacity };
  const sorted = keys.length > 1 && !isSorted(keys) ? [...keys].sort((a, b) => a.frame - b.frame) : keys;
  let a: Keyframe = sorted[0], b: Keyframe = sorted[0], t = 0;
  if (frame <= sorted[0].frame) { a = b = sorted[0]; }
  else if (frame >= sorted[sorted.length - 1].frame) { a = b = sorted[sorted.length - 1]; }
  else {
    for (let i = 0; i < sorted.length - 1; i++) {
      if (frame >= sorted[i].frame && frame <= sorted[i + 1].frame) {
        a = sorted[i]; b = sorted[i + 1];
        t = applyEase((frame - a.frame) / (b.frame - a.frame), a.ease);
        break;
      }
    }
  }
  return {
    transform: {
      ...o.transform,
      x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), rotation: lerp(a.rotation, b.rotation, t),
      scaleX: lerp(a.scaleX, b.scaleX, t), scaleY: lerp(a.scaleY, b.scaleY, t),
    },
    opacity: lerp(a.opacity, b.opacity, t),
  };
}

function isSorted(k: Keyframe[]): boolean {
  for (let i = 1; i < k.length; i++) if (k[i].frame < k[i - 1].frame) return false;
  return true;
}

/**
 * Objects of a layer on a frame. Pass the project so linked children follow their parents (in any layer);
 * without it, matrices are the objects' own transforms.
 */
export function evaluateLayer(layer: Layer, frame: number, skip?: Set<string>, project?: Project): EvalObject[] {
  const content = contentAt(layer, frame);
  if (!content) return [];
  const out: EvalObject[] = [];
  for (const o of content.objects) {
    if (!o.visible || skip?.has(o.id)) continue;
    const { transform, opacity } = sampleObject(o, frame);
    const own = transformMatrix(transform);
    const matrix = project && o.link ? multiply(parentSpace(project, o, frame), own) : own;
    out.push({ source: o, layerId: layer.id, transform, opacity, matrix });
  }
  return out;
}

export function evaluateFrame(project: Project, frame: number, opts: EvaluateOptions = {}): EvaluatedScene {
  const layers: EvalLayer[] = [];
  for (const layer of project.layers) {
    if (!opts.includeHidden && !isLayerEffectivelyVisible(project, layer)) continue;
    if (opts.layerIds && !opts.layerIds.includes(layer.id)) continue;
    layers.push({ id: layer.id, blendMode: layer.blendMode, objects: evaluateLayer(layer, frame, opts.skipObjectIds, project) });
  }
  return { frame, width: project.width, height: project.height, background: project.background, layers };
}
