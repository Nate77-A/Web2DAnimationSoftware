import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { identityTransform } from '../domain/defaults';
import { emojiObject } from '../domain/emoji';
import { evaluateFrame } from '../domain/evaluator';
import { isNullObject, localBounds, shapeSegments } from '../domain/geometry';
import { parseProject } from '../domain/migrations';
import type { SceneObject, ShapeObject } from '../domain/schema';
import { renderScene } from '../editor/renderer';
import { rect, twoLayerProject } from './fixtures';

const shape = (geometry: Partial<ShapeObject['geometry']>): ShapeObject => {
  const r = rect('s', 50, 50, 100, 100);
  return { ...r, geometry: { ...r.geometry, ...geometry } };
};
const dist = (p: number[]) => Math.hypot(p[0] - 50, p[1] - 50);

describe('star', () => {
  it('has two corners per point, alternating outer and inner radius', () => {
    const { segments } = shapeSegments(shape({ shape: 'star', sides: 5, star: { outer: 1, inner: 0.4, scale: 1 } }).geometry);
    assert.equal(segments.length, 10);
    assert.ok(Math.abs(dist(segments[0].p) - 50) < 1e-9); // first point straight up, at the box edge
    assert.ok(Math.abs(segments[0].p[1]) < 1e-9);
    assert.ok(Math.abs(dist(segments[1].p) - 20) < 1e-9);
  });

  it('the overall size scales outer and inner together', () => {
    const { segments } = shapeSegments(shape({ shape: 'star', sides: 6, star: { outer: 0.8, inner: 0.5, scale: 0.5 } }).geometry);
    assert.ok(Math.abs(dist(segments[0].p) - 20) < 1e-9); // 50 × 0.8 × 0.5
    assert.ok(Math.abs(dist(segments[1].p) - 12.5) < 1e-9); // 50 × 0.5 × 0.5
  });

  it('works without saved star settings (defaults)', () => {
    assert.equal(shapeSegments(shape({ shape: 'star', sides: 4 }).geometry).segments.length, 8);
  });
});

describe('null object', () => {
  /** Minimal canvas recorder: counts drawing calls. */
  function recorder() {
    const calls: string[] = [];
    const ctx = new Proxy({ globalAlpha: 1, canvas: { width: 100, height: 100 } } as Record<string, unknown>, {
      get(target, key: string) {
        if (key in target) return target[key];
        if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1 });
        return (..._args: unknown[]) => { calls.push(key); };
      },
      set(target, key: string, v) { target[key] = v; return true; },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }
  const project = () => {
    const p = twoLayerProject();
    p.layers[1].objectTracks[0].objects = [shape({ shape: 'null' })];
    p.layers[0].objectTracks[0].objects = [];
    return p;
  };

  it('is never drawn in output, but shows on stage', () => {
    const scene = evaluateFrame(project(), 0);
    const out = recorder();
    renderScene(out.ctx, scene, { matrix: [1, 0, 0, 1, 0, 0], getImage: () => undefined, drawBackground: false });
    assert.ok(!out.calls.some((c) => c.startsWith('stroke') || c.startsWith('fill')), out.calls.join(','));
    const stage = recorder();
    renderScene(stage.ctx, scene, { matrix: [1, 0, 0, 1, 0, 0], getImage: () => undefined, drawBackground: false, guides: true });
    assert.ok(stage.calls.includes('strokeRect') && stage.calls.includes('stroke'));
  });

  it('is recognised and keeps its box for selection', () => {
    const n = shape({ shape: 'null' });
    assert.ok(isNullObject(n));
    assert.deepEqual(localBounds(n, () => 0), { x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('emoji', () => {
  it('builds a scaled group of face parts filling the drawn box', () => {
    const g = emojiObject('glasses', 100, 200, 300, 300);
    assert.equal(g.kind, 'group');
    assert.equal(g.metadata.emoji, 'glasses');
    assert.ok(g.children.length >= 8);
    assert.deepEqual(localBounds(g, () => 0), { x: 0, y: 0, width: 100, height: 100 });
    assert.equal(g.transform.scaleX, 3);
    assert.deepEqual([g.transform.x, g.transform.y], [250, 350]);
    assert.ok(emojiObject('smiley', 0, 0, 10, 10).children.length >= 4);
  });

  it('stars, nulls and emoji survive saving', () => {
    const p = twoLayerProject();
    const objs: SceneObject[] = [shape({ shape: 'star', sides: 7, star: { outer: 1, inner: 0.3, scale: 0.9 } }), { ...shape({ shape: 'null' }), id: 'n' }, emojiObject('smiley', 0, 0, 50, 50)];
    p.layers[1].objectTracks[0].objects = objs.map((o, i) => ({ ...o, id: `o${i}`, transform: o.kind === 'group' ? o.transform : identityTransform(0, 0, 0, 0) }));
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    assert.deepEqual(back.layers[1].objectTracks[0].objects, p.layers[1].objectTracks[0].objects);
  });
});
