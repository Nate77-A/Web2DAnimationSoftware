// Drawing panel: canvas stage, Pointer Events input coordinator, screen-space overlays and text editing.
import { useEffect, useRef } from 'react';
import { evaluateFrame } from '../domain/evaluator';
import { layoutText, fontString, segmentsToPathData } from '../domain/geometry';
import { apply, multiply, rectCorners } from '../domain/math';
import { locateObject, mapObjects, removeObjects } from '../domain/ops';
import { cssColor } from '../domain/color';
import type { Vec } from '../domain/schema';
import { getAssetImage } from '../features/assets';
import { checkerPattern, measureText, renderScene } from './renderer';
import { docToScreen, fitViewport, frameObjects, screenToDoc, selectionInfo, viewMatrix, worldCorners, zoomAt } from './scene';
import {
  activeTool, beginGesture, cancelGesture, commit, endGesture, getState, store, updateGesture, useApp,
} from './state';
import { Icon } from '../app/icons';
import { closeDeletePrompt, deletePathAnchors, pathEditTarget, visibleHandles } from './pathEditTool';
import { HANDLE_IDS, handleGeometry, isDrawingTool, tools, type PointerInfo } from './tools';

const PASTEBOARD = '#2A3038';

let spaceDown = false;
export function setSpaceDown(v: boolean) {
  spaceDown = v;
  const s = getState();
  if (v && !s.transientTool) store.set({ transientTool: 'hand' });
  if (!v && s.transientTool === 'hand') store.set({ transientTool: null });
}

export function fitToStage() {
  const s = getState();
  store.set({ viewport: fitViewport(s.stageSize, s.project) });
}

export function setZoom(z: number, anchor?: Vec) {
  const s = getState();
  store.set({ viewport: zoomAt(s.viewport, z, anchor ?? [s.stageSize.width / 2, s.stageSize.height / 2]) });
}

function drawStage(canvas: HTMLCanvasElement) {
  const s = getState();
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PASTEBOARD;
  ctx.fillRect(0, 0, W, H);
  const v = s.viewport;
  const p = s.project;
  const [ax, ay] = docToScreen(v, [0, 0]);
  const aw = p.width * v.zoom, ah = p.height * v.zoom;
  // artboard shadow + transparency checkerboard (screen space)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(ax + 2, ay + 4, aw, ah);
  ctx.fillStyle = checkerPattern(ctx) ?? '#fff';
  ctx.fillRect(ax, ay, aw, ah);
  const m = multiply([dpr, 0, 0, dpr, 0, 0], viewMatrix(v));
  if (p.background) {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.fillStyle = cssColor(p.background);
    ctx.fillRect(0, 0, p.width, p.height);
  }
  // onion skin
  if (p.preferences.onionSkin && !s.playing) {
    for (let k = p.preferences.onionBefore; k >= 1; k--) {
      const f = s.currentFrame - k;
      if (f < 0) continue;
      renderScene(ctx, evaluateFrame(p, f), { matrix: m, getImage: getAssetImage, drawBackground: false, alpha: 0.28 / k, tint: '#E2556Eff' });
    }
    for (let k = 1; k <= p.preferences.onionAfter; k++) {
      const f = s.currentFrame + k;
      if (f >= p.durationFrames) continue;
      renderScene(ctx, evaluateFrame(p, f), { matrix: m, getImage: getAssetImage, drawBackground: false, alpha: 0.28 / k, tint: '#3FB97Aff' });
    }
  }
  const skip = s.editingTextId ? new Set([s.editingTextId]) : undefined;
  renderScene(ctx, evaluateFrame(p, s.currentFrame, { skipObjectIds: skip }), { matrix: m, getImage: getAssetImage, drawBackground: false, placeholders: true, guides: true });

  // guides and debug markers are view decorations, never part of document output
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = 'rgba(59,68,80,1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(ax) - 0.5, Math.round(ay) - 0.5, Math.round(aw) + 1, Math.round(ah) + 1);
  if (s.showGuides) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(60,200,214,0.8)';
    ctx.beginPath();
    ctx.moveTo(ax + aw / 2, ay); ctx.lineTo(ax + aw / 2, ay + ah);
    ctx.moveTo(ax, ay + ah / 2); ctx.lineTo(ax + aw, ay + ah / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(242,163,58,0.7)';
    ctx.strokeRect(ax + aw * 0.05, ay + ah * 0.05, aw * 0.9, ah * 0.9);
    ctx.restore();
  }
  if (s.debugMarkers) {
    ctx.font = '11px ui-monospace, monospace';
    for (const mk of s.markers) {
      const [x, y] = docToScreen(v, mk);
      ctx.strokeStyle = '#FF3B6B';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
      ctx.fillStyle = '#FF3B6B';
      ctx.fillText(`${mk[0].toFixed(1)}, ${mk[1].toFixed(1)}`, x + 8, y - 6);
    }
  }
}

