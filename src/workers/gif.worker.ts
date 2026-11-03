// GIF encoding worker. Typed message contract: GifWorkerRequest in, GifWorkerResponse out.
import { encodeGif, type GifFrameInput, type GifOptions } from '../features/export/gifEncoder';

export type GifWorkerRequest = { type: 'ping' } | { type: 'encode'; frames: GifFrameInput[]; options: GifOptions };
export type GifWorkerResponse =
  | { type: 'pong' }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; bytes: Uint8Array }
  | { type: 'error'; message: string };

const post = (m: GifWorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<GifWorkerRequest>) => {
  if (e.data.type === 'ping') { post({ type: 'pong' }); return; }
  try {
    const { frames, options } = e.data;
    const bytes = encodeGif(frames, options, (i) => post({ type: 'progress', done: i + 1, total: frames.length }));
    post({ type: 'done', bytes }, [bytes.buffer]);
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
