// What the Shape tool can draw, shared by its options panel, the tool rail's hold-for-shapes pop-up and the
// selected shape's Shape section.
import type { ShapeTool } from '../editor/state';
import { NumberField } from './controls';

export interface ShapeChoice { value: ShapeTool; icon: string; title: string; tip: string }

export const SHAPE_CHOICES: ShapeChoice[] = [
  { value: 'rect', icon: 'rect', title: 'Rectangle', tip: 'Draw rectangles, with optional rounded corners.' },
  { value: 'ellipse', icon: 'ellipse', title: 'Ellipse', tip: 'Draw ovals and circles.' },
  { value: 'triangle', icon: 'triangle', title: 'Triangle', tip: 'Draw triangles.' },
  { value: 'polygon', icon: 'polygon', title: 'Polygon', tip: 'Draw shapes with any number of equal sides.' },
  { value: 'star', icon: 'star', title: 'Star', tip: 'Draw stars. Set the number of points and how far the outer and inner points reach.' },
  { value: 'null', icon: 'nullObj', title: 'Null', tip: 'An invisible helper, like an After Effects null: a green box on stage that never appears in exports. Link objects to it and animate the null to move them together.' },
  { value: 'smiley', icon: 'smiley', title: 'Happy face', tip: 'Draw a smiling face emoji.' },
  { value: 'glasses', icon: 'glasses', title: 'Sunglasses face', tip: 'Draw a cool smiling face emoji wearing sunglasses.' },
];

/** Shape types a drawn shape can be switched between (not nulls or emoji, which are different kinds of object). */
export const SWITCHABLE_SHAPES = SHAPE_CHOICES.filter((c) => !['null', 'smiley', 'glasses'].includes(c.value));

export type StarSettings = { outer: number; inner: number; scale: number };

/** Points, outer %, inner % and an overall % that scales outer and inner together. */
export function StarFields({ points, star, onPoints, onStar }: {
  points: number; star: StarSettings; onPoints: (n: number) => void; onStar: (patch: Partial<StarSettings>) => void;
}) {
  return (
    <div className="grid2">
      <NumberField label="Star points" scrubLabel="Points" value={points} min={3} max={64} precision={0} onChange={(v) => onPoints(Math.round(v))} />
      <NumberField label="Overall size of the points (scales outer and inner together)" scrubLabel="Overall" value={Math.round(star.scale * 100)} min={1} max={500} precision={0} unit="%"
        onChange={(v) => onStar({ scale: v / 100 })} />
      <NumberField label="Outer points (how far the tips reach)" scrubLabel="Outer" value={Math.round(star.outer * 100)} min={1} max={500} precision={0} unit="%"
        onChange={(v) => onStar({ outer: v / 100 })} />
      <NumberField label="Inner points (how deep the valleys go)" scrubLabel="Inner" value={Math.round(star.inner * 100)} min={0} max={500} precision={0} unit="%"
        onChange={(v) => onStar({ inner: v / 100 })} />
    </div>
  );
}
