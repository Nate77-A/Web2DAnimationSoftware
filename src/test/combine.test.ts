import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultStyle } from '../domain/defaults';
import type { EvalObject } from '../domain/evaluator';
import { localBounds, objectSubpaths } from '../domain/geometry';
import { transformMatrix } from '../domain/math';
import { parseProject } from '../domain/migrations';
import type { PathObject, SceneObject } from '../domain/schema';
import { combineItems, type CombineOp } from '../editor/combine';
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
