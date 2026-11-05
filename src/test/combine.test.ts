import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultStyle, identityTransform } from '../domain/defaults';
import type { EvalObject } from '../domain/evaluator';
import { localBounds, objectSubpaths } from '../domain/geometry';
import { transformMatrix } from '../domain/math';
import { parseProject } from '../domain/migrations';
import type { PathObject, SceneObject } from '../domain/schema';
import { combineItems, erasePaint, eraserSweep, mergePaint, PAINT_TAG, type CombineOp } from '../editor/combine';
import { subpathsToPaper } from '../editor/paperAdapter';
import { rect, twoLayerProject } from './fixtures';

/** Square of side `w` with its top-left corner at (x, y) and a solid fill color. */
function square(id: string, x: number, y: number, w: number, color: string): EvalObject {
  const o: SceneObject = { ...rect(id, x + w / 2, y + w / 2, w, w), style: { ...defaultStyle(), fill: { type: 'solid', color } } };
  return { source: o, layerId: 'L', transform: o.transform, opacity: 1, matrix: transformMatrix(o.transform) };
}

const area = (o: SceneObject) => Math.abs(subpathsToPaper(objectSubpaths(o)!).area);
const color = (o: SceneObject) => (o.style.fill.type === 'solid' ? o.style.fill.color : '');
// back: (0,0)-(100,100) red; front: (50,50)-(150,150) blue; overlap 50×50
const back = () => square('back', 0, 0, 100, '#FF0000FF');
const front = () => square('front', 50, 50, 100, '#0000FFFF');
const run = (op: CombineOp, items = [back(), front()]) => {
  const r = combineItems(op, items);
  if ('reason' in r) throw new Error(r.reason);
  return r;
};

describe('combine shapes', () => {
  it('unite merges into one outline with the front style', () => {
    const { objects, anchor } = run('unite');
    assert.equal(objects.length, 1);
    assert.ok(Math.abs(area(objects[0]) - (20000 - 2500)) < 1);
    assert.equal(color(objects[0]), '#0000FFFF');
    assert.equal(anchor.source.id, 'front');
    assert.deepEqual(localBounds(objects[0], () => 0), { x: 0, y: 0, width: 150, height: 150 });
  });

  it('minus front cuts the front out of the back and keeps the back style', () => {
    const { objects, anchor } = run('subtract');
    assert.ok(Math.abs(area(objects[0]) - (10000 - 2500)) < 1);
    assert.equal(color(objects[0]), '#FF0000FF');
    assert.equal(anchor.source.id, 'back');
  });

  it('intersect keeps only the overlap, and explains when there is none', () => {
    assert.ok(Math.abs(area(run('intersect').objects[0]) - 2500) < 1);
    const r = combineItems('intersect', [back(), square('far', 500, 500, 10, '#00FF00FF')]);
    assert.ok('reason' in r && /overlap/.test(r.reason));
  });

  it('exclude removes the overlap, leaving two pieces in one object', () => {
    const o = run('exclude').objects[0];
    assert.ok(Math.abs(area(o) - (20000 - 2 * 2500)) < 1);
    assert.equal(objectSubpaths(o)!.length, 2);
  });

  it('divide splits into pieces styled by the shape on top', () => {
    const { objects } = run('divide');
    assert.equal(objects.length, 3);
    const byArea = objects.map((o) => [Math.round(area(o)), color(o)]).sort((a, b) => +a[0] - +b[0] || String(a[1]).localeCompare(String(b[1])));
    assert.deepEqual(byArea, [[2500, '#0000FFFF'], [7500, '#0000FFFF'], [7500, '#FF0000FF']]);
  });

  it('minus front can punch a hole, stored as a compound path that survives saving', () => {
    const { objects } = run('subtract', [back(), square('hole', 25, 25, 50, '#000000FF')]);
    const o = objects[0];
    assert.equal(o.geometry.subpaths?.length, 1);
    assert.equal(o.style.fillRule, 'evenodd');
    assert.ok(Math.abs(area(o) - (10000 - 2500)) < 1);
    const p = twoLayerProject();
    p.layers[0].objectTracks[0].objects.push(o);
    const back2 = parseProject(JSON.parse(JSON.stringify(p))).layers[0].objectTracks[0].objects.find((x) => x.id === o.id) as PathObject;
    assert.deepEqual(back2.geometry.subpaths, o.geometry.subpaths);
  });
});

