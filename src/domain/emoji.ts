// Emoji faces for the Shape tool, built as groups of ordinary shapes and paths so they render and export like
// any other artwork. Parts are laid out in a 100×100 box; the group's transform scales it to the drawn size.
import { identityTransform } from './defaults';
import { newId } from './ids';
import type { GroupObject, PathObject, Segment, ShapeObject, Style, Vec } from './schema';

export type EmojiKind = 'smiley' | 'glasses';

/** `glasses` is the sunglasses face (the id is kept so earlier projects still open). */
export const EMOJI_NAMES: Record<EmojiKind, string> = { smiley: 'Happy face', glasses: 'Sunglasses face' };

const INK = '#3A2A12FF', FACE = '#FFCC33FF', FACE_EDGE = '#E09E00FF', SHADES = '#1C2027FF', SHINE = '#FFFFFF8C';

const style = (fill: string | null, stroke: string | null, strokeWidth = 0): Style => ({
  fill: fill ? { type: 'solid', color: fill } : { type: 'none' },
  stroke: stroke ? { type: 'solid', color: stroke } : { type: 'none' },
  strokeWidth, cap: 'round', join: 'round', dash: [], fillRule: 'nonzero',
});
const base = (name: string, st: Style) => ({ id: newId('obj'), name, visible: true, locked: false, opacity: 1, style: st, metadata: {}, keyframes: [] });
const pt = (p: Vec, hi: Vec = [0, 0], ho: Vec = [0, 0]): Segment => ({ p, hi, ho });

function ellipse(name: string, x: number, y: number, w: number, h: number, st: Style): ShapeObject {
  return { ...base(name, st), kind: 'shape', geometry: { shape: 'ellipse', width: w, height: h, sides: 4, cornerRadius: 0 }, transform: identityTransform(x + w / 2, y + h / 2, w / 2, h / 2) };
}
function stroke(name: string, segments: Segment[], st: Style): PathObject {
  return { ...base(name, st), kind: 'path', geometry: { segments, closed: false }, brush: null, transform: identityTransform(0, 0, 0, 0) };
}

const face = () => ellipse('Face', 0, 0, 100, 100, style(FACE, FACE_EDGE, 3));
const smile = (y: number) => stroke('Smile', [pt([27, y], [0, 0], [8, 20]), pt([73, y], [-8, 20], [0, 0])], style(null, INK, 5));

/** Parts of each face, back to front. */
function parts(kind: EmojiKind) {
  if (kind === 'smiley') {
    return [face(), ellipse('Left eye', 30, 29, 11, 17, style(INK, null)), ellipse('Right eye', 59, 29, 11, 17, style(INK, null)), smile(60)];
  }
  // Sunglasses: dark lenses that are flat on top and rounded below, joined by a top bar, with a shine on each.
  const lens = (name: string, x0: number, x1: number) => {
    const shape = stroke(name, [pt([x0, 33], [0, 12], [0, 0]), pt([x1, 33], [0, 0], [0, 12]), pt([(x0 + x1) / 2, 53], [9, 0], [-9, 0])], style(SHADES, SHADES, 2));
    return { ...shape, geometry: { ...shape.geometry, closed: true } };
  };
  return [
    face(),
    lens('Left lens', 15, 46), lens('Right lens', 54, 85),
    stroke('Frame', [pt([13, 34]), pt([87, 34])], style(null, SHADES, 5)),
    stroke('Left arm', [pt([15, 35]), pt([4, 31])], style(null, SHADES, 4)),
    stroke('Right arm', [pt([85, 35]), pt([96, 31])], style(null, SHADES, 4)),
    stroke('Left shine', [pt([21, 38]), pt([27, 44])], style(null, SHINE, 3)),
    stroke('Right shine', [pt([60, 38]), pt([66, 44])], style(null, SHINE, 3)),
    smile(65),
  ];
}

/** A face filling the box (x, y, w, h) in document space. */
export function emojiObject(kind: EmojiKind, x: number, y: number, w: number, h: number, name = EMOJI_NAMES[kind]): GroupObject {
  return {
    ...base(name, style(null, null)),
    kind: 'group',
    children: parts(kind),
    metadata: { emoji: kind },
    transform: { x: x + w / 2, y: y + h / 2, rotation: 0, scaleX: w / 100, scaleY: h / 100, pivotX: 50, pivotY: 50 },
  };
}
