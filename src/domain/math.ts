import type { Transform, Vec } from './schema';

/** Affine matrix in canvas order: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export const DEG = Math.PI / 180;

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const id = 1 / det;
  return [
    m[3] * id, -m[1] * id, -m[2] * id, m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Matrix, p: Vec): Vec {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export function applyVector(m: Matrix, v: Vec): Vec {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number): Matrix => [sx, 0, 0, sy, 0, 0];
export function rotate(deg: number): Matrix {
  const r = deg * DEG, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** Object matrix: T(x,y) · R(rotation) · S(scaleX,scaleY) · T(-pivot). */
export function transformMatrix(t: Transform): Matrix {
  return multiply(multiply(multiply(translate(t.x, t.y), rotate(t.rotation)), scale(t.scaleX, t.scaleY)), translate(-t.pivotX, -t.pivotY));
}

export interface Rect { x: number; y: number; width: number; height: number }

export function rectFromPoints(pts: Vec[]): Rect {
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rectCorners(r: Rect): Vec[] {
  return [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];
}

export function unionRects(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  return rectFromPoints(rs.flatMap(rectCorners));
}

export function transformRect(m: Matrix, r: Rect): Rect {
  return rectFromPoints(rectCorners(r).map((p) => apply(m, p)));
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const round = (v: number, d = 2) => { const k = 10 ** d; return Math.round(v * k) / k; };