describe('paint brush merging', () => {
  /** Square path tagged as Paint Brush paint, top-left (x, y), side w. */
  const paintSquare = (id: string, x: number, y: number, w: number, color = '#FF0000FF', tagged = true): PathObject => ({
    ...rect(id), kind: 'path', brush: null,
    style: { ...defaultStyle(), fill: { type: 'solid', color }, stroke: { type: 'none' }, strokeWidth: 0 },
    metadata: tagged ? { [PAINT_TAG]: '1' } : {},
    transform: identityTransform(0, 0, 0, 0),
    geometry: { closed: true, segments: [[x, y], [x + w, y], [x + w, y + w], [x, y + w]].map((p) => ({ p: p as [number, number], hi: [0, 0] as [number, number], ho: [0, 0] as [number, number] })) },
  });
  const project = (...objs: SceneObject[]) => {
    const p = twoLayerProject();
    p.layers[1] = { ...p.layers[1], exposureTrack: [{ startFrame: 0, endFrame: 23, contentId: 'c-a' }], objectTracks: [{ id: 'c-a', objects: objs }] };
    return p;
  };
  const objectsOf = (p: ReturnType<typeof project>) => p.layers[1].objectTracks[0].objects;

  it('a new stroke merges with overlapping paint of the same color', () => {
    const r = mergePaint(project(paintSquare('old', 0, 0, 100), paintSquare('new', 50, 50, 100)), 'fg', 0, 'new')!;
    const objs = objectsOf(r.project);
    assert.equal(objs.length, 1);
    assert.equal(objs[0].id, r.id);
    assert.equal(objs[0].metadata[PAINT_TAG], '1');
    assert.ok(Math.abs(area(objs[0]) - (20000 - 2500)) < 1);
  });

  it('different colors, non-overlapping strokes and other shapes are left alone', () => {
    assert.equal(mergePaint(project(paintSquare('old', 0, 0, 100, '#0000FFFF'), paintSquare('new', 50, 50, 100)), 'fg', 0, 'new'), null);
    assert.equal(mergePaint(project(paintSquare('old', 0, 0, 100), paintSquare('new', 300, 300, 100)), 'fg', 0, 'new'), null);
    assert.equal(mergePaint(project(paintSquare('shape', 0, 0, 100, '#FF0000FF', false), paintSquare('new', 50, 50, 100)), 'fg', 0, 'new'), null);
  });

  it('painting a ring one stroke at a time leaves a hole in the middle', () => {
    const band = (id: string, x: number, y: number, w: number, h: number) => {
      const o = paintSquare(id, 0, 0, 1);
      o.geometry.segments = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((q) => ({ p: q as [number, number], hi: [0, 0] as [number, number], ho: [0, 0] as [number, number] }));
      return o;
    };
    let p = project(band('top', 0, 0, 300, 100));
    const paintStroke = (o: PathObject) => {
      p = { ...p, layers: p.layers.map((l) => (l.id !== 'fg' ? l : { ...l, objectTracks: [{ ...l.objectTracks[0], objects: [...l.objectTracks[0].objects, o] }] })) };
      p = mergePaint(p, 'fg', 0, o.id)!.project;
    };
    paintStroke(band('left', 0, 0, 100, 300));
    paintStroke(band('bottom', 0, 200, 300, 100));
    paintStroke(band('right', 200, 0, 100, 300));
    const objs = objectsOf(p);
    assert.equal(objs.length, 1);
    assert.equal(objectSubpaths(objs[0])!.length, 2); // outer edge + hole
    assert.ok(Math.abs(area(objs[0]) - (90000 - 10000)) < 1);
  });
});

describe('erasing paint', () => {
  /** Paint square 0..200 in its own coordinates, placed with the given transform. */
  const paint = (t = identityTransform(0, 0, 0, 0)): EvalObject => {
    const o: PathObject = {
      ...rect('p'), kind: 'path', brush: null, transform: t, metadata: { [PAINT_TAG]: '1' },
      style: { ...defaultStyle(), fill: { type: 'solid', color: '#FF0000FF' }, stroke: { type: 'none' }, strokeWidth: 0 },
      geometry: { closed: true, segments: [[0, 0], [200, 0], [200, 200], [0, 200]].map((p) => ({ p: p as [number, number], hi: [0, 0] as [number, number], ho: [0, 0] as [number, number] })) },
    };
    return { source: o, layerId: 'L', transform: t, opacity: 1, matrix: transformMatrix(t) };
  };
  /** Eraser dragged in a straight line, sampled every 5 units. */
  const sweep = (x0: number, y0: number, x1: number, y1: number, r = 20) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
    return eraserSweep(Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, r })))!;
  };

  it('erasing straight across cuts the paint into two pieces', () => {
    const r = erasePaint(paint(), sweep(-50, 100, 250, 100)) as PathObject;
    assert.equal(objectSubpaths(r)!.length, 2);
    assert.ok(Math.abs(area(r) - (40000 - 200 * 40)) < 40, String(area(r)));
    assert.equal(r.id, 'p');
    assert.equal(r.brush, null);
  });

  it('a short stroke inside rubs out a hole', () => {
    const r = erasePaint(paint(), sweep(80, 100, 120, 100)) as PathObject;
    assert.equal(objectSubpaths(r)!.length, 2); // outline + hole
    assert.ok(area(r) < 40000 - 2000);
  });

  it('missing the paint changes nothing; covering it removes it', () => {
    assert.equal(erasePaint(paint(), sweep(400, 400, 500, 400)), 'unchanged');
    assert.equal(erasePaint(paint(), sweep(-50, 100, 250, 100, 200)), null);
  });

  it('moved and rotated paint is erased where it appears, keeping its transform', () => {
    const t = { x: 1000, y: 500, rotation: 90, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 100 };
    const eo = paint(t);
    // On stage the square covers 900..1100 x 400..600; erase a vertical line through its center.
    const r = erasePaint(eo, sweep(1000, 300, 1000, 700)) as PathObject;
    assert.deepEqual(r.transform, t);
    assert.equal(objectSubpaths(r)!.length, 2);
    assert.ok(Math.abs(area(r) - (40000 - 200 * 40)) < 40, String(area(r)));
  });
});