export function Stage() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tool = useApp((s) => activeTool(s));
  const peHover = useApp((s) => (s.pathEdit ? s.pathEdit.hover ?? 'idle' : null));
  const panning = useRef(false);

  // size + initial fit
  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!;
    let fitted = false;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      store.set({ stageSize: { width: r.width, height: r.height } });
      if (!fitted && r.width > 50) { fitted = true; fitToStage(); }
      drawStage(canvas);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // redraw on relevant state changes (batched per animation frame)
  useEffect(() => {
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawStage(canvasRef.current!); }); };
    const unsub = store.subscribe((s, prev) => {
      if (s.project !== prev.project || s.viewport !== prev.viewport || s.currentFrame !== prev.currentFrame || s.assetsVersion !== prev.assetsVersion
        || s.showGuides !== prev.showGuides || s.markers !== prev.markers || s.debugMarkers !== prev.debugMarkers || s.editingTextId !== prev.editingTextId
        || s.stageSize !== prev.stageSize || s.playing !== prev.playing) schedule();
    });
    schedule();
    return () => { unsub(); cancelAnimationFrame(raf); };
  }, []);

  // input coordinator
  useEffect(() => {
    const wrap = wrapRef.current!;
    let toolPointer: number | null = null;
    const pans = new Map<number, Vec>(); // pointers panning/pinching (finger, middle button, space, hand)
    let pinch: { dist: number; center: Vec } | null = null;
    let clickCount = 0, lastClick = 0, lastClickPos: Vec = [0, 0];

    const local = (e: PointerEvent): Vec => {
      const r = wrap.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const info = (e: PointerEvent, handle: string | null = null): PointerInfo => {
      const s = getState();
      const screen = local(e);
      const r = wrap.getBoundingClientRect();
      const co = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      return {
        doc: screenToDoc(s.viewport, screen), screen,
        pressure: e.pressure, tiltX: e.tiltX || 0, tiltY: e.tiltY || 0, pointerType: e.pointerType,
        shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey, time: e.timeStamp, clickCount, handle,
        coalesced: co.map((c) => ({ doc: screenToDoc(s.viewport, [c.clientX - r.left, c.clientY - r.top]), pressure: c.pressure, tiltX: c.tiltX || 0, tiltY: c.tiltY || 0, time: c.timeStamp })),
      };
    };
    const startPinch = () => {
      const pts = [...pans.values()];
      if (pts.length >= 2) pinch = { dist: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]), center: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] };
    };

    const down = (e: PointerEvent) => {
      if (e.button === 2) return;
      const target = e.target as Element;
      if (target.closest('.text-editor, .pe-delete-pop')) return;
      wrap.focus({ preventScroll: true });
      const s = getState();
      const t = activeTool(s);
      const pos = local(e);
      const now = performance.now();
      clickCount = now - lastClick < 400 && Math.hypot(pos[0] - lastClickPos[0], pos[1] - lastClickPos[1]) < 6 ? clickCount + 1 : 1;
      lastClick = now; lastClickPos = pos;
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
      const fingerPans = e.pointerType === 'touch' && (isDrawingTool(t) || toolPointer !== null);
      if (e.button === 1 || spaceDown || t === 'hand' || fingerPans) {
        pans.set(e.pointerId, pos);
        panning.current = true;
        wrap.classList.add('is-panning');
        if (pans.size === 2) startPinch();
        return;
      }
      if (e.pointerType === 'touch' && pans.size > 0) { pans.set(e.pointerId, pos); startPinch(); return; }
      if (toolPointer !== null) {
        // second touch while a finger is using a non-drawing tool: convert to pinch
        if (e.pointerType === 'touch') {
          tools[t].cancel();
          pans.set(toolPointer, pos);
          pans.set(e.pointerId, pos);
          toolPointer = null;
          startPinch();
        }
        return;
      }
      if (s.debugMarkers) store.set((st) => ({ markers: [...st.markers.slice(-19), screenToDoc(st.viewport, pos)] }));
      toolPointer = e.pointerId;
      const h = (target.closest('[data-handle]') as HTMLElement | null)?.dataset.handle ?? null;
      tools[t].down(info(e, h));
    };

    const move = (e: PointerEvent) => {
      const pos = local(e);
      if (pans.has(e.pointerId)) {
        const prev = pans.get(e.pointerId)!;
        pans.set(e.pointerId, pos);
        if (pans.size >= 2 && pinch) {
          const pts = [...pans.values()];
          const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
          const c: Vec = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
          const s = getState();
          let v = zoomAt(s.viewport, s.viewport.zoom * (d / (pinch.dist || d)), c);
          v = { ...v, panX: v.panX + c[0] - pinch.center[0], panY: v.panY + c[1] - pinch.center[1] };
          pinch = { dist: d, center: c };
          store.set({ viewport: v });
        } else if (pans.size === 1) {
          const dx = pos[0] - prev[0], dy = pos[1] - prev[1];
          store.set((s) => ({ viewport: { ...s.viewport, panX: s.viewport.panX + dx, panY: s.viewport.panY + dy } }));
        }
        return;
      }
      const t = activeTool();
      if (toolPointer === e.pointerId) tools[t].move(info(e));
      else if (toolPointer === null && e.pointerType !== 'touch') tools[t].hover?.(info(e));
    };

    const up = (e: PointerEvent) => {
      if (pans.delete(e.pointerId)) {
        if (pans.size < 2) pinch = null;
        if (!pans.size) { panning.current = false; wrap.classList.remove('is-panning'); }
        return;
      }
      if (toolPointer === e.pointerId) {
        toolPointer = null;
        if (e.type === 'pointercancel') tools[activeTool()].cancel();
        else tools[activeTool()].up(info(e));
      }
    };
    const leave = () => { if (toolPointer === null) tools[activeTool()].leave?.(); };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = getState();
      const r = wrap.getBoundingClientRect();
      const anchor: Vec = [e.clientX - r.left, e.clientY - r.top];
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const dy = Math.max(-60, Math.min(60, e.deltaY * unit));
        store.set({ viewport: zoomAt(s.viewport, s.viewport.zoom * Math.exp(-dy * 0.01), anchor) });
      } else {
        const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit, dy = (e.shiftKey ? 0 : e.deltaY) * unit;
        store.set({ viewport: { ...s.viewport, panX: s.viewport.panX - dx, panY: s.viewport.panY - dy } });
      }
    };
    const prevent = (e: Event) => e.preventDefault();

    wrap.addEventListener('pointerdown', down);
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('pointerleave', leave);
    wrap.addEventListener('wheel', wheel, { passive: false });
    wrap.addEventListener('contextmenu', prevent);
    wrap.addEventListener('gesturestart', prevent as EventListener);
    wrap.addEventListener('gesturechange', prevent as EventListener);
    return () => {
      wrap.removeEventListener('pointerdown', down);
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('pointerup', up);
      wrap.removeEventListener('pointercancel', up);
      wrap.removeEventListener('pointerleave', leave);
      wrap.removeEventListener('wheel', wheel);
      wrap.removeEventListener('contextmenu', prevent);
      wrap.removeEventListener('gesturestart', prevent as EventListener);
      wrap.removeEventListener('gesturechange', prevent as EventListener);
    };
  }, []);

  // drag & drop images onto the stage
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) window.dispatchEvent(new CustomEvent('studio:import-files', { detail: files }));
  };

  return (
    <div
      ref={wrapRef}
      className={`stage tool-${tool}${peHover ? ` path-editing pe-over-${peHover}` : ''}`}
      tabIndex={0}
      role="application"
      aria-label="Drawing stage. Use the active tool to draw; Space or two fingers to pan; Ctrl or Command plus wheel to zoom."
      onDragOver={(e: React.DragEvent<HTMLDivElement>) => e.preventDefault()}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} className="stage-canvas" />
      <Overlay />
      <AnchorDeletePrompt />
      <TextEditor />
    </div>
  );
}

