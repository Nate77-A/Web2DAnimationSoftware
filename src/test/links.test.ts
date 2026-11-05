import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProject } from '../domain/defaults';
import { evaluateFrame } from '../domain/evaluator';
import { isDescendant, linkObject, releaseChildren, unlinkObject, worldMatrix } from '../domain/links';
import { apply, type Matrix } from '../domain/math';
import { parseProject } from '../domain/migrations';
import { cloneContent, mapObjects, setObjectTransform } from '../domain/ops';
import type { Keyframe, Project, SceneObject } from '../domain/schema';
import { rect } from './fixtures';

/** Layers "A" (body at 100,100) and "B" (hand at 300,100, and a ball at 500,100). */
function project(): Project {
  const p = createProject({ name: 'Links' });
  const base = p.layers[0];
  p.layers = [
    { ...base, id: 'A', order: 0, exposureTrack: [{ startFrame: 0, endFrame: 23, contentId: 'ca' }], objectTracks: [{ id: 'ca', objects: [rect('body', 100, 100)] }] },
    { ...base, id: 'B', order: 1, exposureTrack: [{ startFrame: 0, endFrame: 23, contentId: 'cb' }], objectTracks: [{ id: 'cb', objects: [rect('hand', 300, 100), rect('ball', 500, 100)] }] },
  ];
  return p;
}
const obj = (p: Project, id: string) => p.layers.flatMap((l) => l.objectTracks.flatMap((c) => c.objects)).find((o) => o.id === id)!;
const where = (p: Project, id: string, f = 0) => apply(worldMatrix(p, obj(p, id), f), [obj(p, id).transform.pivotX, obj(p, id).transform.pivotY]);
const near = (a: number[], b: number[], tol = 1e-6) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${a} vs ${b}`);
const edit = (p: Project, id: string, patch: Partial<SceneObject['transform']>) => mapObjects(p, [id], (o) => setObjectTransform(o, 0, patch));

describe('parent links', () => {
  it('linking never moves the child', () => {
    let p = edit(project(), 'body', { rotation: 30, scaleX: 2, scaleY: 2 });
    const before = worldMatrix(p, obj(p, 'hand'), 0);
    p = linkObject(p, 'hand', 'body', 0)!;
    near(worldMatrix(p, obj(p, 'hand'), 0), before);
  });

  it('the child follows when the parent moves, rotates or scales', () => {
    let p = linkObject(project(), 'hand', 'body', 0)!;
    p = edit(p, 'body', { x: 200 });
    near(where(p, 'hand'), [400, 100]);
    p = edit(p, 'body', { x: 100, rotation: 90 });
    near(where(p, 'hand'), [100, 300]); // 200 to the right of the body, rotated a quarter turn
    p = edit(p, 'body', { rotation: 0, scaleX: 2, scaleY: 2 });
    near(where(p, 'hand'), [500, 100]);
  });

  it('links chain, and the evaluated scene uses the followed position', () => {
    let p = linkObject(project(), 'hand', 'body', 0)!;
    p = linkObject(p, 'ball', 'hand', 0)!;
    p = edit(p, 'body', { x: 150 });
    near(where(p, 'ball'), [550, 100]);
    const eo = evaluateFrame(p, 0).layers[1].objects.find((x) => x.source.id === 'ball')!;
    near(apply(eo.matrix, [25, 25]), [550, 100]);
  });

  it('a parent animation drives its child on every frame', () => {
    const key = (frame: number, x: number): Keyframe => ({ frame, x, y: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ease: 'linear' });
    let p = linkObject(project(), 'hand', 'body', 0)!;
    p = mapObjects(p, ['body'], (o) => ({ ...o, keyframes: [key(0, 100), key(10, 200)] }));
    near(where(p, 'hand', 5), [350, 100]);
    near(where(p, 'hand', 10), [400, 100]);
  });

  it('refuses self-links and cycles', () => {
    assert.equal(linkObject(project(), 'hand', 'hand', 0), null);
    const p = linkObject(project(), 'hand', 'body', 0)!;
    assert.equal(linkObject(p, 'body', 'hand', 0), null);
    assert.ok(isDescendant(p, 'hand', 'body', 0));
  });

  it('unlinking keeps the child where it appears, including its keyframes', () => {
    let p = linkObject(project(), 'hand', 'body', 0)!;
    p = edit(p, 'body', { rotation: 45, x: 160 });
    p = mapObjects(p, ['hand'], (o) => ({ ...o, keyframes: [{ frame: 0, x: 300, y: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ease: 'linear' }] }));
    const before: Matrix = worldMatrix(p, obj(p, 'hand'), 0);
    p = unlinkObject(p, 'hand', 0);
    assert.equal(obj(p, 'hand').link, undefined);
    near(worldMatrix(p, obj(p, 'hand'), 0), before, 1e-9);
  });

  it('deleting a parent releases its children in place', () => {
    let p = linkObject(project(), 'hand', 'body', 0)!;
    p = edit(p, 'body', { x: 180 });
    const at = where(p, 'hand');
    p = releaseChildren(p, ['body'], 0);
    assert.equal(obj(p, 'hand').link, undefined);
    near(where(p, 'hand'), at);
  });

  it('copies keep links inside the copy and survive saving', () => {
    let p = linkObject(project(), 'ball', 'hand', 0)!;
    const copy = cloneContent(p.layers[1].objectTracks[0]);
    const [hand, ball] = copy.objects;
    assert.equal(ball.link?.parentId, hand.id);
    p = parseProject(JSON.parse(JSON.stringify(p)));
    assert.equal(obj(p, 'ball').link?.parentId, 'hand');
  });
});
