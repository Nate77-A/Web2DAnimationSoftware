// requestAnimationFrame playback controller. Frame numbers stay integers; fps only maps time to frames.
import { getState, store } from '../editor/state';

let raf = 0;
let anchorTime = 0;
let anchorFrame = 0;
let anchorFps = 24;

function tick(now: number) {
  const s = getState();
  if (!s.playing) { raf = 0; return; }
  const fps = s.project.fps;
  if (fps !== anchorFps) { anchorTime = now; anchorFrame = s.currentFrame; anchorFps = fps; }
  const dur = s.project.durationFrames;
  let f = anchorFrame + Math.floor(((now - anchorTime) * fps) / 1000);
  if (f >= dur) {
    if (s.project.preferences.loopPlayback) {
      f %= dur;
      anchorFrame = f; anchorTime = now;
    } else {
      store.set({ currentFrame: dur - 1, playing: false });
      raf = 0;
      return;
    }
  }
  if (f !== s.currentFrame) store.set({ currentFrame: f });
  raf = requestAnimationFrame(tick);
}

export function play() {
  const s = getState();
  if (s.playing) return;
  let start = s.currentFrame;
  if (start >= s.project.durationFrames - 1) start = 0;
  anchorTime = performance.now();
  anchorFrame = start;
  anchorFps = s.project.fps;
  store.set({ playing: true, currentFrame: start, editingTextId: null });
  if (!raf) raf = requestAnimationFrame(tick);
}

export function stop() {
  if (getState().playing) store.set({ playing: false });
}

export function togglePlay() {
  if (getState().playing) stop(); else play();
}
