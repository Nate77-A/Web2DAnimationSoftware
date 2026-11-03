// Versioned application schema (ProjectV1). This is the product file contract: it is independent of
// any renderer. Persisted field names must not change without a versioned migration (see migrations.ts).
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

const finite = z.number().finite();
const int = z.number().int();
const vec = z.tuple([finite, finite]);
/** Colors are stored as 8-digit hex: #RRGGBBAA. */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{8}$/);

export const segmentSchema = z.object({ p: vec, hi: vec, ho: vec });
export const colorStopSchema = z.object({ offset: finite.min(0).max(1), color: colorSchema });

export const paintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('solid'), color: colorSchema }),
  z.object({ type: z.literal('linear'), stops: z.array(colorStopSchema).min(2).max(16), angle: finite }),
  z.object({ type: z.literal('radial'), stops: z.array(colorStopSchema).min(2).max(16) }),
]);

export const styleSchema = z.object({
  fill: paintSchema,
  stroke: paintSchema,
  strokeWidth: finite.min(0).max(1000),
  cap: z.enum(['butt', 'round', 'square']),
  join: z.enum(['miter', 'round', 'bevel']),
  dash: z.array(finite.min(0)).max(8),
  fillRule: z.enum(['nonzero', 'evenodd']),
});

export const transformSchema = z.object({
  x: finite, y: finite, rotation: finite, scaleX: finite, scaleY: finite, pivotX: finite, pivotY: finite,
});

export const easeSchema = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']);
export const keyframeSchema = z.object({
  frame: int.min(0),
  x: finite, y: finite, rotation: finite, scaleX: finite, scaleY: finite,
  opacity: finite.min(0).max(1),
  ease: easeSchema,
});

export const brushSettingsSchema = z.object({
  size: finite.min(0.1).max(500),
  smoothing: finite.min(0).max(100),
  cap: z.enum(['round', 'butt']),
  pressure: z.object({ enabled: z.boolean(), min: finite.min(0).max(1), max: finite.min(0).max(1) }),
  tilt: z.object({ enabled: z.boolean(), response: finite.min(0).max(1) }),
});

/** Sample tuple: [x, y, pressure, tiltX, tiltY, timestampMs]. */
export const brushSampleSchema = z.tuple([finite, finite, finite, finite, finite, finite]);

export const brushMetaSchema = z.object({
  samples: z.array(brushSampleSchema),
  hasPressure: z.boolean(),
  hasTilt: z.boolean(),
  settings: brushSettingsSchema,
});

export const textDataSchema = z.object({
  content: z.string().max(10000),
  fontFamily: z.string().max(200),
  fontSize: finite.min(1).max(2000),
  fontWeight: int.min(100).max(900),
  fontStyle: z.enum(['normal', 'italic']),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: finite.min(0.5).max(5),
  letterSpacing: finite.min(-50).max(200),
  width: finite.min(0).max(100000),
});

export const shapeTypeSchema = z.enum(['rect', 'ellipse', 'triangle', 'polygon']);

const objectBase = {
  id: z.string().min(1),
  name: z.string().max(200),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: finite.min(0).max(1),
  transform: transformSchema,
  style: styleSchema,
  metadata: z.record(z.string(), z.string()),
  keyframes: z.array(keyframeSchema),
};

export const pathObjectSchema = z.object({
  ...objectBase,
  kind: z.literal('path'),
  geometry: z.object({ segments: z.array(segmentSchema), closed: z.boolean() }),
  brush: brushMetaSchema.nullable(),
});
export const shapeObjectSchema = z.object({
  ...objectBase,
  kind: z.literal('shape'),
  geometry: z.object({
    shape: shapeTypeSchema, width: finite.min(0), height: finite.min(0), sides: int.min(3).max(64), cornerRadius: finite.min(0),
  }),
});
export const textObjectSchema = z.object({ ...objectBase, kind: z.literal('text'), text: textDataSchema });
export const bitmapObjectSchema = z.object({
  ...objectBase,
  kind: z.literal('bitmap'),
  assetRef: z.string().min(1),
  geometry: z.object({ width: finite.min(1), height: finite.min(1) }),
});

