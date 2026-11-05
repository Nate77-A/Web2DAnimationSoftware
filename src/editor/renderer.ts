// Stage Adapter (Paper.js geometry + Canvas2D raster): translates the evaluated canonical scene into Canvas2D drawing. The same function
// renders the interactive stage, thumbnails and every raster export (PNG/GIF/MP4).
import { cssColor } from '../domain/color';
import type { EvalObject, EvaluatedScene } from '../domain/evaluator';
import { fontString, layoutText, objectSegments, isCompound, localBounds, objectSubpaths, type MeasureFn } from '../domain/geometry';
import { type Matrix, transformMatrix } from '../domain/math';
import type { Paint, SceneObject, Segment, TextObject } from '../domain/schema';
import { paperPathData } from './paperAdapter';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ------------------------------------------------------------- measurement

let measureCtx: Ctx | null = null;
const measureCache = new Map<string, number>();

function getMeasureCtx(): Ctx {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
    measureCtx = c.getContext('2d') as Ctx;
  }
  return measureCtx;
}

export const measureText: MeasureFn = (text, font) => {
  const key = font + '\u0000' + text;
  let w = measureCache.get(key);
  if (w === undefined) {
    const ctx = getMeasureCtx();
    ctx.font = font;
    w = ctx.measureText(text).width;
    if (measureCache.size > 5000) measureCache.clear();
    measureCache.set(key, w);
  }
  return w;
};

export function clearMeasureCache() { measureCache.clear(); }

// ------------------------------------------------------------- caches

const pathCache = new WeakMap<object, Path2D>();

/** Canvas path built from Paper.js path data (cached by immutable segments reference). */
export function segmentsPath(segments: Segment[], closed: boolean): Path2D {
  let p = pathCache.get(segments);
  if (!p) {
    p = new Path2D(paperPathData(segments, closed));
    pathCache.set(segments, p);
  }
  return p;
}

/** Local Path2D for vector objects (cached by immutable geometry reference). */
export function objectPath(o: SceneObject): Path2D | null {
  if (o.kind === 'path' && isCompound(o)) {
    let p = pathCache.get(o.geometry);
    if (!p) {
      p = new Path2D(objectSubpaths(o)!.map((s) => paperPathData(s.segments, s.closed)).join(''));
      pathCache.set(o.geometry, p);
    }
    return p;
  }
  if (o.kind === 'path') return segmentsPath(o.geometry.segments, o.geometry.closed);
  if (o.kind === 'shape') {
    let p = pathCache.get(o.geometry);
    if (!p) {
      const g = objectSegments(o)!;
      p = new Path2D(paperPathData(g.segments, g.closed));
      pathCache.set(o.geometry, p);
    }
    return p;
  }
  return null;
}

const boundsCache = new WeakMap<object, ReturnType<typeof localBounds>>();
export function cachedLocalBounds(o: SceneObject) {
  const key = o.kind === 'text' ? o.text : o.kind === 'group' ? o.children : o.kind === 'bitmap' ? o.geometry : o.geometry;
  let b = boundsCache.get(key);
  if (!b) { b = localBounds(o, measureText); boundsCache.set(key, b); }
  return b;
}

// ------------------------------------------------------------- paint

export function makePaint(ctx: Ctx, paint: Paint, b: { x: number; y: number; width: number; height: number }): string | CanvasGradient | null {
  switch (paint.type) {
    case 'none': return null;
    case 'solid': return cssColor(paint.color);
    case 'linear': {
      const { x1, y1, x2, y2 } = linearGradientPoints(paint.angle, b);
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      for (const s of paint.stops) g.addColorStop(s.offset, cssColor(s.color));
      return g;
    }
    case 'radial': {
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.max(b.width, b.height) / 2));
      for (const s of paint.stops) g.addColorStop(s.offset, cssColor(s.color));
      return g;
    }
  }
}

/** Gradient axis through the bounds center, long enough to cover the bounds at the given angle. */
export function linearGradientPoints(angleDeg: number, b: { x: number; y: number; width: number; height: number }) {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const half = (Math.abs(b.width * c) + Math.abs(b.height * s)) / 2;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  return { x1: cx - c * half, y1: cy - s * half, x2: cx + c * half, y2: cy + s * half };
}

// ------------------------------------------------------------- drawing

export interface RenderOptions {
  /** Document -> canvas pixel matrix. */
  matrix: Matrix;
  getImage: (assetId: string) => CanvasImageSource | undefined;
  drawBackground: boolean;
  /** Fill missing bitmaps with a visible placeholder (editor) instead of skipping (export). */
  placeholders?: boolean;
  /** Multiplies every object's opacity (onion skin). */
  alpha?: number;
  /** Tints vector content for onion skinning. */
  tint?: string;
  /** Draw editor-only helpers such as null objects (stage and panel thumbnails; never exports). */
  guides?: boolean;
}