// ------------------------------------------------------------------ overlay (screen space)

function Overlay() {
  const s = useApp((st) => ({
    selection: st.selection, project: st.project, viewport: st.viewport, frame: st.currentFrame, overlay: st.overlay,
    tool: activeTool(st), editing: st.editingTextId, penHandles: st.toolOptions.pen.showHandles, size: st.stageSize, playing: st.playing,
    pathEdit: st.pathEdit, showLinks: st.panels.links,
  }));
  const v = s.viewport;
  const toS = (p: Vec) => docToScreen(v, p);
  const pts = (arr: Vec[]) => arr.map((p) => toS(p).map((n) => n.toFixed(1)).join(',')).join(' ');
  const info = s.playing ? null : selectionInfo(getState());
  const pe = s.playing ? null : s.pathEdit;
  const showHandles = s.tool === 'transform' && info && !s.editing && !pe;
  const o = s.overlay;

  return (
    <svg className="overlay" width={s.size.width} height={s.size.height} aria-hidden="true">
      {info && info.objects.filter((eo) => eo.source.id !== pe?.id).map((eo) => (
        <polygon key={eo.source.id} points={pts(worldCorners(eo))} className="sel-object" />
      ))}
      {info && !info.single && (
        <polygon points={pts(rectCorners(info.bounds))} className="sel-bounds" />
      )}
      {showHandles && info && (() => {
        const g = handleGeometry(info);
        const rot = toS(g.points.rot), top = toS(g.points.n);
        const pivot = info.single ? toS([info.single.transform.x, info.single.transform.y]) : toS(g.center);
        return (
          <g>
            <polygon points={pts(g.corners)} className="sel-frame" />
            <line x1={top[0]} y1={top[1]} x2={rot[0]} y2={rot[1]} className="sel-frame" />
            <circle cx={pivot[0]} cy={pivot[1]} r={4} className="sel-pivot" />
            {HANDLE_IDS.map((h) => {
              const p = toS(g.points[h]);
              return <rect key={h} data-handle={h} x={p[0] - 5} y={p[1] - 5} width={10} height={10} className={`handle handle-${h}`} />;
            })}
            <circle data-handle="rot" cx={rot[0]} cy={rot[1]} r={6} className="handle handle-rot" />
          </g>
        );
      })()}
      {o.marquee && (() => { const a = toS([o.marquee.x, o.marquee.y]); return <rect x={a[0]} y={a[1]} width={o.marquee.width * v.zoom} height={o.marquee.height * v.zoom} className="marquee" />; })()}
      {o.zoomBox && (() => { const a = toS([o.zoomBox.x, o.zoomBox.y]); return <rect x={a[0]} y={a[1]} width={o.zoomBox.width * v.zoom} height={o.zoomBox.height * v.zoom} className="marquee" />; })()}
      {o.pen && <PenPreview pen={o.pen} toS={toS} showHandles={s.penHandles} />}
      {pe && <PathEditOverlay pe={pe} toS={toS} />}
      {s.showLinks && !s.playing && <LinkLines toS={toS} />}
      {o.eraser && s.tool === 'eraser' && (() => { const c = toS(o.eraser.pos); return <circle cx={c[0]} cy={c[1]} r={o.eraser.r * v.zoom} className="tool-cursor" />; })()}
      {o.brushCursor && (s.tool === 'brush' || s.tool === 'paint') && (() => { const c = toS(o.brushCursor.pos); return <circle cx={c[0]} cy={c[1]} r={Math.max(1.5, o.brushCursor.r * v.zoom)} className="tool-cursor" />; })()}
    </svg>
  );
}

