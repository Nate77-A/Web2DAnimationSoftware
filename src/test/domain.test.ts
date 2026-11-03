import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { brushOutline, processSamples, splitSamples } from '../domain/brush';
import { defaultBrush } from '../domain/defaults';
import { applyEase, evaluateFrame, sampleObject } from '../domain/evaluator';
import { segmentsBounds, segmentsToPathData, shapeSegments } from '../domain/geometry';
import { apply, invert, transformMatrix } from '../domain/math';
import { parseProject, ProjectLoadError } from '../domain/migrations';
import {
  addBlankKeyframe, createTween, duplicateFrame, insertFrames, locateObject, mapObjects, removeFrames, setObjectTransform, resizeDocument,
} from '../domain/ops';
import { projectSchema, SCHEMA_VERSION } from '../domain/schema';
import { rect, tweenProject, twoLayerProject } from './fixtures';

describe('schema and migrations', () => {
  it('round-trips a valid project', () => {
    const p = twoLayerProject();
    assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p);
  });

  it('migrates the v0 draft format (frameRate, no preferences)', () => {
    const p = twoLayerProject() as unknown as Record<string, unknown>;
    const { fps, preferences, schemaVersion, ...rest } = p;
    void fps; void preferences; void schemaVersion;
    const v0 = { ...rest, frameRate: 12, layers: (rest.layers as Record<string, unknown>[]).map(({ color, blendMode, solo, ...l }) => { void color; void blendMode; void solo; return l; }) };
    const out = parseProject(v0);
    assert.equal(out.schemaVersion, SCHEMA_VERSION);
    assert.equal(out.fps, 12);
    assert.equal(out.preferences.loopPlayback, true);
    assert.equal(out.layers[0].blendMode, 'normal');
  });

  it('rejects corrupt payloads with a recoverable error', () => {
    assert.throws(() => parseProject({ schemaVersion: 1, name: 'x' }), ProjectLoadError);
    assert.throws(() => parseProject('nope'), ProjectLoadError);
    assert.throws(() => parseProject({ ...twoLayerProject(), schemaVersion: 99 }), /newer version/);
  });

  it('detects referential problems (missing content, overlapping spans)', () => {
    const p = twoLayerProject();
    p.layers[1].exposureTrack.push({ startFrame: 5, endFrame: 6, contentId: 'missing' });
    assert.throws(() => parseProject(p), (e: ProjectLoadError) => e.details.some((d) => d.includes('missing content')) && e.details.some((d) => d.includes('overlapping')));
  });

  it('schema validates colors as #RRGGBBAA', () => {
    const p = twoLayerProject();
    p.background = 'red';
    assert.equal(projectSchema.safeParse(p).success, false);
  });
});

describe('timeline evaluator', () => {
  const p = tweenProject();
  const at = (f: number) => evaluateFrame(p, f).layers[0].objects[0];

  it('frame 1 equals the first keyframe', () => {
    assert.equal(at(0).transform.x, 0);
    assert.equal(at(0).opacity, 1);
  });
  it('frame 12 is linearly interpolated', () => {
    const o = at(11);
    assert.ok(Math.abs(o.transform.x - (230 * 11) / 23) < 1e-9);
    assert.ok(Math.abs(o.transform.rotation - (90 * 11) / 23) < 1e-9);
    assert.ok(Math.abs(o.opacity - (1 - 11 / 23)) < 1e-9);
  });
  it('frame 24 equals the last keyframe and later frames hold it', () => {
    assert.equal(at(23).transform.x, 230);
    assert.equal(at(23).transform.scaleX, 2);
    assert.equal(sampleObject(p.layers[0].objectTracks[0].objects[0], 40).transform.x, 230);
  });
  it('eases are monotonic and hit endpoints', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      assert.equal(applyEase(0, e), 0);
      assert.equal(applyEase(1, e), 1);
      assert.ok(applyEase(0.25, e) < applyEase(0.75, e));
    }
  });
  it('solo shows only soloed layers; hidden layers never render', () => {
    const q = twoLayerProject();
    assert.equal(evaluateFrame(q, 0).layers.length, 2);
    q.layers[1].solo = true;
    assert.deepEqual(evaluateFrame(q, 0).layers.map((l) => l.id), ['fg']);
    q.layers[1].solo = false;
    q.layers[0].visible = false;
    assert.deepEqual(evaluateFrame(q, 0).layers.map((l) => l.id), ['fg']);
  });
  it('held frames reuse one content span (no duplication)', () => {
    const q = twoLayerProject();
    assert.equal(evaluateFrame(q, 5).layers[1].objects[0].source.id, 'ball-a');
    assert.equal(evaluateFrame(q, 12).layers[1].objects[0].source.id, 'ball-b');
  });
});

