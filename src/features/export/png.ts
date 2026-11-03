// PNG sequence export: renders each frame from the evaluator, zips numbered files.
import JSZip from 'jszip';
import type { Project } from '../../domain/schema';
import { checkAbort, makeCanvas, prepareAssets, renderFrame, yieldToUi, type FrameRangeSpec, type ProgressFn } from './common';

export interface PngSettings {
  name: string;
  width: number;
  height: number;
  range: FrameRangeSpec;
  alpha: boolean;
  /** ZIP deflate level 0-9. PNG pixel compression itself uses the browser's encoder. */
  compression: number;
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
}

export async function exportPng(project: Project, s: PngSettings, onProgress: ProgressFn, signal?: AbortSignal): Promise<Blob> {
  await prepareAssets(project);
  const canvas = makeCanvas(s.width, s.height);
  const total = s.range.end - s.range.start + 1;
  const pad = String(s.range.end + 1).length;
  if (total === 1) {
    renderFrame(project, s.range.start, canvas, { alpha: s.alpha, flattenColor: '#ffffff' });
    onProgress({ done: 1, total: 1, phase: 'Encoding PNG' });
    return toBlob(canvas);
  }
  const zip = new JSZip();
  for (let f = s.range.start, i = 0; f <= s.range.end; f++, i++) {
    checkAbort(signal);
    renderFrame(project, f, canvas, { alpha: s.alpha, flattenColor: '#ffffff' });
    zip.file(`${s.name}_${String(f + 1).padStart(Math.max(4, pad), '0')}.png`, await toBlob(canvas));
    onProgress({ done: i + 1, total, phase: 'Rendering frames' });
    await yieldToUi();
  }
  checkAbort(signal);
  onProgress({ done: total, total, phase: 'Compressing ZIP' });
  const level = Math.max(0, Math.min(9, Math.round(s.compression)));
  return zip.generateAsync({ type: 'blob', compression: level === 0 ? 'STORE' : 'DEFLATE', compressionOptions: { level } });
}
