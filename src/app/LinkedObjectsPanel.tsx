// Floating "Linked Objects" window (Window › Linked Objects): every object on the current frame, grouped by layer,
// with linked children nested under their parents. Drag an object onto another to make it follow that object;
// drag it onto a layer name (or use its unlink button) to release it where it is.
import { useEffect, useRef, useState } from 'react';
import { contentAt, sampleObject } from '../domain/evaluator';
import { isDescendant, linkObject, objectAt, unlinkObject, worldMatrix } from '../domain/links';
import { IDENTITY, transformRect } from '../domain/math';
import { cachedLocalBounds, drawObject } from '../editor/renderer';
import { getAssetImage } from '../features/assets';
import type { Layer, SceneObject } from '../domain/schema';
import { commit, getState, store, toast, useApp } from '../editor/state';
import { Icon } from './icons';

interface Node { o: SceneObject; layer: Layer; children: Node[] }

const KIND_LABEL: Record<SceneObject['kind'], string> = { path: 'Path', shape: 'Shape', text: 'Text', bitmap: 'Image', group: 'Group' };
const kindOf = (o: SceneObject) => (o.kind === 'path' && o.brush ? 'Brush stroke' : o.kind === 'path' && o.metadata.paintBrush ? 'Paint' : KIND_LABEL[o.kind]);
const THUMB = 24;

/** Small picture of one object as it appears on this frame (linked parents included), fitted to the box. */
function ObjectThumb({ o, frame }: { o: SceneObject; frame: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const project = useApp((st) => st.project);
  const assetsVersion = useApp((st) => st.assetsVersion);
  const matrix = worldMatrix(project, o, frame);
  const key = matrix.map((n) => n.toFixed(3)).join(',');
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = Math.round(THUMB * dpr);
    const ctx = c.getContext('2d')!;
    const b = transformRect(matrix, cachedLocalBounds(o));
    const stroke = (o.kind === 'path' || o.kind === 'shape' || o.kind === 'text') && o.style.stroke.type !== 'none' ? o.style.strokeWidth : 0;
    const pad = (stroke * Math.hypot(matrix[0], matrix[1])) / 2;
    const w = Math.max(1, b.width + pad * 2), h = Math.max(1, b.height + pad * 2);
    const k = (THUMB - 4) / Math.max(w, h);
    const tx = (THUMB - w * k) / 2 - (b.x - pad) * k, ty = (THUMB - h * k) / 2 - (b.y - pad) * k;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
    // Faint or hidden objects are drawn at least partly visible so the thumbnail still identifies them.
    const { transform, opacity } = sampleObject(o, frame);
    drawObject(ctx, { source: o, layerId: '', transform, opacity: Math.max(0.35, o.visible ? opacity : 0.35), matrix },
      { matrix: IDENTITY, getImage: getAssetImage, drawBackground: false, placeholders: true });
  }, [o, key, frame, assetsVersion]); // `matrix` is captured by value through `key`
  return <canvas ref={ref} className="lo-thumb" style={{ width: THUMB, height: THUMB }} aria-hidden="true" />;
}
const POS_KEY = 'studio.linkedPanelPos';

/** Per layer (top first): the objects on `frame` that aren't nested under a parent, front-most first. */
function buildTree(frame: number): { layer: Layer; roots: Node[] }[] {
  const p = getState().project;
  const layers = [...p.layers].reverse();
  const nodes = new Map<string, Node>();
  for (const layer of layers) for (const o of [...(contentAt(layer, frame)?.objects ?? [])].reverse()) nodes.set(o.id, { o, layer, children: [] });
  const nested = new Set<string>();
  for (const n of nodes.values()) {
    const parent = n.o.link && nodes.get(n.o.link.parentId);
    if (parent && !isDescendant(p, n.o.link!.parentId, n.o.id, frame)) { parent.children.push(n); nested.add(n.o.id); }
  }
  return layers.map((layer) => ({ layer, roots: [...nodes.values()].filter((n) => n.layer === layer && !nested.has(n.o.id)) }));
}

