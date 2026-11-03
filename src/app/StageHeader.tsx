import { useEffect, useRef, useState } from 'react';
import { resizeDocument } from '../domain/ops';
import { fitToStage, setZoom } from '../editor/Stage';
import { activeTool, commit, useApp } from '../editor/state';
import { MAX_ZOOM, MIN_ZOOM } from '../editor/scene';
import { TOOL_LIST } from '../editor/tools';
import { Check, NumberField, useDismiss, usePopoverPosition } from './controls';
import { Icon } from './icons';

const HINTS: Record<string, string> = {
  select: 'Click to select · Shift-click to add · drag empty space to marquee · double-click text to edit',
  transform: 'Drag handles to scale (Shift keeps proportions, Alt from center) · drag the round handle to rotate (Shift snaps 15°)',
  brush: 'Draw with pen, mouse or Pencil · fingers pan while drawing · [ and ] change size',
  eraser: 'Sweep across strokes to split them · switch to Delete mode to remove whole objects',
  shape: 'Drag to draw · Shift constrains · Alt draws from center',
  pen: 'Click to add points · drag for curves · click the first point to close · Enter finishes · Esc cancels',
  text: 'Click to add text · click existing text to edit · Ctrl/⌘+Enter commits · Esc cancels',
  bucket: 'Click inside a closed shape to apply the fill swatch',
  eyedropper: 'Click to sample the rendered color into the fill swatch (Alt: other swatch)',
  hand: 'Drag to pan · Space works from any tool',
  zoom: 'Click to zoom in · Alt-click to zoom out · drag a region to zoom to it',
};

export const DOC_PRESETS = [
  { label: 'HD 1080p', w: 1920, h: 1080 }, { label: 'HD 720p', w: 1280, h: 720 }, { label: '4K UHD', w: 3840, h: 2160 },
  { label: 'Square', w: 1080, h: 1080 }, { label: 'Portrait 9:16', w: 1080, h: 1920 }, { label: 'Instagram 4:5', w: 1080, h: 1350 },
];

export function DocSizePopover({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const p = useApp((s) => ({ w: s.project.width, h: s.project.height }));
  const [w, setW] = useState(p.w);
  const [h, setH] = useState(p.h);
  const [scale, setScale] = useState(false);
  const [lock, setLock] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const pos = usePopoverPosition(anchor, ref);
  useDismiss(ref, onClose, anchor);
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>('input')?.focus(); }, []);
  const apply = () => {
    const W = Math.round(w), H = Math.round(h);
    if (W === p.w && H === p.h) { onClose(); return; }
    commit(scale ? 'Resize document and artwork' : 'Resize document', (pr) => resizeDocument(pr, W, H, scale));
    onClose();
    requestAnimationFrame(fitToStage);
  };
  return (
    <div ref={ref} className="popover" role="dialog" aria-label="Document size" style={{ left: pos.left, top: pos.top }}>
      <h4>Document size <button className="icon-btn sm" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button></h4>
      <div className="grid2">
        <NumberField label="Width" scrubLabel="W" value={w} min={16} max={8192} precision={0} unit="px" onChange={(v) => { if (lock) setH(Math.round((v * p.h) / p.w)); setW(v); }} />
        <NumberField label="Height" scrubLabel="H" value={h} min={16} max={8192} precision={0} unit="px" onChange={(v) => { if (lock) setW(Math.round((v * p.w) / p.h)); setH(v); }} />
      </div>
      <Check label="Keep aspect ratio" checked={lock} onChange={setLock} />
      <select className="input" aria-label="Size preset" value="" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
        const pr = DOC_PRESETS[Number(e.target.value)];
        if (pr) { setW(pr.w); setH(pr.h); }
      }}>
        <option value="" disabled>Presets…</option>
        {DOC_PRESETS.map((pr, i) => <option key={pr.label} value={i}>{pr.label} — {pr.w} × {pr.h}</option>)}
      </select>
      <Check label="Scale artwork to fit new size" checked={scale} onChange={setScale} />
      <p className="hint">{scale ? 'Artwork positions and sizes will scale with the document.' : 'Artwork keeps its coordinates; only the artboard and export defaults change.'}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}

export function StageHeader() {
  const s = useApp((st) => ({ zoom: st.viewport.zoom, w: st.project.width, h: st.project.height, tool: activeTool(st) }));
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeBtn = useRef<HTMLButtonElement | null>(null);
  const pct = `${+(s.zoom * 100).toFixed(1)}%`;
  const meta = TOOL_LIST.find((t) => t.id === s.tool);
  const commitZoom = () => {
    const v = parseFloat(text.replace('%', ''));
    if (Number.isFinite(v)) setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v / 100)));
    setEditing(false);
  };
  return (
    <div className="stage-header">
      <div className="stage-title" aria-live="polite">
        <strong>{meta?.label}</strong>
        <span>{HINTS[s.tool]}</span>
      </div>
      <div className="spacer" />
      <div className="view-controls">
        <button className="icon-btn sm" aria-label="Zoom out" data-tip="Zoom out" data-tip-pos="bottom" onClick={() => setZoom(s.zoom / 1.25)}><Icon name="minus" size={16} /></button>
        <input
          className="zoom-field"
          aria-label={`Zoom level, ${pct}. Type a percentage between 12.5 and 3200`}
          value={editing ? text : pct}
          onFocus={(e: React.FocusEvent<HTMLInputElement>) => { setEditing(true); setText(String(+(s.zoom * 100).toFixed(1))); requestAnimationFrame(() => e.target.select()); }}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          onBlur={commitZoom}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') { setEditing(false); (e.currentTarget as HTMLInputElement).blur(); }
          }}
        />
        <button className="icon-btn sm" aria-label="Zoom in" data-tip="Zoom in" data-tip-pos="bottom" onClick={() => setZoom(s.zoom * 1.25)}><Icon name="plus" size={16} /></button>
        <button className="icon-btn sm" aria-label="Fit stage" data-tip="Fit stage" data-tip-pos="bottom" onClick={fitToStage}><Icon name="fit" size={16} /></button>
        <button ref={sizeBtn} className="btn sm size-btn" aria-haspopup="dialog" aria-expanded={sizeOpen} aria-label={`Document size ${s.w} by ${s.h} pixels. Change size`}
          onClick={() => setSizeOpen(!sizeOpen)}>{s.w} × {s.h}</button>
        {sizeOpen && <DocSizePopover anchor={sizeBtn.current} onClose={() => setSizeOpen(false)} />}
      </div>
    </div>
  );
}
