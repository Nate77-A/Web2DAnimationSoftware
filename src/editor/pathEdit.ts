// Path edit mode: maps scene objects to the Bézier path the user edits, and writes edits back.
//   pen path      -> its own segments
//   shape         -> its outline; the first edit turns it into a path
//   brush stroke  -> its centerline ("spine"), fitted once from the samples; edits re-run the brush
//                    along the new spine, keeping each sample's pressure and tilt at the same position.
import { brushOutline } from '../domain/brush';
import { shapeSegments } from '../domain/geometry';
import type { BrushSample, PathObject, SceneObject, Segment } from '../domain/schema';
import { fitCurve, pathLength, samplePath } from './paperAdapter';

export interface EditablePath { segments: Segment[]; closed: boolean; source: 'path' | 'shape' | 'brush' }

const spineCache = new WeakMap<object, Segment[]>();

/** Centerline of a brush stroke: the stored spine, or a fit through the samples (cached per samples array). */
export function brushSpine(brush: NonNullable<PathObject['brush']>): Segment[] {
  if (brush.spine) return brush.spine;
  let s = spineCache.get(brush.samples);
  if (!s) {
    s = fitCurve(brush.samples.map((x) => [x[0], x[1]]), Math.max(1, brush.settings.size * 0.1));
    spineCache.set(brush.samples, s);
  }
  return s;
}

export function editablePath(o: SceneObject): EditablePath | null {
  if (o.kind === 'path' && o.brush) return { segments: brushSpine(o.brush), closed: false, source: 'brush' };
  if (o.kind === 'path') return { segments: o.geometry.segments, closed: o.geometry.closed, source: 'path' };
  if (o.kind === 'shape') return { ...shapeSegments(o.geometry), source: 'shape' };
  return null;
}

/** Brush samples re-laid along a new spine. Pressure, tilt and time follow their relative arc position. */
export function resampleAlongSpine(samples: BrushSample[], spine: Segment[]): BrushSample[] {
  if (!samples.length) return samples;
  if (spine.length < 2) {
    const [x, y] = spine[0]?.p ?? [samples[0][0], samples[0][1]];
    const dx = x - samples[0][0], dy = y - samples[0][1];
    return samples.map((s) => [s[0] + dx, s[1] + dy, s[2], s[3], s[4], s[5]]);
  }
  // cumulative, normalized arc length of the original samples
  const cum = [0];
  for (let i = 1; i < samples.length; i++) cum.push(cum[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const spacing = samples.length > 1 ? Math.max(0.5, total / (samples.length - 1)) : 1.5;
  const count = Math.max(2, Math.min(4000, Math.ceil(pathLength(spine, false) / spacing) + 1));
  const pts = samplePath(spine, false, count);
  let j = 0;
  return pts.map((p, k) => {
    const u = (k / (count - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < u) j++;
    const span = cum[j + 1] - cum[j];
    const f = span > 0 ? Math.min(1, Math.max(0, (u - cum[j]) / span)) : 0;
    const a = samples[j], b = samples[Math.min(j + 1, samples.length - 1)];
    const mix = (i: number) => a[i] + (b[i] - a[i]) * f;
    return [p[0], p[1], mix(2), mix(3), mix(4), mix(5)];
  });
}

/** Writes an edited path back to the object. Shapes become paths; brush strokes are re-drawn. */
export function applyEditedPath(o: SceneObject, segments: Segment[], closed: boolean): SceneObject {
  if (o.kind === 'path' && o.brush) {
    const samples = resampleAlongSpine(o.brush.samples, segments);
    const outline = brushOutline(samples, o.brush.settings, o.brush.hasPressure, o.brush.hasTilt);
    return { ...o, geometry: { segments: outline, closed: true }, brush: { ...o.brush, samples, spine: segments } };
  }
  if (o.kind === 'path') return { ...o, geometry: { segments, closed } };
  if (o.kind === 'shape') {
    const { geometry: _g, kind: _k, ...rest } = o;
    void _g; void _k;
    const path: PathObject = { ...rest, kind: 'path', geometry: { segments, closed }, brush: null };
    return path;
  }
  return o;
}
