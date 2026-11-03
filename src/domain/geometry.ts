// Pure geometry: canonical objects -> Bézier segments, bounds, and SVG path data.
import { type Rect, rectFromPoints, unionRects, transformRect, transformMatrix } from './math';
import type { SceneObject, Segment, ShapeObject, TextData, Vec } from './schema';

const KAPPA = 0.5522847498;

export const seg = (x: number, y: number, hi: Vec = [0, 0], ho: Vec = [0, 0]): Segment => ({ p: [x, y], hi, ho });

export function shapeSegments(g: ShapeObject['geometry']): { segments: Segment[]; closed: true } {
  const { width: w, height: h } = g;
  switch (g.shape) {
    case 'rect': {
      const r = Math.min(g.cornerRadius, w / 2, h / 2);
      if (r <= 0.0001) return { segments: [seg(0, 0), seg(w, 0), seg(w, h), seg(0, h)], closed: true };
      const k = r * KAPPA;
      return {
        closed: true,
        segments: [
          seg(r, 0, [-k, 0], [0, 0]), seg(w - r, 0, [0, 0], [k, 0]),
          seg(w, r, [0, -k], [0, 0]), seg(w, h - r, [0, 0], [0, k]),
          seg(w - r, h, [k, 0], [0, 0]), seg(r, h, [0, 0], [-k, 0]),
          seg(0, h - r, [0, k], [0, 0]), seg(0, r, [0, 0], [0, -k]),
        ],
      };
    }
    case 'ellipse': {
      const rx = w / 2, ry = h / 2, kx = rx * KAPPA, ky = ry * KAPPA;
      return {
        closed: true,
        segments: [
          seg(rx, 0, [-kx, 0], [kx, 0]), seg(w, ry, [0, -ky], [0, ky]),
          seg(rx, h, [kx, 0], [-kx, 0]), seg(0, ry, [0, ky], [0, -ky]),
        ],
      };
    }
    case 'triangle':
      return { segments: [seg(w / 2, 0), seg(w, h), seg(0, h)], closed: true };
    case 'polygon': {
      const n = Math.max(3, Math.round(g.sides));
      const pts: Segment[] = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push(seg(w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2));
      }
      return { segments: pts, closed: true };
    }
  }
}

/** Returns renderable segments for vector kinds; null for text/bitmap/group. */
export function objectSegments(o: SceneObject): { segments: Segment[]; closed: boolean } | null {
  if (o.kind === 'path') return o.geometry;
  if (o.kind === 'shape') return shapeSegments(o.geometry);
  return null;
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // derivative coefficients: a t^2 + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      ts.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
};

/** Exact bounds of a Bézier path (handles relative to anchor points). */
export function segmentsBounds(segments: Segment[], closed: boolean): Rect {
  if (!segments.length) return { x: 0, y: 0, width: 0, height: 0 };
  const pts: Vec[] = segments.map((s) => s.p);
  const n = segments.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const s0 = segments[i], s1 = segments[(i + 1) % n];
    const P0 = s0.p, P1: Vec = [s0.p[0] + s0.ho[0], s0.p[1] + s0.ho[1]];
    const P2: Vec = [s1.p[0] + s1.hi[0], s1.p[1] + s1.hi[1]], P3 = s1.p;
    for (const axis of [0, 1] as const) {
      for (const t of cubicExtrema(P0[axis], P1[axis], P2[axis], P3[axis])) {
        pts.push([cubicAt(P0[0], P1[0], P2[0], P3[0], t), cubicAt(P0[1], P1[1], P2[1], P3[1], t)]);
      }
    }
  }
  return rectFromPoints(pts);
}

const f = (n: number) => +n.toFixed(3);

export function segmentsToPathData(segments: Segment[], closed: boolean): string {
  if (!segments.length) return '';
  const n = segments.length;
  let d = `M${f(segments[0].p[0])} ${f(segments[0].p[1])}`;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const s0 = segments[i], s1 = segments[(i + 1) % n];
    const straight = !s0.ho[0] && !s0.ho[1] && !s1.hi[0] && !s1.hi[1];
    if (straight) d += `L${f(s1.p[0])} ${f(s1.p[1])}`;
    else d += `C${f(s0.p[0] + s0.ho[0])} ${f(s0.p[1] + s0.ho[1])} ${f(s1.p[0] + s1.hi[0])} ${f(s1.p[1] + s1.hi[1])} ${f(s1.p[0])} ${f(s1.p[1])}`;
  }
  if (closed) d += 'Z';
  return d;
}

