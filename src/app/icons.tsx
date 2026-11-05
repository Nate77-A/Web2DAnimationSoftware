// Inline icon set (24-unit grid, stroke = currentColor). Icon-only controls always carry an accessible label.
const P: Record<string, string> = {
  select: 'M5 3l13 8-6 1.5L9 19z',
  transform: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 9h6v6H9z',
  // Pencil: the Brush tool draws crisp, pressure-sensitive strokes, so it is shown as a pencil.
  brush: 'M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4zM14.5 5.5l4 4M4 16l4 4',
  paint: 'M18.5 3.5a2.1 2.1 0 013 3L12 16l-3.5-3.5zM8 14.5c-2.5 0-4 1.5-4 4 0 .9-.6 1.6-1.5 2 2.8.8 7.5.3 7.5-3.5z',
  eraser: 'M16 3.5l5 5-10 10H7l-4-4zM7 18.5h14M12.5 7l5 5',
  shape: 'M3 3h9v9H3zM17 12.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9z',
  pen: 'M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18M2 2l7.6 7.6M11 13a2 2 0 100-4 2 2 0 000 4z',
  text: 'M5 5h14M12 5v14M9 19h6',
  bucket: 'M19 11l-8-8-8.5 8.5a2 2 0 000 3l5 5a2 2 0 003 0zM5 2l5 5M2 13h15M22 20a2 2 0 11-4 0c0-1.6 2-3.5 2-3.5s2 1.9 2 3.5z',
  eyedropper: 'M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 013 3L18 9l.4.4a2.1 2.1 0 010 3 2.1 2.1 0 01-3 0l-3.8-3.8a2.1 2.1 0 010-3 2.1 2.1 0 013 0z',
  hand: 'M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 012.8-2.8L7 15',
  zoom: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3M11 8v6M8 11h6',
  undo: 'M3 7v6h6M21 17a9 9 0 00-15-6.7L3 13',
  redo: 'M21 7v6h-6M3 17a9 9 0 0115-6.7l3 2.7',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M9.9 4.2A9 9 0 0112 4c6.5 0 10 8 10 8a17 17 0 01-2.2 3.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M2 2l20 20M9.9 9.9a3 3 0 004.2 4.2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 017.9-1',
  solo: 'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0M12 3v3M12 18v3M3 12h3M18 12h3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7zM14 4h4v16h-4z',
  stepBack: 'M19 20L9 12l10-8zM5 5v14',
  stepFwd: 'M5 4l10 8-10 8zM19 5v14',
  first: 'M18 6l-8 6 8 6zM6 5v14',
  last: 'M6 6l8 6-8 6zM18 5v14',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
  onion: 'M8 5a7 7 0 100 14M12 5a7 7 0 100 14M16 5a7 7 0 110 14 7 7 0 010-14z',
  keyframe: 'M12 3l9 9-9 9-9-9z',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  swap: 'M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  export: 'M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 002 2h10a2 2 0 002-2v-4',
  folder: 'M3 6a2 2 0 012-2h4l2 3h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  save: 'M5 3h11l5 5v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 3v5h8M7 21v-7h10v7',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
  warning: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  fit: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  tween: 'M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3',
  frameAdd: 'M4 4h16v16H4zM12 8v8M8 12h8',
  frameDup: 'M8 8h12v12H8zM4 16V4h12',
  frameBlank: 'M4 4h16v16H4z',
  frameDel: 'M4 4h16v16H4zM8 12h8',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  triangle: 'M12 4l9 16H3z',
  polygon: 'M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z',
  flipH: 'M12 3v18M16 7l4 5-4 5zM8 7l-4 5 4 5z',
  flipV: 'M3 12h18M7 8l5-4 5 4zM7 16l5 4 5-4z',
  grid: 'M3 3h18v18H3zM3 12h18M12 3v18',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  unlink: 'M18.8 13.4l1.7-1.7a5 5 0 00-7-7l-1.7 1.7M5.2 10.6l-1.7 1.7a5 5 0 007 7l1.7-1.7M8 2v3M2 8h3M16 22v-3M22 16h-3',
};

export function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  const d = P[name] ?? P.info;
  const filled = name === 'keyframe-filled';
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

// Combine-shape icons: a back square and a front square overlapping in the middle.
const BACK_ONLY = '3,3 15,3 15,9 9,9 9,15 3,15';
const FRONT_ONLY = '15,9 21,9 21,21 9,21 9,15 15,15';
const OVERLAP = '9,9 15,9 15,15 9,15';
const COMBINE_FILLED: Record<string, string[]> = {
  unite: ['3,3 15,3 15,9 21,9 21,21 9,21 9,15 3,15'],
  subtract: [BACK_ONLY],
  intersect: [OVERLAP],
  exclude: [BACK_ONLY, FRONT_ONLY],
  divide: [BACK_ONLY, OVERLAP, FRONT_ONLY],
};

export function CombineIcon({ op, size = 20 }: { op: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.25" />
      <rect x="9" y="9" width="12" height="12" fill="none" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.25" />
      {(COMBINE_FILLED[op] ?? []).map((pts) => (
        <polygon key={pts} points={pts} fill="currentColor" fillOpacity={op === 'divide' ? 0.75 : 0.9}
          stroke={op === 'divide' ? 'var(--panel)' : 'currentColor'} strokeWidth={op === 'divide' ? 1.25 : 1} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