describe('frame operations', () => {
  it('duplicating frame 12 to 13 produces identical but independent content', () => {
    const q = twoLayerProject();
    q.layers[1].exposureTrack = [{ startFrame: 0, endFrame: 11, contentId: 'c-a' }];
    q.layers[1].objectTracks = [q.layers[1].objectTracks[0]];
    const { project, target } = duplicateFrame(q, 'fg', 11);
    assert.equal(target, 12);
    const a = evaluateFrame(project, 11).layers[1].objects[0], b = evaluateFrame(project, 12).layers[1].objects[0];
    assert.notEqual(a.source.id, b.source.id);
    assert.deepEqual(a.matrix, b.matrix);
    const edited = mapObjects(project, [b.source.id], (o) => setObjectTransform(o, 12, { x: 999 }));
    assert.equal(evaluateFrame(edited, 11).layers[1].objects[0].transform.x, 100);
    assert.equal(evaluateFrame(edited, 12).layers[1].objects[0].transform.x, 999);
  });

  it('duplicate inside a hold splits the span', () => {
    const q = twoLayerProject();
    const { project } = duplicateFrame(q, 'bg', 4);
    assert.deepEqual(project.layers[0].exposureTrack.map((e) => [e.startFrame, e.endFrame]), [[0, 4], [5, 23]]);
  });

  it('blank frame before an existing key shifts later spans right', () => {
    const q = twoLayerProject();
    const { project } = addBlankKeyframe(q, 'fg', 11);
    assert.deepEqual(project.layers[1].exposureTrack.map((e) => [e.startFrame, e.endFrame]), [[0, 11], [12, 12], [13, 24]]);
    assert.equal(project.durationFrames, 25);
  });

  it('insert frame extends the hold; delete frame shifts later frames left', () => {
    const q = twoLayerProject();
    const ins = insertFrames(q, 'fg', 3, 2);
    assert.deepEqual(ins.layers[1].exposureTrack.map((e) => [e.startFrame, e.endFrame]), [[0, 13], [14, 25]]);
    const del = removeFrames(ins, 'fg', 0, 13);
    assert.deepEqual(del.layers[1].exposureTrack.map((e) => [e.startFrame, e.endFrame]), [[0, 11]]);
    assert.equal(del.layers[1].objectTracks.length, 1, 'removed span content is dropped');
  });

  it('shifting spans moves their object keyframes too', () => {
    const q = tweenProject();
    q.durationFrames = 30;
    q.layers[0].exposureTrack[0] = { startFrame: 0, endFrame: 23, contentId: 'c1' };
    const moved = removeFrames({ ...q, layers: [{ ...q.layers[0], exposureTrack: [{ startFrame: 5, endFrame: 28, contentId: 'c1' }], objectTracks: [{ id: 'c1', objects: q.layers[0].objectTracks[0].objects.map((o) => ({ ...o, keyframes: o.keyframes.map((k) => ({ ...k, frame: k.frame + 5 })) })) }] }] }, q.layers[0].id, 0, 4);
    const keys = moved.layers[0].objectTracks[0].objects[0].keyframes.map((k) => k.frame);
    assert.deepEqual(keys, [0, 23]);
  });

  it('create tween keys start and end, inserting room if needed', () => {
    const q = twoLayerProject();
    q.layers[1].exposureTrack = [{ startFrame: 0, endFrame: 0, contentId: 'c-a' }, { startFrame: 1, endFrame: 23, contentId: 'c-b' }];
    const r = createTween(q, ['ball-a'], 0)!;
    assert.equal(r.endFrame, q.fps - 1);
    const loc = locateObject(r.project, 'ball-a')!;
    assert.deepEqual(loc.object.keyframes.map((k) => k.frame), [0, q.fps - 1]);
    assert.equal(r.project.layers[1].exposureTrack[1].startFrame, q.fps, 'next span was pushed back');
  });

  it('auto-key writes to a keyframe when the object is animated', () => {
    const p = tweenProject();
    const o = p.layers[0].objectTracks[0].objects[0];
    const edited = setObjectTransform(o, 11, { y: 50 });
    assert.deepEqual(edited.keyframes.map((k) => k.frame), [0, 11, 23]);
    assert.equal(sampleObject(edited, 11).transform.y, 50);
    assert.equal(edited.transform.y, o.transform.y, 'base transform untouched');
  });

  it('resizing the document does not scale artwork unless asked', () => {
    const q = twoLayerProject();
    assert.equal(resizeDocument(q, 1280, 720, false).layers[1].objectTracks[0].objects[0].transform.x, 100);
    const s = resizeDocument(q, 960, 540, true).layers[1].objectTracks[0].objects[0].transform;
    assert.equal(s.x, 50);
    assert.equal(s.scaleX, 0.5);
  });
});

