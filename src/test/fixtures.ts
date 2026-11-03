import { createProject, defaultStyle, identityTransform } from '../domain/defaults';
import type { Project, SceneObject, ShapeObject } from '../domain/schema';

export function rect(id: string, x = 100, y = 100, w = 50, h = 50): ShapeObject {
  return {
    id, name: id, kind: 'shape', visible: true, locked: false, opacity: 1, metadata: {}, keyframes: [],
    style: defaultStyle(), geometry: { shape: 'rect', width: w, height: h, sides: 4, cornerRadius: 0 },
    transform: identityTransform(x, y, w / 2, h / 2),
  };
}

/** Two layers: "bg" holds one drawing for frames 1-24; "fg" has drawings at 1-12 and 13-24. */
export function twoLayerProject(): Project {
  const p = createProject({ name: 'Fixture' });
  p.durationFrames = 24;
  const bg = { ...p.layers[0], id: 'bg', name: 'Background' };
  bg.exposureTrack = [{ startFrame: 0, endFrame: 23, contentId: 'c-bg' }];
  bg.objectTracks = [{ id: 'c-bg', objects: [rect('sky', 960, 540, 1920, 1080)] }];
  const fg = { ...bg, id: 'fg', name: 'Foreground', order: 1 };
  fg.exposureTrack = [{ startFrame: 0, endFrame: 11, contentId: 'c-a' }, { startFrame: 12, endFrame: 23, contentId: 'c-b' }];
  fg.objectTracks = [{ id: 'c-a', objects: [rect('ball-a')] }, { id: 'c-b', objects: [rect('ball-b', 300)] }];
  p.layers = [bg, fg];
  return p;
}

/** One object tweened x: 0 -> 230, rotation 0 -> 90, opacity 1 -> 0 between frames 1 and 24. */
export function tweenProject(): Project {
  const p = createProject({ name: 'Tween' });
  p.durationFrames = 24;
  const o: SceneObject = { ...rect('mover', 0, 0), keyframes: [
    { frame: 0, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ease: 'linear' },
    { frame: 23, x: 230, y: 0, rotation: 90, scaleX: 2, scaleY: 2, opacity: 0, ease: 'linear' },
  ] };
  p.layers[0] = { ...p.layers[0], exposureTrack: [{ startFrame: 0, endFrame: 23, contentId: 'c1' }], objectTracks: [{ id: 'c1', objects: [o] }] };
  return p;
}
