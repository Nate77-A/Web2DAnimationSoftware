// Brush sampler: raw Pointer Event samples -> resampled, smoothed centerline -> filled vector outline.
import type { BrushSample, BrushSettings, Segment, Vec } from './schema';
import { seg } from './geometry';

export interface RawSample { x: number; y: number; pressure: number; tiltX: number; tiltY: number; t: number }

/** True when the device reported meaningful pressure (mouse reports a constant 0.5 or 0). */
export function detectPressure(samples: RawSample[], pointerType: string): boolean {
  if (pointerType !== 'pen' && pointerType !== 'touch') return false;
  const vals = samples.map((s) => s.pressure);
  if (!vals.length) return false;
  const min = Math.min(...vals), max = Math.max(...vals);
  return max > 0 && (max - min > 0.01 || (max !== 0.5 && max !== 1));
}

export function detectTilt(samples: RawSample[]): boolean {
  return samples.some((s) => s.tiltX !== 0 || s.tiltY !== 0);
}

/** Resample to roughly uniform spacing and apply a Gaussian-weighted moving average. */
export function processSamples(raw: RawSample[], settings: BrushSettings, spacing: number): BrushSample[] {
  if (!raw.length) return [];
  const out: RawSample[] = [raw[0]];
  let carry = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d === 0) continue;
    let pos = spacing - carry;
    while (pos <= d) {
      const t = pos / d;
      out.push({
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
        tiltX: a.tiltX + (b.tiltX - a.tiltX) * t, tiltY: a.tiltY + (b.tiltY - a.tiltY) * t,
        t: a.t + (b.t - a.t) * t,
      });
      pos += spacing;
    }
    carry = d - (pos - spacing);
  }
  const last = raw[raw.length - 1];
  const tail = out[out.length - 1];
  if (tail !== last && Math.hypot(tail.x - last.x, tail.y - last.y) > spacing * 0.25) out.push(last);

  const radius = Math.round((settings.smoothing / 100) * 10);
  const sm = radius > 0 && out.length > 2 ? smooth(out, radius) : out;
  return sm.map((s) => [r2(s.x), r2(s.y), r3(s.pressure), r2(s.tiltX), r2(s.tiltY), Math.round(s.t)] as BrushSample);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function smooth(pts: RawSample[], radius: number): RawSample[] {
  const sigma = radius / 2 || 1;
  const w: number[] = [];
  for (let k = -radius; k <= radius; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const reach = Math.min(radius, i, pts.length - 1 - i); // shrink window near ends to keep endpoints
    let sx = 0, sy = 0, sp = 0, sw = 0;
    for (let k = -reach; k <= reach; k++) {
      const q = pts[i + k], wk = w[k + radius];
      sx += q.x * wk; sy += q.y * wk; sp += q.pressure * wk; sw += wk;
    }
    return { ...p, x: sx / sw, y: sy / sw, pressure: sp / sw };
  });
}

export function sampleWidth(s: BrushSample, settings: BrushSettings, hasPressure: boolean, hasTilt: boolean): number {
  let w = settings.size;
  if (settings.pressure.enabled && hasPressure) {
    const lo = Math.min(settings.pressure.min, settings.pressure.max), hi = Math.max(settings.pressure.min, settings.pressure.max);
    w *= lo + (hi - lo) * Math.min(1, Math.max(0, s[2]));
  }
  if (settings.tilt.enabled && hasTilt) {
    const tilt = Math.min(90, Math.hypot(s[3], s[4])); // degrees away from perpendicular
    w *= 1 + settings.tilt.response * (tilt / 60) * 1.5;
  }
  return Math.max(0.2, w);
}

/** Builds a closed filled outline (Catmull-Rom smoothed) around the variable-width centerline. */
export function brushOutline(samples: BrushSample[], settings: BrushSettings, hasPressure: boolean, hasTilt: boolean): Segment[] {
  if (!samples.length) return [];
  const widths = samples.map((s) => sampleWidth(s, settings, hasPressure, hasTilt) / 2);
  if (samples.length === 1 || totalLength(samples) < 0.5) {
    const r = widths[0];
    const k = r * 0.5522847498;
    const [x, y] = [samples[0][0], samples[0][1]];
    return [seg(x, y - r, [-k, 0], [k, 0]), seg(x + r, y, [0, -k], [0, k]), seg(x, y + r, [k, 0], [-k, 0]), seg(x - r, y, [0, k], [0, -k])];
  }
  const n = samples.length;
  const left: Vec[] = [], right: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = samples[Math.max(0, i - 1)], q = samples[Math.min(n - 1, i + 1)];
    let dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const r = widths[i];
    left.push([samples[i][0] - dy * r, samples[i][1] + dx * r]);
    right.push([samples[i][0] + dy * r, samples[i][1] - dx * r]);
  }
  const ring: Vec[] = [...left];
  const capEnd = cap(samples[n - 1], samples[n - 2], widths[n - 1], settings.cap);
  ring.push(...capEnd);
  for (let i = n - 1; i >= 0; i--) ring.push(right[i]);
  const capStart = cap(samples[0], samples[1], widths[0], settings.cap);
  ring.push(...capStart);
  return catmullRom(dedupe(ring));
}

function totalLength(s: BrushSample[]): number {
  let d = 0;
  for (let i = 1; i < s.length; i++) d += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  return d;
}

/** Semicircle cap points from the left side around the tip to the right side (exclusive). */
function cap(tip: BrushSample, prev: BrushSample, r: number, kind: 'round' | 'butt'): Vec[] {
  if (kind === 'butt') return [];
  const dx = tip[0] - prev[0], dy = tip[1] - prev[1];
  const a0 = Math.atan2(dx, -dy); // angle of left normal (-dy, dx) rotated; computed for consistency below
  const pts: Vec[] = [];
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const a = a0 - (Math.PI * i) / steps;
    pts.push([tip[0] + Math.cos(a) * r, tip[1] + Math.sin(a) * r]);
  }
  return pts;
}

function dedupe(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  return out;
}

/** Closed Catmull-Rom spline through points, as Bézier segments with relative handles. */
export function catmullRom(pts: Vec[]): Segment[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = (b[0] - a[0]) / 6, ty = (b[1] - a[1]) / 6;
    return { p: [r2(p[0]), r2(p[1])], hi: [r2(-tx), r2(-ty)], ho: [r2(tx), r2(ty)] };
  });
}

/** Splits samples wherever the centerline enters any eraser circle. Returns surviving runs. */
export function splitSamples(samples: BrushSample[], circles: { x: number; y: number; r: number }[]): BrushSample[][] {
  const runs: BrushSample[][] = [];
  let cur: BrushSample[] = [];
  for (const s of samples) {
    const erased = circles.some((c) => Math.hypot(s[0] - c.x, s[1] - c.y) <= c.r);
    if (erased) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(s);
  }
  if (cur.length) runs.push(cur);
  return runs;
}
