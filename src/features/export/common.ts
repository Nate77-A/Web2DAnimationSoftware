// Shared export plumbing: deterministic frame rendering from canonical project data, progress, cancel.
import { evaluateFrame } from '../../domain/evaluator';
import type { Project } from '../../domain/schema';
import { renderScene } from '../../editor/renderer';
import { ensureAssetsLoaded, getAssetImage } from '../assets';

export interface FrameRangeSpec { start: number; end: number } // inclusive, 0-based

export interface Progress { done: number; total: number; phase: string }
export type ProgressFn = (p: Progress) => void;

export class ExportCancelled extends Error {
  constructor() { super('Export cancelled'); this.name = 'ExportCancelled'; }
}

export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new ExportCancelled();
}

/** Yields to the event loop so the editor stays responsive during long exports. */
export const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function prepareAssets(project: Project) {
  const missing = await ensureAssetsLoaded(project.assets);
  if (missing.length) throw new Error(`${missing.length} bitmap asset(s) are missing from local storage, so the export would be incomplete.`);
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Renders the evaluated frame into a canvas at the requested output size.
 * `flatten` paints `flattenColor` under transparent areas (used when the format cannot keep alpha).
 */
export function renderFrame(project: Project, frame: number, canvas: HTMLCanvasElement, opts: { alpha: boolean; flattenColor?: string }) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / project.width, sy = canvas.height / project.height;
  const scene = evaluateFrame(project, frame);
  if (!opts.alpha) {
    ctx.fillStyle = opts.flattenColor ?? '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  renderScene(ctx, scene, { matrix: [sx, 0, 0, sy, 0, 0], getImage: getAssetImage, drawBackground: true });
  return ctx;
}

interface DownloadsCap { save(r: { filename: string; data: Blob }): Promise<unknown> }
interface ClaudeHost { use(name: string): Promise<unknown> }

/**
 * Hands a generated file to the viewer. Inside a claude.ai artifact the sandbox blocks direct downloads,
 * so the platform `downloads` capability is used there (the viewer confirms each save). Returns false when
 * the viewer declined.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<boolean> {
  const host = (globalThis as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const dl = (await host.use('downloads')) as DownloadsCap | null;
    if (dl) {
      // The artifact allowlist has no .anims; the file is a ZIP, so offer it as one.
      const name = /\.anims$/i.test(filename) ? `${filename}.zip` : filename;
      try {
        await dl.save({ filename: name, data: blob });
        return true;
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err.code === 'declined') return false;
        throw new Error(err.message || `Download failed (${err.code ?? 'unknown'})`);
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

export function safeFileName(name: string, fallback = 'animation'): string {
  const n = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return n || fallback;
}

export function evenSize(n: number) { return Math.max(2, Math.round(n / 2) * 2); }