describe('geometry and brush', () => {
  it('ellipse bounds are exact', () => {
    const g = shapeSegments({ shape: 'ellipse', width: 200, height: 100, sides: 4, cornerRadius: 0 });
    const b = segmentsBounds(g.segments, true);
    assert.ok(Math.abs(b.x) < 1e-6 && Math.abs(b.width - 200) < 1e-6 && Math.abs(b.height - 100) < 1e-6);
  });
  it('polygon has the requested side count; path data closes', () => {
    const g = shapeSegments({ shape: 'polygon', width: 100, height: 100, sides: 7, cornerRadius: 0 });
    assert.equal(g.segments.length, 7);
    assert.match(segmentsToPathData(g.segments, true), /^M.*Z$/);
  });
  it('object matrix maps the pivot to the position and inverts', () => {
    const o = rect('r', 300, 200, 40, 20);
    const m = transformMatrix({ ...o.transform, rotation: 37, scaleX: 2, scaleY: -1.5 });
    assert.deepEqual(apply(m, [20, 10]).map((v) => +v.toFixed(9)), [300, 200]);
    const back = apply(invert(m), apply(m, [3, 4]));
    assert.ok(Math.abs(back[0] - 3) < 1e-9 && Math.abs(back[1] - 4) < 1e-9);
  });
  it('brush pressure widens the outline; eraser splits samples', () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 0, pressure: i < 25 ? 0.1 : 1, tiltX: 0, tiltY: 0, t: i * 8 }));
    const s = defaultBrush();
    const samples = processSamples(raw, s, 1);
    const light = segmentsBounds(brushOutline(samples.slice(0, 20), s, true, false), true);
    const heavy = segmentsBounds(brushOutline(samples.slice(-20), s, true, false), true);
    assert.ok(heavy.height > light.height * 2);
    const flat = segmentsBounds(brushOutline(samples.slice(0, 20), s, false, false), true);
    assert.ok(Math.abs(flat.height - s.size) < 1.5, 'no pressure → base size');
    const runs = splitSamples(samples, [{ x: 50, y: 0, r: 5 }]);
    assert.equal(runs.length, 2);
  });
});