/** Visits each cubic of the path; used by renderers that build native paths. */
export function traceSegments(
  segments: Segment[], closed: boolean,
  sink: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; closePath(): void },
) {
  if (!segments.length) return;
  const n = segments.length;
  sink.moveTo(segments[0].p[0], segments[0].p[1]);
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const s0 = segments[i], s1 = segments[(i + 1) % n];
    if (!s0.ho[0] && !s0.ho[1] && !s1.hi[0] && !s1.hi[1]) sink.lineTo(s1.p[0], s1.p[1]);
    else sink.bezierCurveTo(s0.p[0] + s0.ho[0], s0.p[1] + s0.ho[1], s1.p[0] + s1.hi[0], s1.p[1] + s1.hi[1], s1.p[0], s1.p[1]);
  }
  if (closed) sink.closePath();
}

// ---------- text layout ----------

export type MeasureFn = (text: string, font: string) => number;

export function fontString(t: TextData): string {
  return `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${quoteFamily(t.fontFamily)}`;
}

export function quoteFamily(family: string): string {
  return family.split(',').map((s) => {
    const v = s.trim();
    return /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(v) || /^["']/.test(v) ? v : `"${v.replace(/"/g, '')}"`;
  }).join(', ');
}

export interface TextLayout {
  lines: { text: string; width: number; x: number; y: number }[];
  width: number;
  height: number;
  lineHeightPx: number;
}

export function layoutText(t: TextData, measure: MeasureFn): TextLayout {
  const font = fontString(t);
  const spaced = (s: string) => measure(s, font) + Math.max(0, s.length - 1) * t.letterSpacing;
  const raw = t.content.split('\n');
  const lines: string[] = [];
  for (const para of raw) {
    if (t.width <= 0) { lines.push(para); continue; }
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const next = cur + w;
      if (cur && spaced(next.trimEnd()) > t.width) {
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      } else cur = next;
    }
    lines.push(cur);
  }
  const lh = t.fontSize * t.lineHeight;
  const widths = lines.map((l) => spaced(l));
  const boxW = t.width > 0 ? t.width : Math.max(1, ...widths);
  return {
    lines: lines.map((text, i) => {
      const w = widths[i];
      const x = t.align === 'left' ? 0 : t.align === 'center' ? (boxW - w) / 2 : boxW - w;
      return { text, width: w, x, y: i * lh + (lh - t.fontSize) / 2 + t.fontSize * 0.8 };
    }),
    width: boxW,
    height: Math.max(lh, lines.length * lh),
    lineHeightPx: lh,
  };
}

/** Local (untransformed) bounds of an object. */
export function localBounds(o: SceneObject, measure: MeasureFn): Rect {
  switch (o.kind) {
    case 'path': return segmentsBounds(o.geometry.segments, o.geometry.closed);
    case 'shape': return { x: 0, y: 0, width: o.geometry.width, height: o.geometry.height };
    case 'bitmap': return { x: 0, y: 0, width: o.geometry.width, height: o.geometry.height };
    case 'text': {
      const l = layoutText(o.text, measure);
      return { x: 0, y: 0, width: l.width, height: l.height };
    }
    case 'group': {
      const r = unionRects(o.children.map((c) => transformRect(transformMatrix(c.transform), localBounds(c, measure))));
      return r ?? { x: 0, y: 0, width: 0, height: 0 };
    }
  }
}

/** Translates geometry so its bounds' top-left is at (0,0); returns offset applied. */
export function normalizeSegments(segments: Segment[], closed: boolean): { segments: Segment[]; bounds: Rect } {
  const b = segmentsBounds(segments, closed);
  return {
    segments: segments.map((s) => ({ p: [s.p[0] - b.x, s.p[1] - b.y], hi: s.hi, ho: s.ho })),
    bounds: b,
  };
}
