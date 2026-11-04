import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultBrush, defaultStyle, identityTransform } from '../domain/defaults';
import { parseProject } from '../domain/migrations';
import {
  bendCurve, cubicPoint, curvePoints, deleteAnchors, insertAnchor, isSmooth, moveAnchors, setHandle, toggleSmooth,
} from '../domain/pathEdit';
import type { BrushSample, PathObject, Segment, Vec } from '../domain/schema';
import { applyEditedPath, brushSpine, editablePath, resampleAlongSpine } from '../editor/pathEdit';
import { rect, twoLayerProject } from './fixtures';

const seg = (x: number, y: number, hi: Vec = [0, 0], ho: Vec = [0, 0]): Segment => ({ p: [x, y], hi, ho });
const near = (a: Vec, b: Vec, tol = 1e-6) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol, `${a} vs ${b}`);
const line = () => [seg(0, 0), seg(100, 0), seg(100, 100)];

describe('path edit geometry', () => {
  it('bendCurve moves the grabbed point exactly by the drag, anchors stay put', () => {
    for (const t of [0.2, 0.5, 0.8]) {
      const before = cubicPoint(curvePoints(line(), 0), t);
      const out = bendCurve(line(), false, 0, t, [5, -40]);
      near(cubicPoint(curvePoints(out, 0), t), [before[0] + 5, before[1] - 40], 1e-9);
      near(out[0].p, [0, 0]);
      near(out[1].p, [100, 0]);
    }
  });

  it('bendCurve keeps a smooth anchor smooth on the far side', () => {
    const segs = [seg(0, 0), seg(100, 0, [-30, 0], [30, 0]), seg(200, 0)];
    const out = bendCurve(segs, false, 0, 0.5, [0, -50]);
    assert.ok(isSmooth(out[1]));
  });

  it('setHandle mirrors the direction of a smooth anchor unless broken', () => {
    const s = [seg(0, 0, [-20, 0], [40, 0])];
    const smooth = setHandle(s, 0, 'ho', [0, 30]);
    near(smooth[0].hi, [0, -20]); // collinear, original length kept
    const broken = setHandle(s, 0, 'ho', [0, 30], true);
    near(broken[0].hi, [-20, 0]);
  });

  it('toggleSmooth converts sharp -> smooth -> sharp', () => {
    const smooth = toggleSmooth(line(), false, 1);
    assert.ok(isSmooth(smooth[1]));
    // handles run along the line between the neighbors, a third of each neighbor distance
    assert.ok(Math.abs(Math.hypot(...smooth[1].hi) - 100 / 3) < 1e-9);
    const sharp = toggleSmooth(smooth, false, 1);
    assert.deepEqual([sharp[1].hi, sharp[1].ho], [[0, 0], [0, 0]]);
  });

  it('insertAnchor splits a curve without changing its shape', () => {
    const segs = [seg(0, 0, [0, 0], [30, -60]), seg(100, 0, [-20, -50], [0, 0]), seg(150, 80)];
    const r = insertAnchor(segs, false, 0, 0.3)!;
    assert.equal(r.index, 1);
    assert.equal(r.segments.length, 4);
    near(r.segments[1].p, cubicPoint(curvePoints(segs, 0), 0.3), 1e-9);
    // the two new curves trace the original: compare points across both halves
    for (const u of [0.1, 0.5, 0.9]) {
      near(cubicPoint(curvePoints(r.segments, 0), u), cubicPoint(curvePoints(segs, 0), 0.3 * u), 1e-9);
      near(cubicPoint(curvePoints(r.segments, 1), u), cubicPoint(curvePoints(segs, 0), 0.3 + 0.7 * u), 1e-9);
    }
    assert.ok(isSmooth(r.segments[1]));
  });

  it('insertAnchor puts a sharp anchor on a straight line, including the closing curve', () => {
    const r = insertAnchor(line(), true, 2, 0.5)!;
    assert.equal(r.index, 3);
    near(r.segments[3].p, [50, 50]);
    assert.deepEqual([r.segments[3].hi, r.segments[3].ho], [[0, 0], [0, 0]]);
    assert.equal(insertAnchor(line(), false, 2, 0.5), null); // an open path has no closing curve
  });

  it('moveAnchors and deleteAnchors', () => {
    near(moveAnchors(line(), [0, 2], [1, 2])[2].p, [101, 102]);
    assert.equal(deleteAnchors(line(), [1])!.length, 2);
    assert.equal(deleteAnchors(line(), [0, 1]), null);
  });
});

describe('path edit objects', () => {
  it('editing a shape turns it into a path with the same id, style and transform', () => {
    const r = rect('box', 10, 20, 100, 50);
    const ep = editablePath(r)!;
    assert.equal(ep.source, 'shape');
    const out = applyEditedPath(r, moveAnchors(ep.segments, [0], [-5, -5]), ep.closed);
    assert.equal(out.kind, 'path');
    assert.equal(out.id, 'box');
    assert.deepEqual(out.transform, r.transform);
    assert.deepEqual(out.style, r.style);
  });

  it('brush strokes edit their centerline and keep pressure along it', () => {
    const samples: BrushSample[] = Array.from({ length: 41 }, (_, i) => [i * 5, 0, i / 40, 0, 0, i * 16]);
    const o: PathObject = {
      id: 's', name: 's', kind: 'path', visible: true, locked: false, opacity: 1, metadata: {}, keyframes: [],
      style: defaultStyle(), transform: identityTransform(100, 0, 100, 0),
      geometry: { segments: [], closed: true },
      brush: { samples, hasPressure: true, hasTilt: false, settings: defaultBrush() },
    };
    const spine = brushSpine(o.brush!);
    assert.ok(spine.length >= 2);
    near(spine[0].p, [0, 0], 1e-6);
    near(spine[spine.length - 1].p, [200, 0], 1e-6);
    const bent = bendCurve(spine, false, 0, 0.5, [0, -60]);
    const next = applyEditedPath(o, bent, false) as PathObject;
    assert.deepEqual(next.brush!.spine, bent);
    const ns = next.brush!.samples;
    near([ns[0][0], ns[0][1]], [0, 0], 1e-6);
    near([ns[ns.length - 1][0], ns[ns.length - 1][1]], [200, 0], 1e-6);
    assert.ok(Math.min(...ns.map((q) => q[1])) < -30, 'samples follow the bent spine');
    assert.ok(Math.abs(ns[0][2] - 0) < 1e-9 && Math.abs(ns[ns.length - 1][2] - 1) < 1e-9, 'pressure keeps its start and end');
    assert.ok(next.geometry.segments.length > 4 && next.geometry.closed);
  });

  it('resampling a one-point stroke moves the dot', () => {
    const out = resampleAlongSpine([[5, 5, 0.5, 0, 0, 0]], [seg(10, 20)]);
    near([out[0][0], out[0][1]], [10, 20]);
  });

  it('a saved brush spine survives the schema round-trip', () => {
    const p = twoLayerProject();
    const stroke: PathObject = {
      ...rect('x'), kind: 'path', geometry: { segments: line(), closed: false },
      brush: { samples: [[0, 0, 0.5, 0, 0, 0], [10, 0, 0.5, 0, 0, 16]], hasPressure: false, hasTilt: false, settings: defaultBrush(), spine: line() },
    } as unknown as PathObject;
    p.layers[0].objectTracks[0].objects.push(stroke);
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    const o = back.layers[0].objectTracks[0].objects.find((x) => x.id === 'x') as PathObject;
    assert.deepEqual(o.brush!.spine, line());
  });
});