export function renderScene(ctx: Ctx, scene: EvaluatedScene, opts: RenderOptions) {
  ctx.save();
  ctx.setTransform(opts.matrix[0], opts.matrix[1], opts.matrix[2], opts.matrix[3], opts.matrix[4], opts.matrix[5]);
  if (opts.drawBackground && scene.background) {
    ctx.fillStyle = cssColor(scene.background);
    ctx.fillRect(0, 0, scene.width, scene.height);
  }
  for (const layer of scene.layers) {
    if (!layer.objects.length) continue;
    if (layer.blendMode === 'normal') {
      for (const o of layer.objects) drawObject(ctx, o, opts);
    } else {
      // Composite the layer on its own surface, then blend it as a whole.
      const canvas = ctx.canvas;
      const off = new OffscreenCanvas(canvas.width, canvas.height);
      const octx = off.getContext('2d')!;
      octx.setTransform(opts.matrix[0], opts.matrix[1], opts.matrix[2], opts.matrix[3], opts.matrix[4], opts.matrix[5]);
      for (const o of layer.objects) drawObject(octx, o, opts);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

export function drawObject(ctx: Ctx, eo: EvalObject, opts: RenderOptions) {
  const alpha = eo.opacity * (opts.alpha ?? 1);
  if (alpha <= 0) return;
  ctx.save();
  const m = eo.matrix;
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.globalAlpha *= alpha;
  drawSource(ctx, eo.source, opts);
  ctx.restore();
}

const NULL_GREEN = '#39FF5A';

/** After Effects-style null: a bright green box with crosshairs, kept about 1.5 screen pixels thick. */
function drawNull(ctx: Ctx, w: number, h: number) {
  const t = ctx.getTransform();
  const px = 1 / (Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1); // one device pixel in local units
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(ctx.globalAlpha, 0.9);
  ctx.strokeStyle = NULL_GREEN;
  ctx.lineWidth = 1.5 * dpr * px;
  ctx.setLineDash([]);
  ctx.strokeRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, arm = Math.min(w, h) * 0.22;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
  ctx.stroke();
  ctx.restore();
}

function drawSource(ctx: Ctx, o: SceneObject, opts: RenderOptions) {
  if (o.kind === 'shape' && o.geometry.shape === 'null') {
    if (opts.guides && !opts.tint) drawNull(ctx, o.geometry.width, o.geometry.height);
    return;
  }
  const b = cachedLocalBounds(o);
  switch (o.kind) {
    case 'path':
    case 'shape': {
      const path = objectPath(o)!;
      const fill = opts.tint ? (o.style.fill.type === 'none' ? null : opts.tint) : makePaint(ctx, o.style.fill, b);
      const closed = o.kind === 'shape' || o.geometry.closed;
      if (fill && closed) {
        ctx.fillStyle = fill;
        ctx.fill(path, o.style.fillRule);
      }
      const stroke = opts.tint ? (o.style.stroke.type === 'none' ? null : opts.tint) : makePaint(ctx, o.style.stroke, b);
      if (stroke && o.style.strokeWidth > 0) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = o.style.strokeWidth;
        ctx.lineCap = o.style.cap;
        ctx.lineJoin = o.style.join;
        ctx.setLineDash(o.style.dash);
        ctx.stroke(path);
      }
      break;
    }
    case 'text':
      drawText(ctx, o, b, opts.tint);
      break;
    case 'bitmap': {
      const img = opts.getImage(o.assetRef);
      if (img) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, o.geometry.width, o.geometry.height);
      } else if (opts.placeholders) {
        ctx.fillStyle = 'rgba(120,130,145,0.35)';
        ctx.fillRect(0, 0, o.geometry.width, o.geometry.height);
        ctx.strokeStyle = 'rgba(243,245,247,0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, o.geometry.width, o.geometry.height);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(o.geometry.width, o.geometry.height);
        ctx.moveTo(o.geometry.width, 0); ctx.lineTo(0, o.geometry.height); ctx.stroke();
      }
      break;
    }
    case 'group':
      for (const c of o.children) drawObject(ctx, { source: c, layerId: '', transform: c.transform, opacity: c.opacity, matrix: transformMatrix(c.transform) }, opts);
      break;
  }
}

const supportsLetterSpacing = (() => {
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
    return !!c && 'letterSpacing' in c;
  } catch { return false; }
})();

function drawText(ctx: Ctx, o: TextObject, b: { x: number; y: number; width: number; height: number }, tint?: string) {
  const t = o.text;
  const layout = layoutText(t, measureText);
  ctx.font = fontString(t);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const fill = tint ?? makePaint(ctx, o.style.fill, b);
  const stroke = tint ? null : makePaint(ctx, o.style.stroke, b);
  const useNative = supportsLetterSpacing || t.letterSpacing === 0;
  if (supportsLetterSpacing) (ctx as CanvasRenderingContext2D).letterSpacing = `${t.letterSpacing}px`;
  for (const line of layout.lines) {
    if (!line.text) continue;
    const draw = (fn: (s: string, x: number, y: number) => void) => {
      if (useNative) { fn(line.text, line.x, line.y); return; }
      let x = line.x;
      for (const ch of line.text) { fn(ch, x, line.y); x += measureText(ch, ctx.font) + t.letterSpacing; }
    };
    if (fill) { ctx.fillStyle = fill; draw((s, x, y) => ctx.fillText(s, x, y)); }
    if (stroke && o.style.strokeWidth > 0) {
      ctx.strokeStyle = stroke; ctx.lineWidth = o.style.strokeWidth; ctx.lineJoin = 'round';
      draw((s, x, y) => ctx.strokeText(s, x, y));
    }
  }
  if (supportsLetterSpacing) (ctx as CanvasRenderingContext2D).letterSpacing = '0px';
}

// ------------------------------------------------------------- checkerboard

let checker: CanvasPattern | null = null;
export function checkerPattern(ctx: CanvasRenderingContext2D, size = 8): CanvasPattern | null {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d')!;
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, size * 2, size * 2);
  g.fillStyle = '#D9DDE3'; g.fillRect(0, 0, size, size); g.fillRect(size, size, size, size);
  checker = ctx.createPattern(c, 'repeat');
  return checker;
}