function PenPreview({ pen, toS, showHandles }: { pen: NonNullable<ReturnType<typeof getState>['overlay']['pen']>; toS: (p: Vec) => Vec; showHandles: boolean }) {
  const screenSegs = pen.segments.map((sg) => {
    const p = toS(sg.p);
    const ho = toS([sg.p[0] + sg.ho[0], sg.p[1] + sg.ho[1]]);
    const hi = toS([sg.p[0] + sg.hi[0], sg.p[1] + sg.hi[1]]);
    return { p, hi: [hi[0] - p[0], hi[1] - p[1]] as Vec, ho: [ho[0] - p[0], ho[1] - p[1]] as Vec };
  });
  const d = segmentsToPathData(screenSegs, false);
  const last = screenSegs[screenSegs.length - 1];
  const hover = pen.hover && !pen.dragging ? toS(pen.hover) : null;
  return (
    <g>
      <path d={d} className="pen-path" />
      {hover && last && <line x1={last.p[0]} y1={last.p[1]} x2={hover[0]} y2={hover[1]} className="pen-rubber" />}
      {screenSegs.map((sg, i) => (
        <g key={i}>
          {showHandles && (sg.ho[0] || sg.ho[1]) ? (
            <>
              <line x1={sg.p[0] + sg.hi[0]} y1={sg.p[1] + sg.hi[1]} x2={sg.p[0] + sg.ho[0]} y2={sg.p[1] + sg.ho[1]} className="pen-handle-line" />
              <circle cx={sg.p[0] + sg.ho[0]} cy={sg.p[1] + sg.ho[1]} r={3.5} className="pen-handle" />
              <circle cx={sg.p[0] + sg.hi[0]} cy={sg.p[1] + sg.hi[1]} r={3.5} className="pen-handle" />
            </>
          ) : null}
          <rect x={sg.p[0] - 4} y={sg.p[1] - 4} width={8} height={8} className={i === 0 ? 'pen-anchor first' : 'pen-anchor'} />
        </g>
      ))}
    </g>
  );
}

