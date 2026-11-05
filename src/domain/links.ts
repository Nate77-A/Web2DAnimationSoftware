// Parent/child links between objects. A linked child is drawn at  parentWorld × bind × own , where `bind` is the
// inverse of the parent's world matrix when the link was made. Linking therefore never moves the child, and
// afterwards it follows everything the parent does while keeping its own transform and keyframes.
//
// A parent is looked up on the same frame (any layer). If it isn't on stage at that frame, the child is drawn on
// its own. Links may chain (grandparents); cycles are refused when linking and ignored when evaluating.
import { contentAt, sampleObject } from './evaluator';
import { applyVector, DEG, IDENTITY, invert, type Matrix, multiply, transformMatrix } from './math';
import { mapObjects } from './ops';
import type { Keyframe, Layer, Project, SceneObject, Transform } from './schema';

/** The object with this id on stage at `frame` (in any layer), with its layer. */
export function objectAt(p: Project, id: string, frame: number): { object: SceneObject; layer: Layer } | null {
  for (const layer of p.layers) {
    const o = contentAt(layer, frame)?.objects.find((x) => x.id === id);
    if (o) return { object: o, layer };
  }
  return null;
}

/** Matrix mapping the object's own transform space to the document: parentWorld × bind (identity when unlinked). */
export function parentSpace(p: Project, o: SceneObject, frame: number, seen: Set<string> = new Set()): Matrix {
  if (!o.link || seen.has(o.id)) return IDENTITY;
  const parent = objectAt(p, o.link.parentId, frame);
  if (!parent) return IDENTITY;
  seen.add(o.id);
  return multiply(worldMatrix(p, parent.object, frame, seen), o.link.bind);
}

/** Where the object is drawn at `frame`, following its parents. */
export function worldMatrix(p: Project, o: SceneObject, frame: number, seen: Set<string> = new Set()): Matrix {
  return multiply(parentSpace(p, o, frame, seen), transformMatrix(sampleObject(o, frame).transform));
}

/** True when `id` is `ancestorId` or one of its descendants' parents chain reaches it. */
export function isDescendant(p: Project, id: string, ancestorId: string, frame: number): boolean {
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = objectAt(p, cur, frame)?.object.link?.parentId;
  }
  return false;
}

/** Ids of objects on `frame` whose parent is `parentId`. */
export function childrenOf(p: Project, parentId: string, frame: number): string[] {
  return p.layers.flatMap((l) => (contentAt(l, frame)?.objects ?? []).filter((o) => o.link?.parentId === parentId).map((o) => o.id));
}

/**
 * Splits a matrix into a transform with the given pivot. Exact for rotation, uniform or axis-aligned scale and
 * flips; a skew (only produced by a non-uniformly scaled, rotated parent) is approximated.
 */
export function decompose(m: Matrix, pivotX: number, pivotY: number): Pick<Transform, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'> {
  const [a, b, c, d] = m;
  const scaleX = Math.hypot(a, b) || 1e-6;
  const rotation = Math.atan2(b, a) / DEG;
  const scaleY = (a * d - b * c) / scaleX;
  // Translation puts the pivot where the matrix puts it.
  const x = a * pivotX + c * pivotY + m[4], y = b * pivotX + d * pivotY + m[5];
  return { x, y, rotation, scaleX, scaleY };
}

/** Transform expressed in another space: decompose(space × T(t)), keeping the pivot. */
export function transformIn(space: Matrix, t: Transform): Transform {
  if (space === IDENTITY) return t;
  return { ...t, ...decompose(multiply(space, transformMatrix(t)), t.pivotX, t.pivotY) };
}

/** Makes `childId` follow `parentId` without moving it. Returns null for itself or a cycle. */
export function linkObject(p: Project, childId: string, parentId: string, frame: number): Project | null {
  if (childId === parentId || isDescendant(p, parentId, childId, frame)) return null;
  const child = objectAt(p, childId, frame), parent = objectAt(p, parentId, frame);
  if (!child || !parent) return null;
  // Keep the child's current placement: newParentWorld × bind = currentParentSpace.
  const bind = multiply(invert(worldMatrix(p, parent.object, frame)), parentSpace(p, child.object, frame));
  return mapObjects(p, [childId], (o) => ({ ...o, link: { parentId, bind } }));
}

/**
 * Removes the link and bakes where the child currently appears into its own transform (and each keyframe, at
 * its frame), so it stays put.
 */
export function unlinkObject(p: Project, childId: string, frame: number): Project {
  const found = objectAt(p, childId, frame);
  if (!found?.object.link) return p;
  const bake = (o: SceneObject): SceneObject => {
    const { link: _l, ...rest } = o;
    void _l;
    const keyframes: Keyframe[] = o.keyframes.map((k) => {
      const t = transformIn(parentSpace(p, o, k.frame), { ...o.transform, x: k.x, y: k.y, rotation: k.rotation, scaleX: k.scaleX, scaleY: k.scaleY });
      return { ...k, x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY };
    });
    return { ...rest, transform: transformIn(parentSpace(p, o, frame), o.transform), keyframes };
  };
  return mapObjects(p, [childId], bake);
}

/** Unlinks (in place) every child of the given objects, e.g. before those objects are deleted. */
export function releaseChildren(p: Project, parentIds: string[], frame: number): Project {
  const gone = new Set(parentIds);
  const kids = p.layers.flatMap((l) => l.objectTracks.flatMap((c) => c.objects))
    .filter((o) => o.link && gone.has(o.link.parentId) && !gone.has(o.id)).map((o) => o.id);
  return kids.reduce((acc, id) => unlinkObject(acc, id, frame), p);
}

/** A document-space move expressed in the object's own space (for nudging linked children). */
export function ownDelta(p: Project, o: SceneObject, frame: number, dx: number, dy: number): [number, number] {
  return applyVector(invert(parentSpace(p, o, frame)), [dx, dy]);
}
