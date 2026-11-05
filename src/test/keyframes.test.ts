import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProject } from '../domain/defaults';
import { clampedMove, keysInRange, layerKeys, moveKeys, type KeyRef } from '../domain/keyframes';
import type { Keyframe, Project, SceneObject } from '../domain/schema';
import { rect } from './fixtures';

const key = (frame: number): Keyframe => ({ frame, x: frame, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ease: 'linear' });
const obj = (id: string, frames: number[] = []): SceneObject => ({ ...rect(id), keyframes: frames.map(key) });

/** Layer "L": drawing A frames 0-9 (tween keys 0 and 9), drawing B frames 10-19, then empty, drawing C 25-29. */
function project(): Project {
  const p = createProject({ name: 'Keys' });
  p.durationFrames = 30;
  p.layers[0] = {
    ...p.layers[0], id: 'L',
    exposureTrack: [
      { startFrame: 0, endFrame: 9, contentId: 'a' },
      { startFrame: 10, endFrame: 19, contentId: 'b' },
      { startFrame: 25, endFrame: 29, contentId: 'c' },
    ],
    objectTracks: [
      { id: 'a', objects: [obj('ball', [0, 9])] },
      { id: 'b', objects: [obj('box')] },
      { id: 'c', objects: [obj('end')] },
    ],
  };
  return p;
}
const D = (frame: number): KeyRef => ({ layerId: 'L', frame, kind: 'drawing' });
const T = (frame: number): KeyRef => ({ layerId: 'L', frame, kind: 'tween' });
const spans = (p: Project) => p.layers[0].exposureTrack.map((e) => [e.contentId, e.startFrame, e.endFrame]);
const keysOf = (p: Project, content: string) => p.layers[0].objectTracks.find((c) => c.id === content)!.objects[0].keyframes.map((k) => k.frame);

describe('timeline keyframes', () => {
  it('lists drawing and tween keys', () => {
    assert.deepEqual(layerKeys(project().layers[0]).map((k) => `${k.kind[0]}${k.frame}`), ['d0', 't0', 't9', 'd10', 'd25']);
    assert.deepEqual(keysInRange(project(), ['L'], 5, 12).map((k) => `${k.kind[0]}${k.frame}`), ['t9', 'd10']);
  });

  it('moving a drawing key later makes the previous drawing hold longer', () => {
    const p = moveKeys(project(), [D(10)], 3)!;
    // B is followed by empty frames, so it keeps its length; C is untouched
    assert.deepEqual(spans(p), [['a', 0, 12], ['b', 13, 22], ['c', 25, 29]]);
  });

  it('a drawing that runs up to the next one keeps its end when its start moves', () => {
    const p = moveKeys(moveKeys(project(), [D(25)], -5)!, [D(10)], 2)!; // C now starts right after B
    assert.deepEqual(spans(p), [['a', 0, 11], ['b', 12, 19], ['c', 20, 24]]);
  });

  it('moving a drawing key earlier shortens the previous drawing, but not past its tween keys', () => {
    assert.equal(moveKeys(project(), [D(10)], -4), null); // drawing A's tween key at frame 9 would be cut off
    const p = moveKeys(moveKeys(project(), [T(9)], -4)!, [D(10)], -4)!;
    assert.deepEqual(spans(p), [['a', 0, 5], ['b', 6, 15], ['c', 25, 29]]);
    assert.deepEqual(keysOf(p, 'a'), [0, 5]);
  });

  it('a drawing followed by empty frames moves as a whole', () => {
    const p = moveKeys(project(), [D(25)], -3)!;
    assert.deepEqual(spans(p), [['a', 0, 9], ['b', 10, 19], ['c', 22, 26]]);
  });

  it('moving several keys keeps their spacing and carries tween keys of spans that move whole', () => {
    const p = moveKeys(project(), [D(0), D(10), D(25)], 2)!;
    assert.deepEqual(spans(p), [['a', 2, 11], ['b', 12, 21], ['c', 27, 31]]);
    assert.deepEqual(keysOf(p, 'a'), [2, 11]);
    assert.equal(p.durationFrames, 32);
  });

  it('a drawing key carries the tween key on its first frame but cannot pass the next tween key', () => {
    const p = moveKeys(project(), [D(0)], 4)!;
    assert.deepEqual(spans(p)[0], ['a', 4, 9]);
    assert.deepEqual(keysOf(p, 'a'), [4, 9]);
    assert.equal(moveKeys(project(), [D(0)], 9), null); // start would land on the key at 9
  });

  it('tween keys move within their drawing, never onto another key or outside it', () => {
    assert.deepEqual(keysOf(moveKeys(project(), [T(9)], -3)!, 'a'), [0, 6]);
    assert.equal(moveKeys(project(), [T(9)], 1), null); // frame 10 belongs to the next drawing
    assert.equal(moveKeys(project(), [T(9)], -9), null); // would land on the key at 0
    assert.deepEqual(keysOf(moveKeys(project(), [T(0)], 3)!, 'a'), [3, 9]);
  });

  it('drawing keys cannot cross a neighbor or go before frame 1', () => {
    assert.equal(moveKeys(project(), [D(10)], 15), null); // would pass the drawing at 25
    assert.equal(moveKeys(project(), [D(0)], -1), null);
  });

  it('clampedMove stops at the last allowed frame', () => {
    const r = clampedMove(project(), [D(25)], 30);
    assert.equal(r.delta, 30);
    const s = clampedMove(project(), [D(10)], 40);
    assert.equal(s.delta, 14); // up to frame 24, just before the drawing at 25
    assert.deepEqual(spans(s.project)[1], ['b', 24, 24]);
  });
});