export type PathObject = z.infer<typeof pathObjectSchema>;
export type ShapeObject = z.infer<typeof shapeObjectSchema>;
export type TextObject = z.infer<typeof textObjectSchema>;
export type BitmapObject = z.infer<typeof bitmapObjectSchema>;
export type GroupObject = Omit<PathObject, 'kind' | 'geometry' | 'brush'> & { kind: 'group'; children: SceneObject[] };
export type SceneObject = PathObject | ShapeObject | TextObject | BitmapObject | GroupObject;

export const sceneObjectSchema: z.ZodType<SceneObject> = z.lazy(() =>
  z.union([
    pathObjectSchema, shapeObjectSchema, textObjectSchema, bitmapObjectSchema,
    z.object({ ...objectBase, kind: z.literal('group'), children: z.array(sceneObjectSchema) }),
  ]),
) as z.ZodType<SceneObject>;

export const contentSchema = z.object({ id: z.string().min(1), objects: z.array(sceneObjectSchema) });
export const exposureSchema = z.object({ startFrame: int.min(0), endFrame: int.min(0), contentId: z.string().min(1) })
  .refine((e) => e.endFrame >= e.startFrame, 'endFrame must be >= startFrame');

export const blendModeSchema = z.enum([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light',
  'soft-light', 'difference', 'exclusion',
]);

export const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  order: int.min(0),
  visible: z.boolean(),
  locked: z.boolean(),
  solo: z.boolean(),
  blendMode: blendModeSchema,
  color: colorSchema,
  exposureTrack: z.array(exposureSchema),
  objectTracks: z.array(contentSchema),
});

export const assetSchema = z.object({
  id: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  name: z.string().max(260),
  width: int.min(1),
  height: int.min(1),
  byteLength: int.min(1),
});

export const preferencesSchema = z.object({
  onionSkin: z.boolean(),
  onionBefore: int.min(0).max(10),
  onionAfter: int.min(0).max(10),
  loopPlayback: z.boolean(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  fps: int.min(1).max(120),
  width: int.min(16).max(8192),
  height: int.min(16).max(8192),
  durationFrames: int.min(1).max(100000),
  background: colorSchema.nullable(),
  assets: z.array(assetSchema),
  layers: z.array(layerSchema).min(1),
  preferences: preferencesSchema,
});

export type Vec = [number, number];
export type Segment = z.infer<typeof segmentSchema>;
export type ColorStop = z.infer<typeof colorStopSchema>;
export type Paint = z.infer<typeof paintSchema>;
export type Style = z.infer<typeof styleSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type Ease = z.infer<typeof easeSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type BrushSettings = z.infer<typeof brushSettingsSchema>;
export type BrushSample = z.infer<typeof brushSampleSchema>;
export type BrushMeta = z.infer<typeof brushMetaSchema>;
export type TextData = z.infer<typeof textDataSchema>;
export type ShapeType = z.infer<typeof shapeTypeSchema>;
export type Content = z.infer<typeof contentSchema>;
export type Exposure = z.infer<typeof exposureSchema>;
export type BlendMode = z.infer<typeof blendModeSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ObjectKind = SceneObject['kind'];

/** Semantic checks Zod cannot express structurally (referential integrity). Returns problems found. */
export function validateIntegrity(p: Project): string[] {
  const problems: string[] = [];
  const assetIds = new Set(p.assets.map((a) => a.id));
  const objectIds = new Set<string>();
  for (const layer of p.layers) {
    const contentIds = new Set(layer.objectTracks.map((c) => c.id));
    const spans = [...layer.exposureTrack].sort((a, b) => a.startFrame - b.startFrame);
    for (let i = 0; i < spans.length; i++) {
      if (!contentIds.has(spans[i].contentId)) problems.push(`Layer "${layer.name}" references missing content ${spans[i].contentId}`);
      if (i > 0 && spans[i].startFrame <= spans[i - 1].endFrame) problems.push(`Layer "${layer.name}" has overlapping frame spans`);
    }
    const walk = (objs: SceneObject[]) => {
      for (const o of objs) {
        if (objectIds.has(o.id)) problems.push(`Duplicate object id ${o.id}`);
        objectIds.add(o.id);
        if (o.kind === 'bitmap' && !assetIds.has(o.assetRef)) problems.push(`Bitmap ${o.name} references missing asset`);
        if (o.kind === 'group') walk(o.children);
      }
    };
    for (const c of layer.objectTracks) walk(c.objects);
  }
  return problems;
}
