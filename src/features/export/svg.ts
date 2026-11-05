// Animated SVG exporter with an up-front capability analyzer (see docs/decisions/0007-animated-svg.md).
import { parseHex } from '../../domain/color';
import { contentAt, isLayerEffectivelyVisible, sampleObject } from '../../domain/evaluator';
import { isNullObject, layoutText, quoteFamily, objectSegments, objectSubpaths, subpathsToPathData } from '../../domain/geometry';
import { worldMatrix } from '../../domain/links';
import { transformMatrix, type Matrix } from '../../domain/math';
import type { Asset, Content, Exposure, Layer, Paint, Project, SceneObject } from '../../domain/schema';
import { cachedLocalBounds, linearGradientPoints, measureText } from '../../editor/renderer';
import { blobToDataUrl, getAssetBlob, getAssetImage } from '../assets';
import { checkAbort, prepareAssets, yieldToUi, type FrameRangeSpec, type ProgressFn } from './common';

export type BitmapPolicy = 'original' | 'webp' | 'jpeg' | 'png';
export interface BitmapCompression { policy: BitmapPolicy; quality: number; maxSize: number }

export interface SvgSettings {
  name: string;
  width: number;
  height: number;
  range: FrameRangeSpec;
  fps: number;
  mode: 'css' | 'js';
  sizing: 'fixed' | 'responsive';
  cropToArtboard: boolean;
  loop: boolean;
  bitmap: BitmapCompression;
  bitmapOverrides: Record<string, BitmapCompression>;
}

export interface SvgAnalysis {
  frames: number;
  animated: boolean;
  cssUnsupported: string[];
  warnings: string[];
  bitmaps: Asset[];
}

function visibleLayers(p: Project): Layer[] {
  return p.layers.filter((l) => isLayerEffectivelyVisible(p, l));
}

function spansInRange(l: Layer, r: FrameRangeSpec): Exposure[] {
  return l.exposureTrack.filter((e) => e.endFrame >= r.start && e.startFrame <= r.end);
}

/** Moves within the range: its own animation, or a linked parent's (world matrix or opacity changes). */
function animatedInRange(p: Project, o: SceneObject, r: FrameRangeSpec): boolean {
  if (o.keyframes.length < 2 && !o.link) return false;
  const at = (f: number) => JSON.stringify([worldMatrix(p, o, f), sampleObject(o, f).opacity]);
  const a = at(r.start);
  for (let f = r.start + 1; f <= r.end; f++) if (at(f) !== a) return true;
  return false;
}

/** Reports what CSS-only output cannot represent before anything is written. */
export function analyzeSvg(p: Project, r: FrameRangeSpec): SvgAnalysis {
  const cssUnsupported: string[] = [];
  const warnings: string[] = [];
  let animated = false;
  const usedAssets = new Set<string>();
  let hasText = false;
  for (const l of visibleLayers(p)) {
    const spans = spansInRange(l, r);
    const gaps = spans.length && (spans[0].startFrame > r.start || spans[spans.length - 1].endFrame < r.end);
    if (spans.length > 1 || gaps) {
      animated = true;
      cssUnsupported.push(`Layer "${l.name}" changes artwork between frames (frame-by-frame or path change). CSS-only output can only animate transforms and opacity — use CSS + JavaScript.`);
    }
    for (const e of spans) {
      const c = l.objectTracks.find((x) => x.id === e.contentId);
      for (const o of c?.objects ?? []) {
        if (isNullObject(o)) continue;
        if (animatedInRange(p, o, r)) animated = true;
        if (o.kind === 'bitmap') usedAssets.add(o.assetRef);
        if (o.kind === 'text') hasText = true;
      }
    }
    if (l.blendMode !== 'normal') warnings.push(`Layer "${l.name}" uses ${l.blendMode} blending (exported as CSS mix-blend-mode; most current browsers support it).`);
  }
  if (hasText) warnings.push('Text uses the viewer\'s installed fonts; fonts are not embedded. Stick to web-safe families for consistent results.');
  const bitmaps = p.assets.filter((a) => usedAssets.has(a.id));
  if (bitmaps.length) warnings.push(`${bitmaps.length} bitmap(s) will be embedded as data URIs.`);
  return { frames: r.end - r.start + 1, animated, cssUnsupported, warnings, bitmaps };
}

