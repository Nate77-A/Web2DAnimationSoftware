// MP4 (H.264) export through WebCodecs. Support is detected up front; alpha is never claimed.
import type { Project } from '../../domain/schema';
import { cssColor } from '../../domain/color';
import { checkAbort, evenSize, ExportCancelled, makeCanvas, prepareAssets, renderFrame, yieldToUi, type FrameRangeSpec, type ProgressFn } from './common';
import { muxMp4, type MuxSample } from './mp4Muxer';

export interface Mp4Settings {
  name: string;
  width: number;
  height: number;
  range: FrameRangeSpec;
  fps: number;
  /** 1-100 mapped to bitrate. */
  quality: number;
}

export interface Mp4Support { supported: boolean; codec: string | null; reason: string }

const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033', 'avc1.42001f'];

export function mp4Bitrate(s: Pick<Mp4Settings, 'width' | 'height' | 'fps' | 'quality'>) {
  const bpp = 0.04 + (Math.max(1, Math.min(100, s.quality)) / 100) * 0.26;
  return Math.round(Math.min(60e6, Math.max(250e3, s.width * s.height * s.fps * bpp)));
}

export async function detectMp4Support(s: Pick<Mp4Settings, 'width' | 'height' | 'fps' | 'quality'>): Promise<Mp4Support> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return { supported: false, codec: null, reason: 'This browser does not provide WebCodecs (VideoEncoder). Use Chrome/Edge 94+ or Safari 16.4+, or export a PNG sequence / GIF instead.' };
  }
  const width = evenSize(s.width), height = evenSize(s.height);
  for (const codec of CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: mp4Bitrate(s), framerate: s.fps, avc: { format: 'avc' } } as VideoEncoderConfig);
      if (r.supported) return { supported: true, codec, reason: `H.264 (${codec}) at ${width}×${height} is supported by this browser.` };
    } catch { /* try next */ }
  }
  return { supported: false, codec: null, reason: `This browser cannot encode H.264 at ${width}×${height}. Try a smaller size.` };
}

export async function exportMp4(project: Project, s: Mp4Settings, onProgress: ProgressFn, signal?: AbortSignal): Promise<Blob> {
  const support = await detectMp4Support(s);
  if (!support.supported || !support.codec) throw new Error(support.reason);
  await prepareAssets(project);
  const width = evenSize(s.width), height = evenSize(s.height);
  const canvas = makeCanvas(width, height);
  const samples: MuxSample[] = [];
  let avcC: Uint8Array | null = null;
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
      const desc = meta?.decoderConfig?.description;
      if (desc && !avcC) avcC = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array((desc as ArrayBufferView).buffer, (desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteLength).slice();
    },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  encoder.configure({ codec: support.codec, width, height, bitrate: mp4Bitrate(s), framerate: s.fps, avc: { format: 'avc' } } as VideoEncoderConfig);
  const total = s.range.end - s.range.start + 1;
  // MP4/H.264 has no alpha: flatten onto the document background (or white when transparent).
  const flatten = project.background ? cssColor(project.background) : '#ffffff';
  try {
    for (let f = s.range.start, i = 0; f <= s.range.end; f++, i++) {
      checkAbort(signal);
      if (failure) throw failure;
      renderFrame(project, f, canvas, { alpha: false, flattenColor: flatten });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / s.fps), duration: Math.round(1e6 / s.fps) });
      encoder.encode(frame, { keyFrame: i % (s.fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      onProgress({ done: i + 1, total, phase: 'Encoding H.264' });
      await yieldToUi();
    }
    await encoder.flush();
  } catch (e) {
    try { encoder.close(); } catch { /* ignore */ }
    if (e instanceof ExportCancelled) throw e;
    throw e;
  }
  encoder.close();
  if (failure) throw failure;
  if (!avcC) throw new Error('The encoder did not provide decoder configuration (avcC).');
  onProgress({ done: total, total, phase: 'Writing MP4' });
  const bytes = muxMp4({ width, height, fps: s.fps, avcC, samples });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
}
