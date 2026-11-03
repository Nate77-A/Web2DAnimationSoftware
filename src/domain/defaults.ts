import { newId, nowIso } from './ids';
import type { BrushSettings, Layer, Project, Style, TextData, Transform } from './schema';
import { SCHEMA_VERSION } from './schema';

export const LAYER_COLORS = ['#3CC8D6FF', '#F2A33AFF', '#9B7BF2FF', '#58C77AFF', '#EF6A82FF', '#5B9CF5FF', '#E6D15AFF'];

export function createLayer(name: string, index: number): Layer {
  return {
    id: newId('layer'), name, order: index, visible: true, locked: false, solo: false, blendMode: 'normal',
    color: LAYER_COLORS[index % LAYER_COLORS.length], exposureTrack: [], objectTracks: [],
  };
}

export function createProject(opts: Partial<Pick<Project, 'name' | 'width' | 'height' | 'fps'>> = {}): Project {
  const t = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('proj'),
    name: opts.name ?? 'Untitled Animation',
    createdAt: t,
    updatedAt: t,
    fps: opts.fps ?? 24,
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    durationFrames: 48,
    background: '#FFFFFFFF',
    assets: [],
    layers: [createLayer('Layer 1', 0)],
    preferences: { onionSkin: false, onionBefore: 2, onionAfter: 1, loopPlayback: true },
  };
}

export const identityTransform = (x = 0, y = 0, pivotX = 0, pivotY = 0): Transform => ({
  x, y, rotation: 0, scaleX: 1, scaleY: 1, pivotX, pivotY,
});

export const defaultStyle = (): Style => ({
  fill: { type: 'solid', color: '#3CC8D6FF' },
  stroke: { type: 'solid', color: '#16191EFF' },
  strokeWidth: 4,
  cap: 'round',
  join: 'round',
  dash: [],
  fillRule: 'nonzero',
});

export const defaultBrush = (): BrushSettings => ({
  size: 12, smoothing: 45, cap: 'round',
  pressure: { enabled: true, min: 0.15, max: 1 },
  tilt: { enabled: false, response: 0.5 },
});

export const defaultText = (): TextData => ({
  content: 'Text', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 72, fontWeight: 600, fontStyle: 'normal',
  align: 'left', lineHeight: 1.2, letterSpacing: 0, width: 0,
});

/** Web-safe font families supported for editing and export (see docs/decisions/0006-fonts.md). */
export const FONT_FAMILIES = [
  'Helvetica, Arial, sans-serif',
  'Arial',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'system-ui',
  'serif',
  'sans-serif',
  'monospace',
];
