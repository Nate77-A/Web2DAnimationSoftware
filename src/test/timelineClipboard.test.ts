import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProject } from '../domain/defaults';
import type { KeyRef } from '../domain/keyframes';
import { projectSchema, type Keyframe, type Project, type SceneObject } from '../domain/schema';
import { copyFrames, copyKeys, deleteFrameRange, deleteKeys, keyEase, pasteClip, setKeyEase } from '../domain/timelineClipboard';
import { rect } from './fixtures';

const key = (frame: number): Keyframe => ({ frame, x: frame, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ease: 'linear' });
const obj = (id: string, frames: number[] = []): SceneObject => ({ ...rect(id), keyframes: frames.map(key) });

/** Two layers. "T" (top): A 0-9 (tween keys 0, 9), B 10-19. "U" (under): X 0-19. */
function project(): Project {
  const p = createProject({ name: 'Clip' });
  p.durationFrames = 20;
  const base = p.layers[0];
  p.layers = [
    { ...base, id: 'U', name: 'Under', order: 0, exposureTrack: [{ startFrame: 0, endFrame: 19, contentId: 'x' }], objectTracks: [{ id: 'x', objects: [obj('bg')] }] },
    {
      ...base, id: 'T', name: 'Top', order: 1,
      exposureTrack: [{ startFrame: 0, endFrame: 9, contentId: 'a' }, { startFrame: 10, endFrame: 19, contentId: 'b' }],
      objectTracks: [{ id: 'a', objects: [obj('ball', [0, 9])] }, { id: 'b', objects: [obj('box')] }],
    },
  ];
  return p;
}
const D = (layerId: string, frame: number): KeyRef => ({ layerId, frame, kind: 'drawing' });
const T = (layerId: string, frame: number): KeyRef => ({ layerId, frame, kind: 'tween' });
const spans = (p: Project, id: string) => p.layers.find((l) => l.id === id)!.exposureTrack.map((e) => `${e.startFrame}-${e.endFrame}`).join(' ');
const objectsAt = (p: Project, id: string, f: number) => {
  const l = p.layers.find((x) => x.id === id)!;
  const e = l.exposureTrack.find((x) => f >= x.startFrame && f <= x.endFrame)!;
  return l.objectTracks.find((c) => c.id === e.contentId)!.objects;
};
const ok = (r: ReturnType<typeof pasteClip>) => { assert.ok('project' in r, 'reason' in r ? r.reason : ''); return (r as { project: Project }).project; };

describe('timeline copy / paste / delete', () => {
  it('pasting copied frames inserts them and pushes later frames right', () => {
    const p = ok(pasteClip(project(), copyFrames(project(), ['T'], 10, 12), 'T', 0));
    assert.equal(spans(p, 'T'), '0-2 3-12 13-22');
    assert.equal(objectsAt(p, 'T', 0)[0].name, 'box');
    assert.notEqual(objectsAt(p, 'T', 0)[0].id, 'box'); // pasted objects are independent copies
    assert.equal(p.durationFrames, 23);
    projectSchema.parse(p);
  });

  it('pasting into the middle of a drawing splits it around the pasted frames', () => {
    const p = ok(pasteClip(project(), copyFrames(project(), ['T'], 10, 11), 'T', 15));
    assert.equal(spans(p, 'T'), '0-9 10-14 15-16 17-21');
    assert.equal(objectsAt(p, 'T', 17)[0].name, 'box');
  });

  it('copying a drawing keyframe copies its whole drawing, tween keys moved to the paste point', () => {
    const clip = copyKeys(project(), [D('T', 0)])!;
    const p = ok(pasteClip(project(), clip, 'T', 20));
    assert.equal(spans(p, 'T'), '0-9 10-19 20-29');
    assert.deepEqual(objectsAt(p, 'T', 20)[0].keyframes.map((k) => k.frame), [20, 29]);
  });

  it('multi-layer clips paste onto the same number of layers below the target', () => {
    const clip = copyFrames(project(), ['T', 'U'], 0, 1);
    const p = ok(pasteClip(project(), clip, 'T', 5));
    assert.equal(spans(p, 'T'), '0-4 5-6 7-11 12-21');
    assert.equal(spans(p, 'U'), '0-4 5-6 7-21');
    const r = pasteClip(project(), clip, 'U', 5); // only the top copied layer has a row to land on
    assert.equal(spans(ok(r), 'U'), '0-4 5-6 7-21');
  });

  it('tween keys paste onto the same objects at the new frame, only inside their drawing', () => {
    const clip = copyKeys(project(), [T('T', 9)])!;
    assert.equal(clip.kind, 'tweenKeys');
    const p = ok(pasteClip(project(), clip, 'T', 5));
    assert.deepEqual(objectsAt(p, 'T', 0)[0].keyframes.map((k) => k.frame), [0, 5, 9]);
    const r = pasteClip(project(), clip, 'T', 12);
    assert.ok('reason' in r);
  });

  it('pasting onto a locked layer is refused', () => {
    const p = project();
    p.layers[1] = { ...p.layers[1], locked: true };
    assert.ok('reason' in pasteClip(p, copyFrames(p, ['T'], 0, 0), 'T', 3));
  });

  it('deleting frames removes them; deleting a drawing key lets the previous drawing hold', () => {
    assert.equal(spans(deleteFrameRange(project(), ['T'], 0, 4), 'T'), '0-4 5-14');
    const p = deleteKeys(project(), [D('T', 10)]);
    assert.equal(spans(p, 'T'), '0-19');
    assert.equal(p.layers[1].objectTracks.length, 1);
    assert.equal(spans(deleteKeys(project(), [D('T', 0)]), 'T'), '10-19'); // nothing before it: frames become empty
  });

  it('deleting a tween key removes it from the objects keyed there', () => {
    const p = deleteKeys(project(), [T('T', 9)]);
    assert.deepEqual(objectsAt(p, 'T', 0)[0].keyframes.map((k) => k.frame), [0]);
  });

  it('reads and sets the ease of a key', () => {
    assert.equal(keyEase(project(), T('T', 0)), 'linear');
    assert.equal(keyEase(project(), D('T', 0)), 'linear'); // drawing key with a tween key on its first frame
    assert.equal(keyEase(project(), D('T', 10)), undefined); // no tween there
    const p = setKeyEase(project(), T('T', 0), 'easeInOut');
    assert.equal(keyEase(p, T('T', 0)), 'easeInOut');
  });
});
