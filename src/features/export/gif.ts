// Animated GIF export: frames rendered on the main thread (time-sliced), encoded in a worker.
import { paintHasAlpha, paintHasGradient } from '../../domain/color';
import type { Project } from '../../domain/schema';
import GifWorker from '../../workers/gif.worker.ts?worker&inline';
import type { GifWorkerResponse } from '../../workers/gif.worker';
import { checkAbort, ExportCancelled, makeCanvas, prepareAssets, renderFrame, yieldToUi, type FrameRangeSpec, type ProgressFn } from './common';
import { encodeGif, gifDelays, type GifFrameInput } from './gifEncoder';

export interface GifSettings {
  name: string;
  width: number;
  height: number;
  range: FrameRangeSpec;
  fps: number;
  /** 1-100: maps to palette size 16-256. */
  quality: number;
  loop: boolean;
  transparent: boolean;
}

export function gifWarnings(project: Project, s: GifSettings): string[] {
  const w: string[] = [];
  let gradients = false, alpha = !!project.background && project.background.slice(7) !== 'FF' || !project.background;
  for (const l of project.layers) for (const c of l.objectTracks) for (const o of c.objects) {
    if (paintHasGradient(o.style.fill) || paintHasGradient(o.style.stroke)) gradients = true;
    if (paintHasAlpha(o.style.fill) || o.opacity < 1 || o.keyframes.some((k) => k.opacity < 1)) alpha = true;
  }
  if (gradients) w.push('Gradients will show banding: GIF frames are limited to 256 colors.');
  if (alpha) w.push(s.transparent ? 'GIF transparency is 1-bit: semi-transparent pixels become fully opaque or fully transparent.' : 'Semi-transparent areas are flattened onto white.');
  const frames = s.range.end - s.range.start + 1;
  if (s.width * s.height * frames > 1920 * 1080 * 120) w.push('Large size × frame count: encoding may be slow and the file large. Consider a smaller size.');
  if (s.fps > 50) w.push('Many browsers play GIF frames no faster than 50 fps.');
  return w;
}

export async function exportGif(project: Project, s: GifSettings, onProgress: ProgressFn, signal?: AbortSignal): Promise<Blob> {
  await prepareAssets(project);
  const canvas = makeCanvas(s.width, s.height);
  const total = s.range.end - s.range.start + 1;
  const delays = gifDelays(total, s.fps);
  const frames: GifFrameInput[] = [];
  for (let f = s.range.start, i = 0; f <= s.range.end; f++, i++) {
    checkAbort(signal);
    const ctx = renderFrame(project, f, canvas, { alpha: s.transparent, flattenColor: '#ffffff' });
    frames.push({ data: ctx.getImageData(0, 0, s.width, s.height).data, delayCs: delays[i] });
    onProgress({ done: i + 1, total: total * 2, phase: 'Rendering frames' });
    await yieldToUi();
  }
  const options = { width: s.width, height: s.height, maxColors: Math.round(16 + (Math.max(1, Math.min(100, s.quality)) / 100) * 240), loop: s.loop, transparent: s.transparent };
  const worker = await startWorker();
  if (!worker) {
    // Named fallback: workers are blocked here (e.g. strict CSP). Encode on the main thread.
    onProgress({ done: total, total: total * 2, phase: 'Encoding (main-thread fallback)' });
    await yieldToUi();
    checkAbort(signal);
    return new Blob([encodeGif(frames, options) as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
  }
  return new Promise<Blob>((resolve, reject) => {
    const onAbort = () => { worker.terminate(); reject(new ExportCancelled()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<GifWorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress({ done: total + m.done, total: total * 2, phase: 'Encoding GIF' });
      else if (m.type === 'done') { worker.terminate(); signal?.removeEventListener('abort', onAbort); resolve(new Blob([m.bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' })); }
      else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)); }
    };
    worker.onerror = (ev) => { worker.terminate(); reject(new Error(ev.message || 'GIF worker failed')); };
    worker.postMessage({ type: 'encode', frames, options }, frames.map((f) => f.data.buffer));
  });
}

/** Starts the encoder worker and confirms it responds before any frame buffers are transferred. */
async function startWorker(): Promise<Worker | null> {
  let w: Worker;
  try { w = new GifWorker(); } catch { return null; }
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 3000);
    w.onmessage = (e: MessageEvent<GifWorkerResponse>) => { if (e.data.type === 'pong') { clearTimeout(t); resolve(true); } };
    w.onerror = () => { clearTimeout(t); resolve(false); };
    w.postMessage({ type: 'ping' });
  });
  if (!ok) { w.terminate(); return null; }
  return w;
}