function readPos(): { x: number; y: number } | null {
  try { const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null'); return v && typeof v.x === 'number' ? v : null; } catch { return null; }
}

export function LinkedObjectsPanel() {
  const s = useApp((st) => ({ project: st.project, frame: st.currentFrame, selection: st.selection }));
  const [pos, setPos] = useState<{ x: number; y: number }>(() => readPos() ?? { x: Math.max(16, window.innerWidth - 300 - 330), y: 96 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null; valid: boolean } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  void s.project;
  const tree = buildTree(s.frame);
  const empty = tree.every((t) => !t.roots.length);
  const selected = new Set(s.selection);

  // Keep the window on screen when the browser is resized.
  useEffect(() => {
    const fit = () => setPos((p) => ({ x: Math.max(0, Math.min(window.innerWidth - 120, p.x)), y: Math.max(0, Math.min(window.innerHeight - 60, p.y)) }));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const close = () => store.set((st) => ({ panels: { ...st.panels, links: false } }));

  const onHeaderDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return;
    const el = e.currentTarget as HTMLDivElement;
    el.setPointerCapture(e.pointerId);
    const dx = e.clientX - pos.x, dy = e.clientY - pos.y;
    let last = pos;
    const mv = (ev: PointerEvent) => {
      last = { x: Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - dx)), y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)) };
      setPos(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      try { localStorage.setItem(POS_KEY, JSON.stringify(last)); } catch { /* position just isn't remembered */ }
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };

  const select = (n: Node, add: boolean) => {
    const sel = getState().selection;
    store.set({ selection: add ? (sel.includes(n.o.id) ? sel.filter((x) => x !== n.o.id) : [...sel, n.o.id]) : [n.o.id], activeLayerId: n.layer.id });
  };

  const link = (childId: string, parentId: string) => {
    const st = getState();
    const name = objectAt(st.project, parentId, st.currentFrame)?.object.name ?? 'object';
    const ok = commit(`Link to ${name}`, (p) => linkObject(p, childId, parentId, st.currentFrame) ?? p, [childId]);
    if (ok) store.set({ selection: [childId] });
    else toast('An object can’t follow itself or one of its own children.', 'warning');
  };
  const unlink = (childId: string) => commit('Unlink', (p) => unlinkObject(p, childId, getState().currentFrame), [childId]);

  /** Row press: click selects; dragging past a few pixels picks the object up to drop it on a parent. */
  const onRowDown = (e: React.PointerEvent<HTMLDivElement>, n: Node) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    const el = e.currentTarget as HTMLDivElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    let state: { id: string; x: number; y: number; over: string | null; valid: boolean } | null = null;
    const target = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-obj-id], [data-layer-drop]');
      if (!hit || !panelRef.current?.contains(hit)) return { over: null, valid: false };
      if (hit.dataset.layerDrop) return { over: `layer:${hit.dataset.layerDrop}`, valid: !!n.o.link };
      const id = hit.dataset.objId!;
      const valid = id !== n.o.id && !isDescendant(getState().project, id, n.o.id, getState().currentFrame);
      return { over: id, valid };
    };
    const mv = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      dragging = true;
      state = { id: n.o.id, x: ev.clientX, y: ev.clientY, ...target(ev.clientX, ev.clientY) };
      setDrag(state);
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!dragging) { select(n, e.shiftKey || e.metaKey || e.ctrlKey); return; }
      if (!state?.over) return;
      if (!state.valid) {
        if (!state.over.startsWith('layer:')) toast('An object can’t follow itself or one of its own children.', 'warning');
        return;
      }
      if (state.over.startsWith('layer:')) unlink(n.o.id);
      else link(n.o.id, state.over);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const renderNode = (n: Node, depth: number, parentLayer: Layer | null): React.ReactNode => {
    const isOver = drag?.over === n.o.id;
    const parentName = n.o.link ? objectAt(s.project, n.o.link.parentId, s.frame)?.object.name : undefined;
    return (
      <div key={n.o.id} role="treeitem" aria-level={depth + 1} aria-selected={selected.has(n.o.id)} aria-expanded={n.children.length ? true : undefined}>
        <div
          className={`lo-row${selected.has(n.o.id) ? ' selected' : ''}${isOver ? (drag!.valid ? ' drop-ok' : ' drop-no') : ''}${drag?.id === n.o.id ? ' dragging' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          data-obj-id={n.o.id}
          onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => onRowDown(e, n)}
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n, e.shiftKey); } }}
          data-tip={n.o.name}
          data-tip-desc={`${kindOf(n.o)}. ${parentName ? `Follows “${parentName}”. Drag onto another object to follow it instead, or onto a layer name to unlink.` : 'Drag onto another object to make this one follow it.'}`}
        >
          {depth > 0 && <Icon name="link" size={12} className="lo-link-mark" />}
          <ObjectThumb o={n.o} frame={s.frame} />
          <span className="lo-name">{n.o.name}</span>
          {parentLayer && parentLayer !== n.layer && <span className="lo-layer">{n.layer.name}</span>}
          {n.o.link && (
            <button type="button" className="icon-btn sm lo-unlink" aria-label={`Unlink ${n.o.name}`} data-tip="Unlink"
              data-tip-desc="Stop following the parent. The object stays exactly where it is." onClick={() => unlink(n.o.id)}>
              <Icon name="unlink" size={14} />
            </button>
          )}
        </div>
        {n.children.length > 0 && <div role="group">{n.children.map((c) => renderNode(c, depth + 1, n.layer))}</div>}
      </div>
    );
  };

  const dragged = drag ? objectAt(s.project, drag.id, s.frame)?.object : null;
  return (
    <div ref={panelRef} className="linked-panel" role="dialog" aria-label="Linked Objects" style={{ left: pos.x, top: pos.y }}>
      <div className="lo-head" onPointerDown={onHeaderDown}>
        <Icon name="link" size={15} />
        <strong>Linked Objects</strong>
        <span className="lo-frame">Frame {s.frame + 1}</span>
        <button type="button" className="icon-btn sm" aria-label="Close Linked Objects" data-tip-desc="Close this window. Links stay in place." onClick={close}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <p className="hint lo-hint">Drag an object onto another to make it follow that object. Drop it on a layer name to unlink.</p>
      <div className="lo-body" role="tree" aria-label="Objects on this frame">
        {empty && <p className="hint lo-empty">No objects on this frame.</p>}
        {tree.filter((t) => t.roots.length).map(({ layer, roots }) => (
          <div key={layer.id} className="lo-layer-group">
            <div className={`lo-layer-head${drag?.over === `layer:${layer.id}` ? (drag.valid ? ' drop-ok' : '') : ''}`} data-layer-drop={layer.id}
              data-tip={layer.name} data-tip-desc="Drop a linked object here to unlink it.">
              <span className="layer-color" style={{ background: layer.color.slice(0, 7) }} aria-hidden="true" />
              {layer.name}
            </div>
            <div role="group">{roots.map((n) => renderNode(n, 0, null))}</div>
          </div>
        ))}
      </div>
      {drag && dragged && (
        <div className={`lo-ghost${drag.over && !drag.valid && !drag.over.startsWith('layer:') ? ' no' : ''}`} style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.over?.startsWith('layer:') ? `Unlink ${dragged.name}` : drag.over && drag.valid
            ? `${dragged.name} → follows ${objectAt(s.project, drag.over, s.frame)?.object.name ?? ''}` : dragged.name}
        </div>
      )}
    </div>
  );
}