// ------------------------------------------------------------------ serialization

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => +v.toFixed(3);
const mat = (m: Matrix) => `matrix(${m.map(n).join(' ')})`;

function colorAttr(hex: string): { color: string; opacity: number } {
  const { r, g, b, a } = parseHex(hex);
  return { color: `rgb(${r},${g},${b})`, opacity: +a.toFixed(3) };
}

class Defs {
  items: string[] = [];
  counter = 0;
  paint(p: Paint, b: { x: number; y: number; width: number; height: number }, prefix: string): { value: string; opacity: number } {
    if (p.type === 'none') return { value: 'none', opacity: 1 };
    if (p.type === 'solid') { const c = colorAttr(p.color); return { value: c.color, opacity: c.opacity }; }
    const id = `${prefix}g${this.counter++}`;
    const stops = p.stops.map((s) => { const c = colorAttr(s.color); return `<stop offset="${n(s.offset)}" stop-color="${c.color}"${c.opacity < 1 ? ` stop-opacity="${c.opacity}"` : ''}/>`; }).join('');
    if (p.type === 'linear') {
      const g = linearGradientPoints(p.angle, b);
      this.items.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}">${stops}</linearGradient>`);
    } else {
      this.items.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(b.x + b.width / 2)}" cy="${n(b.y + b.height / 2)}" r="${n(Math.max(1, Math.max(b.width, b.height) / 2))}">${stops}</radialGradient>`);
    }
    return { value: `url(#${id})`, opacity: 1 };
  }
}

function objectMarkup(o: SceneObject, defs: Defs, idPrefix: string): string {
  if (isNullObject(o)) return '';
  const b = cachedLocalBounds(o);
  const st = o.style;
  const paintAttrs = (forText = false) => {
    const f = defs.paint(st.fill, b, idPrefix);
    const s = defs.paint(st.stroke, b, idPrefix);
    let a = `fill="${f.value}"${f.opacity < 1 ? ` fill-opacity="${f.opacity}"` : ''}`;
    if (!forText && st.fillRule === 'evenodd') a += ' fill-rule="evenodd"';
    if (s.value !== 'none' && st.strokeWidth > 0) {
      a += ` stroke="${s.value}"${s.opacity < 1 ? ` stroke-opacity="${s.opacity}"` : ''} stroke-width="${n(st.strokeWidth)}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"`;
      if (st.dash.length) a += ` stroke-dasharray="${st.dash.map(n).join(' ')}"`;
    }
    return a;
  };
  switch (o.kind) {
    case 'path':
    case 'shape': {
      const g = objectSegments(o)!;
      const closed = o.kind === 'shape' || g.closed;
      let attrs = paintAttrs();
      if (!closed) attrs = attrs.replace(/fill="[^"]*"( fill-opacity="[^"]*")?/, 'fill="none"');
      const outlines = objectSubpaths(o)!.map((s, i) => (i === 0 ? { ...s, closed } : s));
      return `<path d="${subpathsToPathData(outlines)}" ${attrs}/>`;
    }
    case 'text': {
      const t = o.text;
      const l = layoutText(t, measureText);
      const tspans = l.lines.map((ln) => `<tspan x="${n(ln.x)}" y="${n(ln.y)}">${esc(ln.text) || ' '}</tspan>`).join('');
      return `<text font-family="${esc(quoteFamily(t.fontFamily))}" font-size="${n(t.fontSize)}" font-weight="${t.fontWeight}" font-style="${t.fontStyle}"${t.letterSpacing ? ` letter-spacing="${n(t.letterSpacing)}"` : ''} xml:space="preserve" ${paintAttrs(true)}>${tspans}</text>`;
    }
    case 'bitmap':
      return `<use href="#asset-${o.assetRef.slice(0, 16)}" width="${n(o.geometry.width)}" height="${n(o.geometry.height)}"/>`;
    case 'group':
      return o.children.map((c) => `<g transform="${mat(transformMatrix(c.transform))}"${c.opacity < 1 ? ` opacity="${n(c.opacity)}"` : ''}>${objectMarkup(c, defs, idPrefix)}</g>`).join('');
  }
}

