// Pure Bézier editing operations used by path edit mode. Segments use the schema's model: an anchor
// `p` with handles `hi`/`ho` stored relative to it. Every function returns new arrays; inputs are never mutated.
import type { Segment, Vec } from './schema';

const EPS = 1e-6;
const len = (v: Vec) => Math.hypot(v[0], v[1]);
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const mul = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k];

/** Anchor has at least one non-zero handle. */
export function hasHandles(s: Segment): boolean {
  return len(s.hi) > EPS || len(s.ho) > EPS;
}

/** Both handles present and pointing in opposite directions (a smooth, tangent-continuous anchor). */
export function isSmooth(s: Segment): boolean {
  const a = len(s.hi), b = len(s.ho);
  if (a <= EPS || b <= EPS) return false;
  const cross = (s.hi[0] * s.ho[1] - s.hi[1] * s.ho[0]) / (a * b);
  const dot = (s.hi[0] * s.ho[0] + s.hi[1] * s.ho[1]) / (a * b);
  return Math.abs(cross) < 0.02 && dot < 0;
}

/** Number of drawable curves: open paths skip the closing curve. */
export function curveCount(segments: Segment[], closed: boolean): number {
  return segments.length < 2 ? 0 : closed ? segments.length : segments.length - 1;
}

/** Control points [P0, P1, P2, P3] of curve i (from anchor i to anchor i+1). */
export function curvePoints(segments: Segment[], i: number): [Vec, Vec, Vec, Vec] {
  const a = segments[i], b = segments[(i + 1) % segments.length];
  return [a.p, add(a.p, a.ho), add(b.p, b.hi), b.p];
}

export function cubicPoint([p0, p1, p2, p3]: [Vec, Vec, Vec, Vec], t: number): Vec {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Moves the selected anchors (and their handles) by `delta`. */
export function moveAnchors(segments: Segment[], indices: number[], delta: Vec): Segment[] {
  const set = new Set(indices);
  return segments.map((s, i) => (set.has(i) ? { ...s, p: add(s.p, delta) } : s));
}

/**
 * Sets one handle of anchor `i`. When the anchor was smooth and `breakSmooth` is false, the opposite
 * handle turns to stay collinear and keeps its length, so the curve stays smooth through the anchor.
 */
export function setHandle(segments: Segment[], i: number, which: 'hi' | 'ho', vec: Vec, breakSmooth = false): Segment[] {
  const s = segments[i];
  const other = which === 'hi' ? 'ho' : 'hi';
  const next: Segment = { ...s, [which]: vec };
  if (!breakSmooth && isSmooth(s) && len(vec) > EPS) next[other] = mul(vec, -len(s[other]) / len(vec));
  return segments.map((x, j) => (j === i ? next : x));
}

/**
 * Bends curve i so the point at parameter t follows the pointer by `delta`. The two inner control
 * points move in proportion to their influence on B(t), weighted toward the nearer end, which keeps
 * the grabbed point exactly under the pointer. Anchors stay put; a smooth anchor keeps its opposite
 * handle collinear so the neighboring curve stays tangent-continuous.
 */
export function bendCurve(segments: Segment[], closed: boolean, i: number, t: number, delta: Vec): Segment[] {
  if (i < 0 || i >= curveCount(segments, closed)) return segments;
  const tt = Math.min(0.95, Math.max(0.05, t));
  const u = 1 - tt;
  const c1 = 3 * u * u * tt, c2 = 3 * u * tt * tt;
  const k = 1 / (u * c1 + tt * c2);
  const d1 = mul(delta, u * k), d2 = mul(delta, tt * k);
  const j = (i + 1) % segments.length;
  let out = setHandle(segments, i, 'ho', add(segments[i].ho, d1));
  out = setHandle(out, j, 'hi', add(segments[j].hi, d2));
  return out;
}

/** Neighbor anchors of i, or null at the ends of an open path. */
function neighbors(segments: Segment[], closed: boolean, i: number): { prev: Vec | null; next: Vec | null } {
  const n = segments.length;
  const prev = i > 0 ? segments[i - 1].p : closed && n > 1 ? segments[n - 1].p : null;
  const next = i < n - 1 ? segments[i + 1].p : closed && n > 1 ? segments[0].p : null;
  return { prev, next };
}

/**
 * Converts anchor i between sharp and smooth. A smooth anchor gets handles along the line between its
 * neighbors, each a third of the distance to that neighbor; a sharp anchor has both handles removed.
 */
export function toggleSmooth(segments: Segment[], closed: boolean, i: number): Segment[] {
  const s = segments[i];
  if (hasHandles(s)) return segments.map((x, j) => (j === i ? { ...x, hi: [0, 0], ho: [0, 0] } : x));
  const { prev, next } = neighbors(segments, closed, i);
  let dir: Vec = prev && next ? sub(next, prev) : next ? sub(next, s.p) : prev ? sub(s.p, prev) : [1, 0];
  const dl = len(dir);
  dir = dl > EPS ? mul(dir, 1 / dl) : [1, 0];
  const lin = prev ? len(sub(s.p, prev)) / 3 : next ? len(sub(next, s.p)) / 3 : 20;
  const lout = next ? len(sub(next, s.p)) / 3 : lin;
  return segments.map((x, j) => (j === i ? { ...x, hi: mul(dir, -lin), ho: mul(dir, lout) } : x));
}

/** Removes anchors, keeping at least two. Returns null when the removal would leave fewer. */
export function deleteAnchors(segments: Segment[], indices: number[]): Segment[] | null {
  const set = new Set(indices);
  const out = segments.filter((_, i) => !set.has(i));
  return out.length >= 2 ? out : null;
}

/**
 * Inserts an anchor on curve i at parameter t without changing the path's shape (de Casteljau split).
 * A straight curve gets a sharp anchor; a curved one gets the smooth handles the split produces.
 * Returns the new segments and the new anchor's index.
 */
export function insertAnchor(segments: Segment[], closed: boolean, i: number, t: number): { segments: Segment[]; index: number } | null {
  if (i < 0 || i >= curveCount(segments, closed)) return null;
  const tt = Math.min(0.999, Math.max(0.001, t));
  const j = (i + 1) % segments.length;
  const a = segments[i], b = segments[j];
  const [p0, p1, p2, p3] = curvePoints(segments, i);
  let mid: Segment;
  let ho = a.ho, hi = b.hi;
  if (len(a.ho) <= EPS && len(b.hi) <= EPS) {
    mid = { p: [p0[0] + (p3[0] - p0[0]) * tt, p0[1] + (p3[1] - p0[1]) * tt], hi: [0, 0], ho: [0, 0] };
  } else {
    const lerp = (u: Vec, v: Vec): Vec => [u[0] + (v[0] - u[0]) * tt, u[1] + (v[1] - u[1]) * tt];
    const q0 = lerp(p0, p1), q1 = lerp(p1, p2), q2 = lerp(p2, p3);
    const r0 = lerp(q0, q1), r1 = lerp(q1, q2);
    const s = lerp(r0, r1);
    ho = sub(q0, p0);
    hi = sub(q2, p3);
    mid = { p: s, hi: sub(r0, s), ho: sub(r1, s) };
  }
  const out = segments.map((x, k) => (k === i ? { ...x, ho } : k === j ? { ...x, hi } : x));
  out.splice(i + 1, 0, mid);
  return { segments: out, index: i + 1 };
}