function PathEditOverlay({ pe, toS }: { pe: NonNullable<ReturnType<typeof getState>['pathEdit']>; toS: (p: Vec) => Vec }) {
  const t = pathEditTarget(getState());
  if (!t) return null;
  const segs = t.path.segments;
  const screen = (p: Vec) => toS(apply(t.matrix, p));
  const screenSegs = segs.map((sg) => {
    const p = screen(sg.p);
    const hi = screen([sg.p[0] + sg.hi[0], sg.p[1] + sg.hi[1]]), ho = screen([sg.p[0] + sg.ho[0], sg.p[1] + sg.ho[1]]);
    return { p, hi: [hi[0] - p[0], hi[1] - p[1]] as Vec, ho: [ho[0] - p[0], ho[1] - p[1]] as Vec };
  });
  const handles = visibleHandles(t.path, pe);
  const selected = new Set(pe.selected);
  return (
    <g>
      <path d={segmentsToPathData(screenSegs, t.path.closed)} className="pe-path" />
      {pe.curve !== null && pe.curve < segs.length && (() => {
        const a = screenSegs[pe.curve], b = screenSegs[(pe.curve + 1) % segs.length];
        return <path d={segmentsToPathData([{ ...a, hi: [0, 0] }, { ...b, ho: [0, 0] }], false)} className="pe-curve-active" />;
      })()}
      {handles.map(({ index, which }) => {
        const sg = screenSegs[index];
        const h: Vec = [sg.p[0] + sg[which][0], sg.p[1] + sg[which][1]];
        return (
          <g key={`${index}${which}`}>
            <line x1={sg.p[0]} y1={sg.p[1]} x2={h[0]} y2={h[1]} className="pe-handle-line" />
            <circle cx={h[0]} cy={h[1]} r={3} className="pe-handle" />
          </g>
        );
      })}
      {screenSegs.map((sg, i) => {
        const smooth = Math.hypot(...segs[i].hi) > 1e-6 || Math.hypot(...segs[i].ho) > 1e-6;
        const cls = `pe-anchor${selected.has(i) ? ' selected' : ''}`;
        return smooth
          ? <circle key={i} cx={sg.p[0]} cy={sg.p[1]} r={5} className={cls} />
          : <rect key={i} x={sg.p[0] - 4.5} y={sg.p[1] - 4.5} width={9} height={9} className={cls} />;
      })}
      {pe.hold !== null && pe.hold < segs.length && (() => {
        const c = screenSegs[pe.hold].p;
        return <circle cx={c[0]} cy={c[1]} r={11} className="pe-hold" pathLength={100} />;
      })()}
    </g>
  );
}

/** While the Linked Objects window is open: a dashed line from each linked child to its parent. */
function LinkLines({ toS }: { toS: (p: Vec) => Vec }) {
  const st = getState();
  const objs = frameObjects(st, {});
  const byId = new Map(objs.map((eo) => [eo.source.id, eo]));
  const pivot = (eo: (typeof objs)[number]) => toS(apply(eo.matrix, [eo.source.transform.pivotX, eo.source.transform.pivotY]));
  return (
    <g>
      {objs.filter((eo) => eo.source.link && byId.has(eo.source.link.parentId)).map((eo) => {
        const a = pivot(byId.get(eo.source.link!.parentId)!), b = pivot(eo);
        return (
          <g key={eo.source.id}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="link-line" />
            <circle cx={a[0]} cy={a[1]} r={4} className="link-parent" />
            <circle cx={b[0]} cy={b[1]} r={3} className="link-child" />
          </g>
        );
      })}
    </g>
  );
}