async function encodeBitmap(asset: Asset, c: BitmapCompression): Promise<string> {
  const blob = getAssetBlob(asset.id);
  const img = getAssetImage(asset.id);
  if (!blob || !img) throw new Error(`Bitmap "${asset.name}" is not loaded.`);
  const scale = c.maxSize > 0 ? Math.min(1, c.maxSize / Math.max(asset.width, asset.height)) : 1;
  if (c.policy === 'original' && scale === 1) return blobToDataUrl(blob);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(asset.width * scale));
  canvas.height = Math.max(1, Math.round(asset.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = c.policy === 'original' ? asset.mime : `image/${c.policy}`;
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, Math.max(0.05, Math.min(1, c.quality / 100))));
  if (!out) throw new Error(`Could not re-encode "${asset.name}" as ${type}.`);
  // The source project asset is never modified; only the exported copy changes.
  return blobToDataUrl(out);
}

interface Placed { layer: Layer; span: Exposure; content: Content }

export async function exportSvg(p: Project, s: SvgSettings, onProgress: ProgressFn, signal?: AbortSignal): Promise<{ blob: Blob; analysis: SvgAnalysis }> {
  await prepareAssets(p);
  const analysis = analyzeSvg(p, s.range);
  if (s.mode === 'css' && analysis.cssUnsupported.length) {
    throw new Error(`CSS-only output cannot represent this range:\n• ${analysis.cssUnsupported.join('\n• ')}`);
  }
  const r = s.range;
  const frames = r.end - r.start + 1;
  const duration = frames / s.fps;
  const defs = new Defs();
  const prefix = 'a';
  const css: string[] = [];
  const jsFrames: Record<string, { v?: number[]; m?: string[]; o?: number[] }> = {};
  const parts: string[] = [];
  let step = 0;
  const totalSteps = analysis.bitmaps.length + p.layers.length;

  // bitmaps as data URIs, once each
  for (const a of analysis.bitmaps) {
    checkAbort(signal);
    const policy = s.bitmapOverrides[a.id] ?? s.bitmap;
    const uri = await encodeBitmap(a, policy);
    defs.items.push(`<image id="asset-${a.id.slice(0, 16)}" width="${a.width}" height="${a.height}" preserveAspectRatio="none" href="${uri}"/>`);
    onProgress({ done: ++step, total: totalSteps, phase: 'Embedding bitmaps' });
    await yieldToUi();
  }

  const animatedSingle = (frames > 1);
  for (const layer of visibleLayers(p)) {
    checkAbort(signal);
    const placed: Placed[] = spansInRange(layer, r).map((span) => ({ layer, span, content: layer.objectTracks.find((c) => c.id === span.contentId)! }));
    const blend = layer.blendMode !== 'normal' ? ` style="mix-blend-mode:${layer.blendMode}"` : '';
    const groups: string[] = [];
    for (const pl of placed) {
      const gid = `c-${pl.content.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
      const objs: string[] = [];
      for (const o of pl.content.objects) {
        if (!o.visible || isNullObject(o)) continue; // nulls are editor-only helpers
        const oid = `o-${o.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
        const f0 = Math.max(r.start, pl.span.startFrame);
        const first = sampleObject(o, f0);
        const anim = animatedSingle && animatedInRange(p, o, { start: f0, end: Math.min(r.end, pl.span.endFrame) });
        const m0 = worldMatrix(p, o, f0);
        objs.push(`<g id="${oid}" transform="${mat(m0)}"${first.opacity < 1 ? ` opacity="${n(first.opacity)}"` : ''}>${objectMarkup(o, defs, prefix)}</g>`);
        if (anim) {
          const a = Math.max(r.start, pl.span.startFrame), b = Math.min(r.end, pl.span.endFrame);
          if (s.mode === 'css') {
            const stops: string[] = [];
            for (let f = a; f <= b; f++) {
              const smp = sampleObject(o, f);
              const pct = ((f - r.start) / Math.max(1, frames - 1)) * 100;
              stops.push(`${n(pct)}%{transform:${mat(worldMatrix(p, o, f)).replace(/ /g, ',').replace('matrix(', 'matrix(')};opacity:${n(smp.opacity)}}`);
            }
            css.push(`#${oid}{animation:${oid} ${n(duration)}s linear ${s.loop ? 'infinite' : '1 forwards'};transform-origin:0 0;transform-box:view-box}@keyframes ${oid}{${stops.join('')}}`);
          } else {
            const m: string[] = [], op: number[] = [];
            for (let f = r.start; f <= r.end; f++) {
              const fc = Math.min(b, Math.max(a, f));
              const smp = sampleObject(o, fc);
              m.push(worldMatrix(p, o, fc).map(n).join(' '));
              op.push(n(smp.opacity));
            }
            jsFrames[oid] = { m, o: op };
          }
        }
      }
      groups.push(`<g id="${gid}">${objs.join('')}</g>`);
      if (s.mode === 'js' && placed.length > 0) {
        const vis: number[] = [];
        for (let f = r.start; f <= r.end; f++) vis.push(f >= pl.span.startFrame && f <= pl.span.endFrame ? 1 : 0);
        if (vis.some((v) => !v)) jsFrames[gid] = { v: vis };
      }
    }
    parts.push(`<g class="layer" data-name="${esc(layer.name)}"${blend}>${groups.join('')}</g>`);
    onProgress({ done: ++step, total: totalSteps, phase: 'Serializing layers' });
    await yieldToUi();
  }
  void contentAt;

  // view box
  let vb = { x: 0, y: 0, w: p.width, h: p.height };
  if (!s.cropToArtboard) {
    const pad = 0;
    vb = { x: -pad, y: -pad, w: p.width + pad * 2, h: p.height + pad * 2 };
    let x0 = 0, y0 = 0, x1 = p.width, y1 = p.height;
    for (const l of visibleLayers(p)) for (const sp of spansInRange(l, r)) {
      const c = l.objectTracks.find((x) => x.id === sp.contentId);
      for (const o of c?.objects ?? []) {
        if (isNullObject(o)) continue;
        for (let f = Math.max(r.start, sp.startFrame); f <= Math.min(r.end, sp.endFrame); f += Math.max(1, Math.floor(frames / 24))) {
          const t = worldMatrix(p, o, f);
          const lb = cachedLocalBounds(o);
          for (const [x, y] of [[lb.x, lb.y], [lb.x + lb.width, lb.y], [lb.x, lb.y + lb.height], [lb.x + lb.width, lb.y + lb.height]]) {
            const X = t[0] * x + t[2] * y + t[4], Y = t[1] * x + t[3] * y + t[5];
            x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
          }
        }
      }
    }
    vb = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
  }
  const outW = Math.round(s.width * (vb.w / p.width)), outH = Math.round(s.height * (vb.h / p.height));
  const sizeAttrs = s.sizing === 'fixed' ? `width="${outW}" height="${outH}"` : 'width="100%" height="100%" preserveAspectRatio="xMidYMid meet"';
  if (s.cropToArtboard) defs.items.push(`<clipPath id="artboard"><rect width="${p.width}" height="${p.height}"/></clipPath>`);
  const bg = p.background ? (() => { const c = colorAttr(p.background); return `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${c.color}"${c.opacity < 1 ? ` fill-opacity="${c.opacity}"` : ''}/>`; })() : '';

  let script = '';
  if (s.mode === 'js' && frames > 1) {
    script = `<script><![CDATA[(function(){var F=${JSON.stringify(jsFrames)},n=${frames},fps=${s.fps},loop=${s.loop},t0=null,last=-1;
var els={};for(var k in F)els[k]=document.getElementById(k);
function draw(f){for(var k in F){var e=els[k],d=F[k];if(!e)continue;if(d.v)e.style.display=d.v[f]?'':'none';if(d.m)e.setAttribute('transform','matrix('+d.m[f]+')');if(d.o)e.setAttribute('opacity',d.o[f]);}}
function tick(t){if(t0===null)t0=t;var f=Math.floor((t-t0)*fps/1000);if(f>=n){if(loop){f=f%n;}else{draw(n-1);return;}}if(f!==last){draw(f);last=f;}requestAnimationFrame(tick);}
draw(0);requestAnimationFrame(tick);})();]]></script>`;
  }
  const style = css.length ? `<style>${css.join('\n')}${s.loop ? '' : ''}@media (prefers-reduced-motion: reduce){*{animation-play-state:paused!important}}</style>` : '';
  const title = `<title>${esc(s.name)}</title>`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" ${sizeAttrs}>
${title}<defs>${defs.items.join('')}</defs>${style}
<g${s.cropToArtboard ? ' clip-path="url(#artboard)"' : ''}>${bg}${parts.join('\n')}</g>${script}
</svg>`;
  return { blob: new Blob([svg], { type: 'image/svg+xml' }), analysis };
}
