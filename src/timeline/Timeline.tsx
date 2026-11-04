// Timeline: layer rows with visibility/lock/solo, frame grid (canvas), playhead, frame rate and zoom controls.
import { useEffect, useRef, useState } from 'react';
import { cssColor, withAlpha } from '../domain/color';
import { isLayerEffectivelyVisible } from '../domain/evaluator';
import type { Layer } from '../domain/schema';
import {
  cmdAddLayer, cmdBlankFrame, cmdCreateTween, cmdDeleteFrames, cmdDeleteLayer, cmdDuplicateFrame, cmdDuplicateLayer, cmdInsertFrame,
  cmdMoveLayer, cmdUpdateLayer, goToFrame, toggleSolo, cmdAddKeyframe,
} from '../editor/actions';
import { commit, commitMerge, getState, store, useApp } from '../editor/state';
import { commands, formatKeys, FPS_HELP, setPref, setTimelineZoom } from '../app/commands';
import { useDismiss, usePopoverPosition } from '../app/controls';
import { Icon } from '../app/icons';
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

function LayerRow({ layer, index, total, active, effVisible, onDragStart, dropHint }: {
  layer: Layer; index: number; total: number; active: boolean; effVisible: boolean; onDragStart: (e: React.PointerEvent, id: string) => void; dropHint: 'before' | 'after' | null;
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

  const p = s.project;
  const ppf = s.zoom;
  const rh = rowHeight();
  const displayLayers = [...p.layers].reverse(); // top layer first
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
    const ruler = rulerRef.current, rows = rowsRef.current;
    if (!ruler || !rows) return;
    const W = width;
    const H = Math.max(displayLayers.length * rh, rowsWrap.current?.clientHeight ?? 0);
    for (const [c, h] of [[ruler, 26], [rows, H]] as const) {
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
    const c = rows.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#20252d'; c.fillRect(0, 0, W, H);
    for (let f = first; f <= last; f++) {
      if ((f + 1) % 5 === 0) { c.fillStyle = 'rgba(255,255,255,.025)'; c.fillRect(X(f), 0, ppf, H); }
      if (ppf >= 8) { c.fillStyle = '#272d36'; c.fillRect(X(f), 0, 1, H); }
    }
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(X(p.durationFrames), 0, W, H);
    displayLayers.forEach((layer, i) => {
      const y = i * rh;
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
        c.beginPath(); c.arc(cx, cy, Math.max(2, Math.min(4, ppf / 3)), 0, Math.PI * 2);
        if (filled) { c.fillStyle = '#f3f5f7'; c.fill(); } else { c.strokeStyle = '#f3f5f7'; c.stroke(); }
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
            c.fillStyle = '#f2a33a';
            c.beginPath(); c.moveTo(kx, ky - 4); c.lineTo(kx + 4, ky); c.lineTo(kx, ky + 4); c.lineTo(kx - 4, ky); c.closePath(); c.fill();
          }
        }
      }
      c.globalAlpha = 1;
      if (layer.locked) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, y, W, rh - 1); }
    });
    // range selection
    if (s.range) {
      for (const id of s.range.layerIds) {
        const i = displayLayers.findIndex((l) => l.id === id);
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
  }, [p, s.frame, s.active, s.range, ppf, scrollX, width, rh, height]);

  // ------- interaction
  const frameAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(getState().project.durationFrames - 1, Math.floor((clientX - r.left + scrollX) / ppf)));
  };
  const rowAt = (clientY: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(displayLayers.length - 1, Math.floor((clientY - r.top) / rh)));
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

  const onRowsDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget as HTMLCanvasElement;
    el.focus();
    stop();
    const f = frameAt(e.clientX, el), ri = rowAt(e.clientY, el);
    const layer = displayLayers[ri];
    if (!layer) return;
    const setRange = (f2: number, r2: number) => {
      const a = anchor.current!;
      const lo = Math.min(a.layerIndex, r2), hi = Math.max(a.layerIndex, r2);
      store.set({ frameRange: { layerIds: displayLayers.slice(lo, hi + 1).map((l) => l.id), start: Math.min(a.frame, f2), end: Math.max(a.frame, f2) } });
    };
    if (e.shiftKey && anchor.current) {
      setRange(f, ri);
    } else {
      anchor.current = { frame: f, layerIndex: ri };
      store.set({ activeLayerId: layer.id, frameRange: null, selection: [] });
    }
    goToFrame(f);
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
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
          {displayLayers.map((l, i) => (
            <LayerRow key={l.id} layer={l} index={i} total={displayLayers.length} active={l.id === s.active} effVisible={isLayerEffectivelyVisible(p, l)}
              onDragStart={onLayerDrag} dropHint={drag && drag.over === l.id && drag.id !== l.id ? drag.pos : null} />
          ))}
        </div>
        <div className="tl-rows" ref={rowsWrap} onScroll={(e: React.UIEvent<HTMLDivElement>) => { if (layersRef.current) layersRef.current.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop; }}>
          <canvas ref={rowsRef} tabIndex={0} onPointerDown={onRowsDown} onKeyDown={onRowsKey}
            aria-label={`Frames. Frame ${s.frame + 1} of ${p.durationFrames}. Arrow keys: left and right change frame, up and down change layer. Shift-click selects a range.`} />
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
    </section>
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