/** X button shown beside an anchor after double-clicking it in path edit mode. */
function AnchorDeletePrompt() {
  const s = useApp((st) => ({ pe: st.pathEdit, project: st.project, viewport: st.viewport, frame: st.currentFrame }));
  const ref = useRef<HTMLDivElement | null>(null);
  const index = s.pe?.deletePrompt ?? null;
  useEffect(() => {
    if (index === null) return;
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
    // Presses on the stage are handled by edit mode (they only hide the button); elsewhere, hide it here.
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.('.stage')) closeDeletePrompt();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [index]);
  const t = index !== null ? pathEditTarget(getState()) : null;
  if (index === null || !t || index >= t.path.segments.length) return null;
  const [x, y] = docToScreen(s.viewport, apply(t.matrix, t.path.segments[index].p));
  const canDelete = t.path.segments.length > 2;
  return (
    <div ref={ref} className="pe-delete-pop" style={{ left: x + 12, top: y - 34 }}>
      <button
        className="icon-btn sm danger"
        aria-label="Delete anchor point"
        data-tip="Delete anchor point"
        data-tip-desc={canDelete ? 'Remove this point. Click anywhere else to keep it.' : 'A path needs at least two points, so this one cannot be removed.'}
        disabled={!canDelete}
        onClick={() => { deletePathAnchors([index]); document.querySelector<HTMLElement>('.stage')?.focus({ preventScroll: true }); }}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ in-place text editor

function TextEditor() {
  const s = useApp((st) => ({ id: st.editingTextId, project: st.project, viewport: st.viewport, frame: st.currentFrame }));
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const done = useRef(false);
  const loc = s.id ? locateObject(s.project, s.id) : null;

  useEffect(() => {
    if (!s.id) return;
    done.current = false;
    beginGesture();
    const el = ref.current;
    if (el) { el.focus(); el.select(); }
  }, [s.id]);

  if (!s.id || !loc || loc.object.kind !== 'text') return null;
  const o = loc.object;
  const id = s.id;
  const eo = evaluateFrame(s.project, s.frame, { layerIds: [loc.layer.id], includeHidden: true }).layers[0]?.objects.find((x) => x.source.id === id);
  const m = multiply(viewMatrix(s.viewport), eo ? eo.matrix : [1, 0, 0, 1, 0, 0]);
  const layout = layoutText(o.text, measureText);

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const st = getState();
    const base = st.gestureBase;
    const isNew = base ? !locateObject(base, id) : false;
    const content = ref.current?.value ?? '';
    store.set({ editingTextId: null });
    if (!keep) { cancelGesture(); return; }
    if (!content.trim()) {
      cancelGesture();
      if (!isNew) commit('Delete text', (p) => removeObjects(p, [id]));
      return;
    }
    endGesture(isNew ? 'Add text' : 'Edit text', [id]);
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Edit text. Press Escape to cancel, Ctrl or Command plus Enter to commit."
      defaultValue={o.text.content}
      spellCheck={false}
      style={{
        transform: `matrix(${m.join(',')})`,
        font: fontString(o.text),
        lineHeight: `${layout.lineHeightPx}px`,
        letterSpacing: `${o.text.letterSpacing}px`,
        textAlign: o.text.align,
        width: `${Math.max(layout.width + o.text.fontSize * 0.6, o.text.fontSize * 2)}px`,
        height: `${layout.height + o.text.fontSize * 0.4}px`,
        color: o.style.fill.type === 'solid' ? cssColor(o.style.fill.color) : o.style.fill.type === 'none' ? '#3CC8D6' : cssColor(o.style.fill.stops[0].color),
        whiteSpace: o.text.width > 0 ? 'pre-wrap' : 'pre',
      }}
      onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
        const value = e.currentTarget.value;
        // New text was added inside the same gesture, so edit the live project rather than the gesture base.
        updateGesture((base) => mapObjects(locateObject(base, id) ? base : getState().project, [id],
          (x) => (x.kind === 'text' ? { ...x, text: { ...x.text, content: value } } : x)));
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
      }}
      onBlur={() => finish(true)}
    />
  );
}
