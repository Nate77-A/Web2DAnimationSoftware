// Timeline: layer rows with visibility/lock/solo, frame grid (canvas), playhead, frame rate and zoom controls.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cssColor, withAlpha } from '../domain/color';
import { isLayerEffectivelyVisible } from '../domain/evaluator';
import type { Layer } from '../domain/schema';
import {
  cmdAddLayer, cmdBlankFrame, cmdCreateTween, cmdDeleteFrames, cmdDeleteLayer, cmdDuplicateFrame, cmdDuplicateLayer, cmdInsertFrame,
  cmdMoveLayer, cmdUpdateLayer, goToFrame, toggleSolo, cmdAddKeyframe,
} from '../editor/actions';
import { clampedMove, keyId, keysInRange, objectTracks, spanTweenKeys, type KeyRef, type ObjectTrack } from '../domain/keyframes';
import type { Ease } from '../domain/schema';
import { copyFrames, copyKeys, deleteFrameRange, deleteKeys, keyEase, pasteClip, setKeyEase, type TimelineClip } from '../domain/timelineClipboard';
import { beginGesture, cancelGesture, commit, commitMerge, endGesture, getState, store, toast, updateGesture, useApp } from '../editor/state';
import { commands, formatKeys, FPS_HELP, setPref, setTimelineZoom } from '../app/commands';
import { useDismiss, usePopoverPosition } from '../app/controls';
import { Icon } from '../app/icons';
import { ObjectThumb } from '../app/LinkedObjectsPanel';
import { play, stop } from './playback';

const ROW_H = 28;
const ROW_H_TOUCH = 40;
const FPS_PRESETS = [8, 12, 15, 24, 25, 30, 48, 50, 60];

const rowHeight = () => (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? ROW_H_TOUCH : ROW_H);

function formatTime(frame: number, fps: number) {
  const secs = frame / fps;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function FpsControl() {
  const fps = useApp((s) => s.project.fps);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(String(fps));
  const btn = useRef<HTMLButtonElement | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const pos = usePopoverPosition(open ? btn.current : null, ref);
  useDismiss(ref, () => setOpen(false), btn.current, open);
  useEffect(() => setCustom(String(fps)), [fps]);
  const set = (f: number) => { commit('Frame rate', (p) => (p.fps === f ? p : { ...p, fps: f })); setOpen(false); };
  return (
    <>
      <button ref={btn} className="btn sm fps-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`Frame rate ${fps} frames per second. Change`}
        data-tip="Frame rate" data-tip-desc="How many frames play per second. Click to choose a preset or type a custom rate." onClick={() => setOpen(!open)}>{fps} fps</button>
      {open && (
        <div ref={ref} className="popover" role="dialog" aria-label="Frame rate" style={{ left: pos.left, top: pos.top, width: 220 }}>
          <h4>Frame rate</h4>
          <div className="grid3">
            {FPS_PRESETS.map((f) => <button key={f} className="btn sm" aria-pressed={f === fps} style={f === fps ? { borderColor: 'var(--accent)', color: 'var(--accent-strong)' } : undefined} data-tip={`${f} fps`} data-tip-desc={FPS_HELP[f] ?? `Play ${f} frames per second.`} onClick={() => set(f)}>{f}</button>)}
          </div>
          <div className="row">
            <input className="input" inputMode="numeric" aria-label="Custom frame rate (whole number 1-120)" value={custom}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustom(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { const v = parseInt(custom, 10); if (v >= 1 && v <= 120) set(v); } }} />
            <button className="btn sm primary" data-tip="Set frame rate" data-tip-desc="Use the custom rate typed here (1–120 fps)." onClick={() => { const v = parseInt(custom, 10); if (v >= 1 && v <= 120) set(v); }}>Set</button>
          </div>
          <p className="hint">Changes playback speed and export duration. Frame numbers stay the same.</p>
        </div>
      )}
    </>
  );
}

