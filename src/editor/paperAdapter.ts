// Paper.js side of the Stage Adapter: canonical segments -> paper.Path, used for path data and hit testing.
// Paper segments use the same point + relative in/out handle model as the project schema, so the
// mapping is one-to-one. Paths are never inserted into a Paper project; the schema stays the source of truth.
import paper from 'paper/dist/paper-core';
import { objectSegments } from '../domain/geometry';
import type { SceneObject, Segment, Vec } from '../domain/schema';

let ready = false;
function scope() {
  if (!ready) {
    // Paper needs an active project to construct items; a 1×1 offscreen one is enough.
    paper.setup(new paper.Size(1, 1));
    ready = true;
  }
  return paper;
}

const cache = new WeakMap<object, paper.Path>();

export function segmentsToPaper(segments: Segment[], closed: boolean): paper.Path {
  const p = scope();
  return new p.Path({
    segments: segments.map((s) => new p.Segment(new p.Point(s.p), new p.Point(s.hi), new p.Point(s.ho))),
    closed,
    insert: false,
  });
}

/** paper.Path for a vector object in local coordinates, cached by immutable geometry reference. */
export function paperPath(o: SceneObject): paper.Path | null {
  if (o.kind !== 'path' && o.kind !== 'shape') return null;
  const key = o.geometry;
  let p = cache.get(key);
  if (!p) {
    const g = objectSegments(o)!;
    p = segmentsToPaper(g.segments, g.closed);
    cache.set(key, p);
  }
  p.fillRule = o.style.fillRule;
  return p;
}

/** SVG path data for canvas rendering (`new Path2D(d)`). */
export function paperPathData(segments: Segment[], closed: boolean): string {
  return segmentsToPaper(segments, closed).pathData;
}

/** Fill containment honoring the object's fill rule. */
export function paperContains(o: SceneObject, lp: Vec): boolean {
  return paperPath(o)?.contains(new paper.Point(lp[0], lp[1])) ?? false;
}

/** Distance from a local point to the path outline (Infinity for non-vector objects). */
export function paperDistance(o: SceneObject, lp: Vec): number {
  const path = paperPath(o);
  if (!path || !path.segments.length) return Infinity;
  const pt = new paper.Point(lp[0], lp[1]);
  const near = path.curves.length ? path.getNearestPoint(pt) : path.firstSegment.point;
  return near ? near.getDistance(pt) : Infinity;
}

/** Fits smooth Bézier segments through a polyline (Paper's `simplify`). Tolerance is in local units. */
export function fitCurve(points: Vec[], tolerance = 2.5): Segment[] {
  if (points.length < 2) return points.map((p) => ({ p, hi: [0, 0], ho: [0, 0] }));
  const p = scope();
  const path = new p.Path({ segments: points.map((q) => new p.Point(q)), insert: false });
  path.simplify(tolerance);
  return path.segments.map((s) => ({ p: [s.point.x, s.point.y], hi: [s.handleIn.x, s.handleIn.y], ho: [s.handleOut.x, s.handleOut.y] }));
}

/** Evenly spaced points along a path: `count` points from start to end (or around a closed path). */
export function samplePath(segments: Segment[], closed: boolean, count: number): Vec[] {
  const path = segmentsToPaper(segments, closed);
  const L = path.length;
  const out: Vec[] = [];
  for (let k = 0; k < count; k++) {
    const pt = path.getPointAt(count > 1 ? (L * k) / (count - 1) : 0) ?? path.firstSegment.point;
    out.push([pt.x, pt.y]);
  }
  return out;
}

export function pathLength(segments: Segment[], closed: boolean): number {
  return segments.length < 2 ? 0 : segmentsToPaper(segments, closed).length;
}

/** Closest point on the path: curve index (from anchor `index` to the next), curve parameter `t`, distance. */
export function nearestOnPath(segments: Segment[], closed: boolean, lp: Vec): { index: number; t: number; dist: number } | null {
  if (segments.length < 2) return null;
  const pt = new paper.Point(lp[0], lp[1]);
  const loc = segmentsToPaper(segments, closed).getNearestLocation(pt);
  if (!loc) return null;
  return { index: loc.curve.index, t: loc.time, dist: loc.point.getDistance(pt) };
}
