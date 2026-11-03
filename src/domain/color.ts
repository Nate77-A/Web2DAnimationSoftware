import type { Paint } from './schema';

export interface RGBA { r: number; g: number; b: number; a: number } // r,g,b 0..255, a 0..1

export function parseHex(hex: string): RGBA {
  let h = hex.trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (!/^[0-9a-fA-F]{8}$/.test(h)) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
    a: parseInt(h.slice(6, 8), 16) / 255,
  };
}

const h2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

export function toHex8({ r, g, b, a }: RGBA): string {
  return `#${h2(r)}${h2(g)}${h2(b)}${h2(a * 255)}`.toUpperCase();
}

export function toHex6(hex: string): string {
  const { r, g, b } = parseHex(hex);
  return `#${h2(r)}${h2(g)}${h2(b)}`.toUpperCase();
}

/** Accepts #RGB, #RRGGBB, #RRGGBBAA (with or without #). Returns null if invalid. */
export function normalizeHexInput(input: string): string | null {
  const h = input.trim().replace(/^#/, '');
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h)) return null;
  return toHex8(parseHex(h));
}

export function cssColor(hex: string): string {
  const { r, g, b, a } = parseHex(hex);
  return `rgba(${r},${g},${b},${+a.toFixed(4)})`;
}

export function withAlpha(hex: string, a: number): string {
  return toHex8({ ...parseHex(hex), a });
}

export function paintPreviewCss(p: Paint): string {
  switch (p.type) {
    case 'none': return 'transparent';
    case 'solid': return cssColor(p.color);
    case 'linear': return `linear-gradient(${p.angle + 90}deg, ${p.stops.map((s) => `${cssColor(s.color)} ${s.offset * 100}%`).join(', ')})`;
    case 'radial': return `radial-gradient(circle, ${p.stops.map((s) => `${cssColor(s.color)} ${s.offset * 100}%`).join(', ')})`;
  }
}

export function paintHasGradient(p: Paint): boolean {
  return p.type === 'linear' || p.type === 'radial';
}

export function paintHasAlpha(p: Paint): boolean {
  if (p.type === 'solid') return parseHex(p.color).a < 1;
  if (p.type === 'linear' || p.type === 'radial') return p.stops.some((s) => parseHex(s.color).a < 1);
  return false;
}

export function samePaint(a: Paint, b: Paint): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