function LayerRow({ layer, index, total, active, effVisible, onDragStart, dropHint, tracks, expanded, onToggle }: {
  layer: Layer; index: number; total: number; active: boolean; effVisible: boolean; onDragStart: (e: React.PointerEvent, id: string) => void; dropHint: 'before' | 'after' | null;
  tracks: number; expanded: boolean; onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name);
  useEffect(() => setName(layer.name), [layer.name]);
  return (
    <div
      className={`layer-row${!effVisible ? ' hidden-layer' : ''}${dropHint ? ` drop-${dropHint}` : ''}`}
      role="row"
      aria-selected={active}
      aria-label={`Layer ${layer.name}${!layer.visible ? ', hidden' : ''}${layer.locked ? ', locked' : ''}${layer.solo ? ', solo' : ''}`}
      data-layer-id={layer.id}
      style={{ height: rowHeight() }}
      onClick={() => store.set({ activeLayerId: layer.id })}
    >
      {tracks > 0 ? (
        <button type="button" className="icon-btn sm layer-expand" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${layer.name}`}
          data-tip={expanded ? 'Collapse motion tweens' : `Show ${tracks} motion tween${tracks > 1 ? 's' : ''}`}
          data-tip-desc={expanded ? 'Fold the per-object rows back into this layer row.' : 'Show each animated object on its own row, so you can select, move, copy and ease its keyframes separately.'}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggle(); }}>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
      ) : <span className="layer-expand-spacer" aria-hidden="true" />}
      <span className="layer-color" style={{ background: cssColor(layer.color) }} aria-hidden="true" data-tip="Layer color" data-tip-desc="Drag to move this layer up or down in the stack." onPointerDown={(e: React.PointerEvent<HTMLSpanElement>) => onDragStart(e, layer.id)} />
      <span className="layer-name" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <input autoFocus aria-label="Layer name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name !== layer.name) cmdUpdateLayer(layer.id, { name: name.trim().slice(0, 200) }, 'Rename layer'); else setName(layer.name); }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { e.stopPropagation(); if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(layer.name); setEditing(false); } }} />
        ) : layer.name}
      </span>
      <button className={`icon-btn sm${!layer.visible ? ' off' : ''}`} aria-pressed={!layer.visible} aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`} data-tip={layer.visible ? 'Hide layer' : 'Show layer'} data-tip-desc={layer.visible ? 'Hide this layer on the stage and in exports.' : 'Make this layer visible again.'}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); cmdUpdateLayer(layer.id, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer'); }}>
        <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={16} />
      </button>
      <button className={`icon-btn sm${layer.locked ? ' off' : ''}`} aria-pressed={layer.locked} aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`} data-tip={layer.locked ? 'Unlock layer' : 'Lock layer'} data-tip-desc={layer.locked ? 'Allow drawing and editing on this layer again.' : 'Protect this layer from accidental edits. It stays visible.'}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); cmdUpdateLayer(layer.id, { locked: !layer.locked }, layer.locked ? 'Unlock layer' : 'Lock layer'); }}>
        <Icon name={layer.locked ? 'lock' : 'unlock'} size={16} />
      </button>
      <button className="icon-btn sm" aria-pressed={layer.solo} aria-label={layer.solo ? `Unsolo ${layer.name}` : `Solo ${layer.name}`} data-tip={layer.solo ? 'Unsolo layer' : 'Solo layer'} data-tip-desc="Show only soloed layers so you can focus on them. Turn solo off on every layer to see all layers."
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggleSolo(layer.id); }}>
        <Icon name="solo" size={16} />
      </button>
      <span className="sr-only">Layer {total - index} of {total}</span>
    </div>
  );
}

export function Timeline() {
  const s = useApp((st) => ({
    project: st.project, frame: st.currentFrame, active: st.activeLayerId, range: st.frameRange, playing: st.playing, zoom: st.timelineZoom,
    keySel: st.keySelection, clip: st.timelineClip, pasteArmed: st.pasteArmed, expanded: st.expandedLayers, selection: st.selection,
  }));
  const [height, setHeight] = useState(240);
  const [scrollX, setScrollX] = useState(0);
  const [width, setWidth] = useState(600);
  const [drag, setDrag] = useState<{ id: string; over: string | null; pos: 'before' | 'after' } | null>(null);
  const rulerRef = useRef<HTMLCanvasElement | null>(null);
  const rowsRef = useRef<HTMLCanvasElement | null>(null);
  const rowsWrap = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<HTMLDivElement | null>(null);
  const hscroll = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<{ frame: number; layerIndex: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; layerId: string; frame: number; target: MenuTarget } | null>(null);
  const [easeMenu, setEaseMenu] = useState<{ x: number; y: number; key: KeyRef } | null>(null);
  const hold = useRef({ timer: 0, fired: false });
  const lastKeyPress = useRef<{ id: string; time: number } | null>(null);

  const p = s.project;
  const ppf = s.zoom;
  const rh = rowHeight();
  const displayLayers = [...p.layers].reverse(); // top layer first
  // Timeline rows: each layer, followed by one row per animated object when the layer is expanded.
  const expandedSet = new Set(s.expanded);
  const rows: TrackRow[] = displayLayers.flatMap((layer): TrackRow[] => [
    { kind: 'layer', layer },
    ...(expandedSet.has(layer.id) ? objectTracks(layer).map((track): TrackRow => ({ kind: 'object', layer, track })) : []),
  ]);
  const toggleExpanded = (id: string) => store.set((st) => ({
    expandedLayers: st.expandedLayers.includes(id) ? st.expandedLayers.filter((x) => x !== id) : [...st.expandedLayers, id],
  }));
  const totalW = p.durationFrames * ppf + 120;

  // keep playhead visible
  useEffect(() => {
    const el = hscroll.current;
    if (!el) return;
    const x = s.frame * ppf;
    if (x < el.scrollLeft || x > el.scrollLeft + width - ppf * 2) el.scrollLeft = Math.max(0, x - width / 3);
  }, [s.frame, ppf, width]);

  useEffect(() => {
    const wrap = rowsWrap.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setWidth(wrap.clientWidth));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fit = () => {
      const st = getState();
      const r = st.frameRange;
      const span = r ? r.end - r.start + 1 : st.project.durationFrames;
      const z = Math.max(4, Math.min(48, (width - 40) / span));
      setTimelineZoom(z);
      requestAnimationFrame(() => { if (hscroll.current) hscroll.current.scrollLeft = r ? r.start * z : 0; });
    };
    window.addEventListener('studio:timeline-fit', fit);
    return () => window.removeEventListener('studio:timeline-fit', fit);
  }, [width]);

  // ------- drawing
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const ruler = rulerRef.current, rowsCanvas = rowsRef.current;
    if (!ruler || !rowsCanvas) return;
    const W = width;
    const H = Math.max(rows.length * rh, rowsWrap.current?.clientHeight ?? 0);
    for (const [c, h] of [[ruler, 26], [rowsCanvas, H]] as const) {
      c.width = Math.round(W * dpr); c.height = Math.round(h * dpr);
      c.style.width = `${W}px`; c.style.height = `${h}px`;
    }
    const first = Math.max(0, Math.floor(scrollX / ppf));
    const last = Math.min(p.durationFrames - 1, Math.ceil((scrollX + W) / ppf));
    const X = (f: number) => f * ppf - scrollX;

    // ruler
    const rc = ruler.getContext('2d')!;
    rc.setTransform(dpr, 0, 0, dpr, 0, 0);
    rc.fillStyle = '#1b1f26'; rc.fillRect(0, 0, W, 26);
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const labelStep = steps.find((st) => st * ppf >= 30) ?? 1000;
    rc.font = '10px ui-monospace, Menlo, monospace';
    rc.textBaseline = 'middle';
    for (let f = first; f <= last; f++) {
      const x = X(f);
      const major = (f + 1) % labelStep === 0 || f === 0;
      rc.strokeStyle = major ? '#4a5462' : '#2f3640';
      rc.beginPath(); rc.moveTo(x + 0.5, major ? 12 : 19); rc.lineTo(x + 0.5, 26); rc.stroke();
      if (major) { rc.fillStyle = '#a7b0bc'; rc.fillText(String(f + 1), x + 3, 9); }
    }
    // seconds markers
    rc.fillStyle = 'rgba(60,200,214,.7)';
    for (let sec = Math.ceil(first / p.fps); sec * p.fps <= last; sec++) {
      if (sec === 0) continue;
      const x = X(sec * p.fps);
      rc.fillRect(x, 22, 1, 4);
    }
    // end of duration
    rc.fillStyle = 'rgba(255,255,255,.04)'; rc.fillRect(X(p.durationFrames), 0, W, 26);
    // playhead head
    const px = X(s.frame);
    rc.fillStyle = '#ff4d6d';
    rc.fillRect(px, 0, Math.max(2, ppf), 26);
    if (ppf >= 18) { rc.fillStyle = '#fff'; rc.font = '600 10px ui-monospace, Menlo, monospace'; rc.fillText(String(s.frame + 1), px + 3, 13); }

    // rows
    const c = rowsCanvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#20252d'; c.fillRect(0, 0, W, H);
    for (let f = first; f <= last; f++) {
      if ((f + 1) % 5 === 0) { c.fillStyle = 'rgba(255,255,255,.025)'; c.fillRect(X(f), 0, ppf, H); }
      if (ppf >= 8) { c.fillStyle = '#272d36'; c.fillRect(X(f), 0, 1, H); }
    }
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(X(p.durationFrames), 0, W, H);
    const selected = new Set(s.keySel.map(keyId));
    const selectedObjects = new Set(s.selection);
    rows.forEach((row, i) => {
      const y = i * rh;
      const layer = row.layer;
      if (row.kind === 'object') {
        // One object's motion tween: its drawing's extent, the tween bar and only its own keys.
        const t = row.track;
        c.fillStyle = selectedObjects.has(t.objectId) ? 'rgba(60,200,214,.10)' : 'rgba(0,0,0,.16)'; c.fillRect(0, y, W, rh);
        c.fillStyle = '#2b313a'; c.fillRect(0, y + rh - 1, W, 1);
        c.globalAlpha = isLayerEffectivelyVisible(p, layer) ? 1 : 0.4;
        const sx0 = X(t.span.startFrame), sx1 = X(t.span.endFrame + 1), cy = y + rh / 2 - 0.5;
        c.fillStyle = withAlphaCss(layer.color, 0.12); c.fillRect(sx0 + 1, y + 6, sx1 - sx0 - 2, rh - 13);
        if (t.frames.length > 1) {
          c.fillStyle = 'rgba(155,123,242,.55)';
          c.fillRect(X(t.frames[0]) + ppf / 2, cy - 1.5, X(t.frames[t.frames.length - 1]) - X(t.frames[0]), 3);
        }
        for (const k of t.frames) {
          if (k < first - 1 || k > last + 1) continue;
          const kx = X(k) + ppf / 2;
          const on = selected.has(keyId({ layerId: layer.id, frame: k, kind: 'tween', objectId: t.objectId }));
          const r = on ? 5 : 4;
          c.fillStyle = on ? '#3cc8d6' : '#f2a33a';
          c.beginPath(); c.moveTo(kx, cy - r); c.lineTo(kx + r, cy); c.lineTo(kx, cy + r); c.lineTo(kx - r, cy); c.closePath(); c.fill();
          if (on) { c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke(); c.lineWidth = 1; }
        }
        c.globalAlpha = 1;
        return;
      }
      const vis = isLayerEffectivelyVisible(p, layer);
      const isActive = layer.id === s.active;
      if (isActive) { c.fillStyle = 'rgba(60,200,214,.07)'; c.fillRect(0, y, W, rh); }
      c.fillStyle = '#2b313a'; c.fillRect(0, y + rh - 1, W, 1);
      c.globalAlpha = vis ? 1 : 0.4;
      for (const e of layer.exposureTrack) {
        if (e.endFrame < first || e.startFrame > last) continue;
        const content = layer.objectTracks.find((ct) => ct.id === e.contentId);
        const filled = !!content?.objects.length;
        const x0 = X(e.startFrame), x1 = X(e.endFrame + 1);
        c.fillStyle = filled ? withAlphaCss(layer.color, 0.28) : 'rgba(167,176,188,.12)';
        c.fillRect(x0 + 1, y + 3, x1 - x0 - 2, rh - 7);
        c.strokeStyle = filled ? withAlphaCss(layer.color, 0.75) : 'rgba(167,176,188,.4)';
        c.lineWidth = 1;
        c.strokeRect(x0 + 1.5, y + 3.5, x1 - x0 - 3, rh - 8);
        // keyframe dot (filled = drawing, hollow = blank)
        const cx = x0 + Math.min(ppf, 14) / 2 + 1, cy = y + rh / 2 - 1;
        const dotR = Math.max(2, Math.min(4, ppf / 3));
        if (selected.has(keyId({ layerId: layer.id, frame: e.startFrame, kind: 'drawing' }))) {
          c.fillStyle = 'rgba(60,200,214,.35)'; c.fillRect(x0 + 1, y + 3, Math.max(ppf, 4) - 1, rh - 7);
          c.beginPath(); c.arc(cx, cy, dotR + 2, 0, Math.PI * 2); c.fillStyle = '#3cc8d6'; c.fill();
          c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke(); c.lineWidth = 1;
        } else {
          c.beginPath(); c.arc(cx, cy, dotR, 0, Math.PI * 2);
          if (filled) { c.fillStyle = '#f3f5f7'; c.fill(); } else { c.strokeStyle = '#f3f5f7'; c.stroke(); }
        }
        // tween bar + diamonds
        const keys = new Set<number>();
        for (const o of content?.objects ?? []) for (const k of o.keyframes) if (k.frame >= e.startFrame && k.frame <= e.endFrame) keys.add(k.frame);
        if (keys.size) {
          const ks = [...keys].sort((a, b) => a - b);
          if (ks.length > 1) {
            c.fillStyle = 'rgba(155,123,242,.45)';
            c.fillRect(X(ks[0]) + ppf / 2, y + rh - 9, X(ks[ks.length - 1]) - X(ks[0]), 3);
          }
          for (const k of ks) {
            const kx = X(k) + ppf / 2, ky = y + rh - 8;
            const on = selected.has(keyId({ layerId: layer.id, frame: k, kind: 'tween' }));
            const r = on ? 5 : 4;
            c.fillStyle = on ? '#3cc8d6' : '#f2a33a';
            c.beginPath(); c.moveTo(kx, ky - r); c.lineTo(kx + r, ky); c.lineTo(kx, ky + r); c.lineTo(kx - r, ky); c.closePath(); c.fill();
            if (on) { c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke(); c.lineWidth = 1; }
          }
        }
      }
      c.globalAlpha = 1;
      if (layer.locked) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, y, W, rh - 1); }
    });
    // range selection
    if (s.range) {
      for (const id of s.range.layerIds) {
        const i = rows.findIndex((r) => r.kind === 'layer' && r.layer.id === id);
        if (i < 0) continue;
        c.fillStyle = 'rgba(60,200,214,.22)';
        c.fillRect(X(s.range.start), i * rh, (s.range.end - s.range.start + 1) * ppf, rh - 1);
        c.strokeStyle = '#3cc8d6';
        c.strokeRect(X(s.range.start) + 0.5, i * rh + 0.5, (s.range.end - s.range.start + 1) * ppf - 1, rh - 2);
      }
    }
    // playhead line
    c.fillStyle = 'rgba(255,77,109,.9)';
    c.fillRect(px + ppf / 2 - 0.5, 0, 1.5, H);
  }, [p, s.frame, s.active, s.range, s.keySel, s.expanded, s.selection, ppf, scrollX, width, rh, height]);

  // ------- interaction
  const frameAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(getState().project.durationFrames - 1, Math.floor((clientX - r.left + scrollX) / ppf)));
  };
  const rowAt = (clientY: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.floor((clientY - r.top) / rh)));
  };

  const onRulerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget as HTMLCanvasElement;
    el.setPointerCapture(e.pointerId);
    stop();
    goToFrame(frameAt(e.clientX, el));
    const mv = (ev: PointerEvent) => goToFrame(frameAt(ev.clientX, el));
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };

  /** The keyframe under the pointer: a tween diamond (lower part of the cell) or a drawing key (span start). */
  const keyAt = (clientX: number, clientY: number, el: HTMLElement): KeyRef | null => {
    const f = frameAt(clientX, el), ri = rowAt(clientY, el);
    const row = rows[ri];
    if (!row) return null;
    if (row.kind === 'object') return row.track.frames.includes(f) ? { layerId: row.layer.id, frame: f, kind: 'tween', objectId: row.track.objectId } : null;
    const layer = row.layer;
    const yIn = clientY - el.getBoundingClientRect().top - ri * rh;
    const span = layer.exposureTrack.find((x) => f >= x.startFrame && f <= x.endFrame);
    if (!span) return null;
    const tween = spanTweenKeys(layer, span).includes(f);
    if (tween && (yIn >= rh * 0.55 || span.startFrame !== f)) return { layerId: layer.id, frame: f, kind: 'tween' };
    if (span.startFrame === f) return { layerId: layer.id, frame: f, kind: 'drawing' };
    return null;
  };

  /** Click selects a key (Shift / Cmd / Ctrl toggles it); dragging moves every selected key together. */
  const onKeyDown = (e: React.PointerEvent<HTMLCanvasElement>, hit: KeyRef, el: HTMLCanvasElement, secondClick = false) => {
    const st = getState();
    const id = keyId(hit);
    const has = st.keySelection.some((k) => keyId(k) === id);
    store.set({ activeLayerId: hit.layerId, frameRange: null, selection: [] });
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      store.set({ keySelection: has ? st.keySelection.filter((k) => keyId(k) !== id) : [...st.keySelection, hit] });
      return;
    }
    const sel = has ? st.keySelection : [hit];
    store.set({ keySelection: sel });
    goToFrame(hit.frame);
    const f0 = frameAt(e.clientX, el);
    const x0 = e.clientX, y0 = e.clientY;
    let applied = 0, warned = false, wandered = false;
    beginGesture();
    const base = getState().gestureBase!;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    const mv = (ev: PointerEvent) => {
      if (hold.current.fired) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) wandered = true;
      const want = frameAt(ev.clientX, el) - f0;
      const r = clampedMove(base, sel, want);
      if (r.delta !== want && !warned) { warned = true; toast('Keyframes stop at the next key, and tween keys stay inside their drawing.'); }
      if (r.delta === applied) return;
      applied = r.delta;
      updateGesture(() => r.project);
      store.set({ keySelection: sel.map((k) => ({ ...k, frame: k.frame + applied })) });
      goToFrame(hit.frame + applied);
    };
    const up = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.style.cursor = '';
      if (applied) endGesture(sel.length > 1 ? 'Move keyframes' : 'Move keyframe');
      else cancelGesture();
      // A second click on the same key, released without dragging, is a double-click: open the ease menu.
      if (secondClick && !applied && !wandered && !hold.current.fired) {
        store.set({ keySelection: [hit] });
        setMenu(null);
        setEaseMenu({ x: x0, y: y0, key: hit });
      }
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };

  const onRowsHover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons) return;
    const el = e.currentTarget as HTMLCanvasElement;
    el.style.cursor = getState().pasteArmed ? 'copy' : keyAt(e.clientX, e.clientY, el) ? 'grab' : '';
  };

  // ------- hold menu (copy / paste / delete), click-to-paste, ease

  /** What the menu acts on: the selected keyframes, the frame range, or the pressed frame on its own. */
  const menuTarget = (f: number, layerId: string, hit: KeyRef | null): MenuTarget => {
    const st = getState();
    if (hit) {
      const keys = st.keySelection.some((k) => keyId(k) === keyId(hit)) ? st.keySelection : [hit];
      store.set({ keySelection: keys, activeLayerId: layerId });
      return { kind: 'keys', keys };
    }
    const r = st.frameRange;
    if (r && r.layerIds.includes(layerId) && f >= r.start && f <= r.end) return { kind: 'frames', layerIds: r.layerIds, start: r.start, end: r.end };
    const one = { layerIds: [layerId], start: f, end: f };
    store.set({ frameRange: one, keySelection: [], activeLayerId: layerId });
    return { kind: 'frames', ...one };
  };
  const openMenu = (x: number, y: number, f: number, layerId: string, hit: KeyRef | null) => {
    setEaseMenu(null);
    setMenu({ x, y, layerId, frame: f, target: menuTarget(f, layerId, hit) });
  };
  /** Opens the menu if the pointer is held still for HOLD_MS. */
  const startHold = (e: React.PointerEvent<HTMLCanvasElement>, el: HTMLCanvasElement, f: number, layerId: string, hit: KeyRef | null) => {
    clearTimeout(hold.current.timer);
    hold.current.fired = false;
    const x0 = e.clientX, y0 = e.clientY;
    const stopHold = () => { clearTimeout(hold.current.timer); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', stopHold); };
    const mv = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) stopHold(); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', stopHold);
    hold.current.timer = window.setTimeout(() => {
      stopHold();
      hold.current.fired = true;
      cancelGesture();
      openMenu(x0, y0, f, layerId, hit);
    }, HOLD_MS);
  };

  const copyTarget = (t: MenuTarget) => {
    const p0 = getState().project;
    const clip = t.kind === 'keys' ? copyKeys(p0, t.keys) : copyFrames(p0, t.layerIds, t.start, t.end);
    if (!clip) { toast('Nothing to copy there.', 'warning'); return; }
    store.set({ timelineClip: clip, pasteArmed: true });
  };
  const deleteTarget = (t: MenuTarget) => {
    const st = getState();
    const layerIds = t.kind === 'keys' ? t.keys.map((k) => k.layerId) : t.layerIds;
    if (layerIds.some((id) => st.project.layers.find((l) => l.id === id)?.locked)) { toast('A selected layer is locked.', 'warning'); return; }
    if (t.kind === 'keys') commit(t.keys.length > 1 ? 'Delete keyframes' : 'Delete keyframe', (pr) => deleteKeys(pr, t.keys));
    else {
      const n = t.end - t.start + 1;
      commit(n > 1 ? `Delete ${n} frames` : 'Delete frame', (pr) => deleteFrameRange(pr, t.layerIds, t.start, t.end));
    }
    store.set({ keySelection: [], frameRange: null, selection: [] });
  };
  const pasteAt = (layerId: string, frame: number) => {
    const clip = getState().timelineClip;
    if (!clip) return;
    let reason = '';
    const ok = commit(clip.kind === 'tweenKeys' ? 'Paste keyframes' : 'Paste frames', (pr) => {
      const r = pasteClip(pr, clip, layerId, frame);
      if ('reason' in r) { reason = r.reason; return pr; }
      return r.project;
    });
    if (!ok) { toast(reason || 'Nothing was pasted.', 'warning'); return; }
    store.set({ pasteArmed: false, activeLayerId: layerId, frameRange: null, keySelection: [], selection: [] });
    goToFrame(frame);
  };
  const setEase = (k: KeyRef, ease: Ease) => commit('Set ease', (pr) => setKeyEase(pr, k, ease));

  const onRowsContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLCanvasElement;
    const layer = rows[rowAt(e.clientY, el)]?.layer;
    if (layer) openMenu(e.clientX, e.clientY, frameAt(e.clientX, el), layer.id, keyAt(e.clientX, e.clientY, el));
  };

  const onRowsDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget as HTMLCanvasElement;
    el.focus();
    stop();
    const f = frameAt(e.clientX, el), ri = rowAt(e.clientY, el);
    const row = rows[ri];
    const layer = row?.layer;
    if (!layer || e.button !== 0) return; // right-click opens the menu (onContextMenu)
    if (getState().pasteArmed) { pasteAt(layer.id, f); return; }
    const hit = keyAt(e.clientX, e.clientY, el);
    if (!hit && row.kind === 'object') {
      // An object's motion row: select that object and move the playhead there.
      lastKeyPress.current = null;
      store.set({ selection: [row.track.objectId], activeLayerId: layer.id, keySelection: [], frameRange: null });
      goToFrame(f);
      return;
    }
    if (hit) {
      // Double-click a keyframe: ease menu.
      // Double-click a keyframe for the ease menu (confirmed on release, so click-then-drag still drags).
      const now = performance.now(), id = keyId(hit);
      const prev = lastKeyPress.current;
      const second = !!prev && prev.id === id && now - prev.time < 400;
      lastKeyPress.current = second ? null : { id, time: now };
      anchor.current = { frame: f, layerIndex: ri };
      startHold(e, el, f, layer.id, hit);
      onKeyDown(e, hit, el, second);
      return;
    }
    lastKeyPress.current = null;
    startHold(e, el, f, layer.id, null);
    const setRange = (f2: number, r2: number) => {
      const a = anchor.current!;
      const lo = Math.min(a.layerIndex, r2), hi = Math.max(a.layerIndex, r2);
      const range = { layerIds: [...new Set(rows.slice(lo, hi + 1).map((r) => r.layer.id))], start: Math.min(a.frame, f2), end: Math.max(a.frame, f2) };
      // A frame range also selects the keyframes inside it, ready to drag.
      store.set({ frameRange: range, keySelection: keysInRange(getState().project, range.layerIds, range.start, range.end) });
    };
    if (e.shiftKey && anchor.current) {
      setRange(f, ri);
    } else {
      anchor.current = { frame: f, layerIndex: ri };
      store.set({ activeLayerId: layer.id, frameRange: null, keySelection: [], selection: [] });
    }
    goToFrame(f);
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      if (hold.current.fired) return;
      const f2 = frameAt(ev.clientX, el), r2 = rowAt(ev.clientY, el);
      if (f2 !== anchor.current?.frame || r2 !== anchor.current?.layerIndex) setRange(f2, r2);
      goToFrame(f2);
    };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };

  const onRowsKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const st = getState();
    const idx = displayLayers.findIndex((l) => l.id === st.activeLayerId);
    if (e.key === 'ArrowUp' && idx > 0) { e.preventDefault(); e.stopPropagation(); store.set({ activeLayerId: displayLayers[idx - 1].id }); }
    if (e.key === 'ArrowDown' && idx < displayLayers.length - 1) { e.preventDefault(); e.stopPropagation(); store.set({ activeLayerId: displayLayers[idx + 1].id }); }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setTimelineZoom(ppf * Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.01)); return; }
    if (hscroll.current && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) hscroll.current.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
  };

  // layer drag reorder
  const onLayerDrag = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let state: { id: string; over: string | null; pos: 'before' | 'after' } = { id, over: null, pos: 'before' };
    setDrag(state);
    const mv = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-layer-id]') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      state = { id, over: el.dataset.layerId!, pos: ev.clientY < r.top + r.height / 2 ? 'before' : 'after' };
      setDrag(state);
    };
    const up = () => {
      target.removeEventListener('pointermove', mv);
      target.removeEventListener('pointerup', up);
      setDrag(null);
      if (!state.over || state.over === id) return;
      const disp = displayLayers.filter((l) => l.id !== id);
      let di = disp.findIndex((l) => l.id === state.over);
      if (state.pos === 'after') di += 1;
      // display order is reversed relative to project order
      const toIndex = disp.length - di;
      cmdMoveLayer(id, toIndex);
    };
    target.addEventListener('pointermove', mv);
    target.addEventListener('pointerup', up);
  };

  const onResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = height;
    const mv = (ev: PointerEvent) => setHeight(Math.max(120, Math.min(window.innerHeight * 0.7, h0 - (ev.clientY - y0))));
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };

  const activeIdx = p.layers.findIndex((l) => l.id === s.active);
  return (
    <section className="timeline" style={{ height }} aria-label="Timeline">
      <div className="tl-resize" onPointerDown={onResize} role="separator" aria-orientation="horizontal" aria-label="Resize timeline" />
      <div className="tl-toolbar" role="toolbar" aria-label="Timeline controls">
        <div className="tl-group">
          <button className="icon-btn sm" aria-label={`First frame (${formatKeys(['Home'])})`} data-tip="First frame" data-tip-keys={formatKeys(['Home'])} data-tip-desc={commands['tl.first'].help} onClick={() => goToFrame(0)}><Icon name="first" size={16} /></button>
          <button className="icon-btn sm" aria-label={`Previous frame (${formatKeys([','])})`} data-tip="Previous frame" data-tip-keys="," data-tip-desc={commands['tl.prev'].help} onClick={() => goToFrame(s.frame - 1)}><Icon name="stepBack" size={16} /></button>
          <button className="icon-btn sm" aria-label={s.playing ? 'Pause (Enter)' : 'Play (Enter)'} aria-pressed={s.playing} data-tip={s.playing ? 'Pause' : 'Play'} data-tip-keys={formatKeys(['Enter'])} data-tip-desc={s.playing ? 'Stop playback on the current frame.' : 'Play the animation from the current frame.'} onClick={() => (s.playing ? stop() : play())}><Icon name={s.playing ? 'pause' : 'play'} size={16} /></button>
          <button className="icon-btn sm" aria-label={`Next frame (${formatKeys(['.'])})`} data-tip="Next frame" data-tip-keys="." data-tip-desc={commands['tl.next'].help} onClick={() => goToFrame(s.frame + 1)}><Icon name="stepFwd" size={16} /></button>
          <button className="icon-btn sm" aria-label={`Last frame (${formatKeys(['End'])})`} data-tip="Last frame" data-tip-keys={formatKeys(['End'])} data-tip-desc={commands['tl.last'].help} onClick={() => goToFrame(p.durationFrames - 1)}><Icon name="last" size={16} /></button>
          <button className="icon-btn sm" aria-label="Loop playback" aria-pressed={p.preferences.loopPlayback} data-tip="Loop playback" data-tip-desc={commands['tl.loop'].help} onClick={() => setPref({ loopPlayback: !p.preferences.loopPlayback })}><Icon name="loop" size={16} /></button>
          <button className="icon-btn sm" aria-label="Onion skin" aria-pressed={p.preferences.onionSkin} data-tip="Onion skin" data-tip-keys={formatKeys(['Alt+Shift+O'])} data-tip-desc={commands['view.onion'].help} onClick={() => setPref({ onionSkin: !p.preferences.onionSkin })}><Icon name="onion" size={16} /></button>
        </div>
        <div className="tl-group">
          <FrameField frame={s.frame} max={p.durationFrames} />
          <span className="tl-readout" aria-label="Time">{formatTime(s.frame, p.fps)}</span>
          <FpsControl />
          <DurationField />
        </div>
        <div className="tl-group">
          <button className="icon-btn sm" aria-label={`Insert frame (${formatKeys(['F5'])})`} data-tip="Insert frame" data-tip-keys="F5" data-tip-desc={commands['tl.insertFrame'].help} onClick={cmdInsertFrame}><Icon name="frameAdd" size={16} /></button>
          <button className="icon-btn sm" aria-label={`Duplicate frame (${formatKeys(['F6'])})`} data-tip="Duplicate frame" data-tip-keys="F6" data-tip-desc={commands['tl.duplicateFrame'].help} onClick={cmdDuplicateFrame}><Icon name="frameDup" size={16} /></button>
          <button className="icon-btn sm" aria-label={`Add blank frame (${formatKeys(['F7'])})`} data-tip="Add blank frame" data-tip-keys="F7" data-tip-desc={commands['tl.blankFrame'].help} onClick={cmdBlankFrame}><Icon name="frameBlank" size={16} /></button>
          <button className="icon-btn sm" aria-label={`Delete frame (${formatKeys(['Shift+F5'])})`} data-tip="Delete frames" data-tip-keys={formatKeys(['Shift+F5'])} data-tip-desc={commands['tl.deleteFrame'].help} onClick={cmdDeleteFrames}><Icon name="frameDel" size={16} /></button>
          <button className="icon-btn sm" aria-label={`Add keyframe to selection (${formatKeys(['F9'])})`} data-tip="Add keyframe" data-tip-keys="F9" data-tip-desc={commands['tl.addKey'].help} onClick={cmdAddKeyframe}><Icon name="keyframe" size={16} /></button>
          <button className="icon-btn sm" aria-label={`Create motion tween (${formatKeys(['Shift+T'])})`} data-tip="Create motion tween" data-tip-keys={formatKeys(['Shift+T'])} data-tip-desc={commands['tl.tween'].help} onClick={cmdCreateTween}><Icon name="tween" size={16} /></button>
        </div>
        <div className="tl-zoom">
          <Icon name="minus" size={14} />
          <input type="range" min={4} max={48} step={1} value={ppf} aria-label={`Timeline zoom, ${Math.round(ppf)} pixels per frame`} data-tip="Timeline zoom" data-tip-desc="Drag to make frames wider or narrower. The = and - keys do the same." onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimelineZoom(Number(e.target.value))} />
          <Icon name="plus" size={14} />
          <button className="icon-btn sm" aria-label="Fit selection in timeline (Shift+F)" data-tip="Fit timeline" data-tip-keys={formatKeys(['Shift+F'])} data-tip-desc={commands['tl.fit'].help} onClick={() => window.dispatchEvent(new Event('studio:timeline-fit'))}><Icon name="fit" size={14} /></button>
        </div>
      </div>
      <div className="tl-body" onWheel={onWheel}>
        <div className="tl-corner">
          <span style={{ flex: 1 }}>Layers</span>
        </div>
        <canvas ref={rulerRef} className="tl-ruler" onPointerDown={onRulerDown} aria-label="Frame ruler. Click or drag to move the playhead" role="slider" aria-valuemin={1} aria-valuemax={p.durationFrames} aria-valuenow={s.frame + 1} tabIndex={-1} />
        <div className="tl-layers" ref={layersRef} role="grid" aria-label="Layers" onScroll={(e: React.UIEvent<HTMLDivElement>) => { if (rowsWrap.current) rowsWrap.current.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop; }}>
          {rows.map((row) => (row.kind === 'layer' ? (
            <LayerRow key={row.layer.id} layer={row.layer} index={displayLayers.indexOf(row.layer)} total={displayLayers.length} active={row.layer.id === s.active}
              effVisible={isLayerEffectivelyVisible(p, row.layer)} onDragStart={onLayerDrag}
              dropHint={drag && drag.over === row.layer.id && drag.id !== row.layer.id ? drag.pos : null}
              tracks={objectTracks(row.layer).length} expanded={expandedSet.has(row.layer.id)} onToggle={() => toggleExpanded(row.layer.id)} />
          ) : (
            <TrackLabel key={`${row.layer.id}:${row.track.objectId}`} layer={row.layer} track={row.track} frame={s.frame} selected={s.selection.includes(row.track.objectId)} />
          )))}
        </div>
        <div className="tl-rows" ref={rowsWrap} onScroll={(e: React.UIEvent<HTMLDivElement>) => { if (layersRef.current) layersRef.current.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop; }}>
          <canvas ref={rowsRef} tabIndex={0} onPointerDown={onRowsDown} onPointerMove={onRowsHover} onKeyDown={onRowsKey} onContextMenu={onRowsContext}
            aria-label={`Frames. Frame ${s.frame + 1} of ${p.durationFrames}. Arrow keys: left and right change frame, up and down change layer. Shift-click selects a range. Click a keyframe to select it, Shift-click to add more, and drag to move them. Press and hold, or right-click, for copy, paste and delete. Double-click a keyframe to change its ease.`} />
        </div>
        <div className="tl-layer-actions">
          <button className="icon-btn sm" aria-label="Add layer" data-tip="Add layer" data-tip-desc={commands['tl.addLayer'].help} onClick={cmdAddLayer}><Icon name="plus" size={16} /></button>
          <button className="icon-btn sm" aria-label="Duplicate layer" data-tip="Duplicate layer" data-tip-desc={commands['tl.duplicateLayer'].help} onClick={() => cmdDuplicateLayer()}><Icon name="copy" size={16} /></button>
          <button className="icon-btn sm" aria-label="Move layer up" data-tip="Move layer up" data-tip-desc="Move the active layer above the one over it, so it draws on top." disabled={activeIdx >= p.layers.length - 1} onClick={() => cmdMoveLayer(s.active, activeIdx + 1)}><Icon name="up" size={16} /></button>
          <button className="icon-btn sm" aria-label="Move layer down" data-tip="Move layer down" data-tip-desc="Move the active layer below the one under it, so it draws behind." disabled={activeIdx <= 0} onClick={() => cmdMoveLayer(s.active, activeIdx - 1)}><Icon name="down" size={16} /></button>
          <button className="icon-btn sm" aria-label="Delete layer" data-tip="Delete layer" data-tip-desc={commands['tl.deleteLayer'].help} disabled={p.layers.length <= 1} onClick={() => cmdDeleteLayer()}><Icon name="trash" size={16} /></button>
        </div>
        <div className="tl-hscroll" ref={hscroll} onScroll={(e: React.UIEvent<HTMLDivElement>) => setScrollX((e.currentTarget as HTMLDivElement).scrollLeft)}>
          <div style={{ width: totalW }} />
        </div>
      </div>
      {s.pasteArmed && s.clip && (
        <div className="tl-paste-banner" role="status">
          <Icon name="copy" size={14} />
          <span>Click a frame to paste {describeClip(s.clip)} · Esc cancels</span>
          <button className="btn sm ghost" data-tip-desc="Stop pasting. The copied frames stay available from the hold menu." onClick={() => store.set({ pasteArmed: false })}>Cancel</button>
        </div>
      )}
      {menu && (
        <TimelineMenu x={menu.x} y={menu.y} label={menu.target.kind === 'keys' ? 'Keyframe actions' : 'Frame actions'} onClose={() => setMenu(null)}>
          {(() => {
            const t = menu.target;
            const what = t.kind === 'keys'
              ? (t.keys.length > 1 ? `${t.keys.length} keyframes` : 'keyframe')
              : (t.end > t.start ? `${t.end - t.start + 1} frames` : 'frame');
            const single = t.kind === 'keys' && t.keys.length === 1 ? t.keys[0] : null;
            const close = (fn: () => void) => () => { setMenu(null); fn(); };
            return (
              <>
                <button role="menuitem" onClick={close(() => copyTarget(t))} data-tip={`Copy ${what}`}
                  data-tip-desc="Copy, then click any frame in the timeline to paste there. Later frames move right to make room.">
                  <Icon name="copy" size={16} /><span>Copy {what}</span>
                </button>
                {s.clip && (
                  <button role="menuitem" onClick={close(() => pasteAt(menu.layerId, menu.frame))} data-tip={`Paste ${describeClip(s.clip)} here`}
                    data-tip-desc="Insert the copied frames at this frame. Later frames move right; nothing is overwritten.">
                    <Icon name="frameAdd" size={16} /><span>Paste {describeClip(s.clip)} here</span>
                  </button>
                )}
                {single && keyEase(p, single) !== undefined && (
                  <button role="menuitem" onClick={close(() => setEaseMenu({ x: menu.x, y: menu.y, key: single }))} data-tip="Ease…"
                    data-tip-desc="Change how the motion speeds up or slows down from this keyframe to the next.">
                    <Icon name="tween" size={16} /><span>Ease…</span>
                  </button>
                )}
                <hr />
                <button role="menuitem" className="danger" onClick={close(() => deleteTarget(t))} data-tip={`Delete ${what}`}
                  data-tip-desc={t.kind === 'keys'
                    ? 'Remove the keyframe. A drawing\u2019s frames are then held by the drawing before it; a tween key is removed from its objects.'
                    : 'Remove these frames. Later frames move left to close the gap.'}>
                  <Icon name="trash" size={16} /><span>Delete {what}</span>
                </button>
              </>
            );
          })()}
        </TimelineMenu>
      )}
      {easeMenu && (() => {
        const current = keyEase(p, easeMenu.key);
        return (
          <TimelineMenu x={easeMenu.x} y={easeMenu.y} label="Ease" onClose={() => setEaseMenu(null)}>
            <div className="tl-menu-title">Ease to the next keyframe</div>
            {current === undefined ? (
              <p className="hint tl-menu-hint">This drawing has no motion tween, so there is nothing to ease. Select an object and use Create Motion Tween first.</p>
            ) : EASES.map((x) => (
              <button key={x.id} role="menuitemradio" aria-checked={current === x.id} data-tip={x.label} data-tip-desc={x.help}
                onClick={() => { setEaseMenu(null); setEase(easeMenu.key, x.id); }}>
                <span className="check">{current === x.id ? <Icon name="check" size={16} /> : null}</span>
                <EaseCurve ease={x.id} /><span>{x.label}</span>
              </button>
            ))}
          </TimelineMenu>
        );
      })()}
    </section>
  );
}

type MenuTarget = { kind: 'keys'; keys: KeyRef[] } | { kind: 'frames'; layerIds: string[]; start: number; end: number };

const HOLD_MS = 500;

const EASES: { id: Ease; label: string; help: string }[] = [
  { id: 'linear', label: 'Linear', help: 'Constant speed from this keyframe to the next.' },
  { id: 'easeIn', label: 'Ease in', help: 'Starts slowly and speeds up toward the next keyframe.' },
  { id: 'easeOut', label: 'Ease out', help: 'Starts fast and slows down into the next keyframe.' },
  { id: 'easeInOut', label: 'Ease in-out', help: 'Starts slowly, speeds up in the middle and slows down at the end.' },
];

function describeClip(c: TimelineClip): string {
  if (c.kind === 'tweenKeys') { const n = new Set(c.keys.map((k) => k.rel)).size; return n > 1 ? `${n} keyframes` : '1 keyframe'; }
  const frames = c.length > 1 ? `${c.length} frames` : '1 frame';
  return c.layers.length > 1 ? `${frames} on ${c.layers.length} layers` : frames;
}

/** Small curve preview for an ease option. */
function EaseCurve({ ease }: { ease: Ease }) {
  const d = { linear: 'M2 14L14 2', easeIn: 'M2 14C9 14 12 8 14 2', easeOut: 'M2 14C4 8 7 2 14 2', easeInOut: 'M2 14C8 14 8 2 14 2' }[ease];
  return (
    <svg className="icon ease-curve" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

/** Small floating menu at a pointer position; closes on outside press or Escape. */
function TimelineMenu({ x, y, label, onClose, children }: { x: number; y: number; label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useDismiss(ref, onClose);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = y - r.height - 10 >= 8 ? y - r.height - 10 : Math.min(window.innerHeight - r.height - 8, y + 14);
    setPos({ left: Math.max(8, Math.min(window.innerWidth - r.width - 8, x - 12)), top });
    el.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [x, y]);
  return (
    <div ref={ref} className="tl-menu" role="menu" aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: 'hidden' }}
      onKeyDown={(e: React.KeyboardEvent) => {
        const items = Array.from(ref.current!.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      }}>
      {children}
    </div>
  );
}

function withAlphaCss(hex: string, a: number) { return cssColor(withAlpha(hex, a)); }

function FrameField({ frame, max }: { frame: number; max: number }) {
  const [v, setV] = useState(String(frame + 1));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setV(String(frame + 1)); }, [frame, focus]);
  return (
    <input className="frame-field" inputMode="numeric" aria-label={`Current frame, 1 to ${max}`} data-tip="Current frame" data-tip-desc="Type a frame number and press Enter to jump there." value={v}
      onFocus={(e: React.FocusEvent<HTMLInputElement>) => { setFocus(true); e.currentTarget.select(); }}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={() => { setFocus(false); const n = parseInt(v, 10); if (n >= 1) goToFrame(n - 1); }}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
  );
}

function DurationField() {
  const dur = useApp((s) => s.project.durationFrames);
  const [v, setV] = useState(String(dur));
  useEffect(() => setV(String(dur)), [dur]);
  const apply = () => {
    const n = parseInt(v, 10);
    if (!(n >= 1)) { setV(String(dur)); return; }
    commitMerge('Duration', (p) => {
      const minDur = Math.max(1, ...p.layers.flatMap((l) => l.exposureTrack.map((e) => e.endFrame + 1)));
      return { ...p, durationFrames: Math.max(minDur, Math.min(100000, n)) };
    });
  };
  return (
    <label className="row" style={{ gap: 4, fontSize: 12, color: 'var(--text-2)' }}>
      <span>Length</span>
      <input className="frame-field" inputMode="numeric" aria-label="Duration in frames" data-tip="Length" data-tip-desc="Total number of frames in the animation. Type a new length and press Enter." value={v}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={apply} onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
    </label>
  );
}

type TrackRow = { kind: 'layer'; layer: Layer } | { kind: 'object'; layer: Layer; track: ObjectTrack };

/** Label for an expanded layer's object row: thumbnail, name and key count; click selects the object. */
function TrackLabel({ layer, track, frame, selected }: { layer: Layer; track: ObjectTrack; frame: number; selected: boolean }) {
  const object = layer.objectTracks.find((c) => c.id === track.span.contentId)?.objects.find((o) => o.id === track.objectId);
  const at = frame >= track.span.startFrame && frame <= track.span.endFrame ? frame : track.span.startFrame;
  return (
    <div className={`track-row${selected ? ' selected' : ''}`} role="row" aria-selected={selected} style={{ height: rowHeight() }}
      aria-label={`Motion tween of ${track.name}, ${track.frames.length} keyframes, frames ${track.span.startFrame + 1} to ${track.span.endFrame + 1}`}
      onClick={() => store.set({ selection: [track.objectId], activeLayerId: layer.id })}
      data-tip={track.name}
      data-tip-desc={`Motion tween of this object (frames ${track.span.startFrame + 1}\u2013${track.span.endFrame + 1}). Its keyframes on this row can be selected, moved, copied, deleted and eased on their own.`}>
      {object && <ObjectThumb o={object} frame={at} />}
      <span className="track-name">{track.name}</span>
      <span className="track-keys">{track.frames.length}</span>
    </div>
  );
}
