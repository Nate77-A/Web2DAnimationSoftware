// High-level editor actions shared by menus, keyboard shortcuts and panels.
import { identityTransform } from '../domain/defaults';
import { isLayerEffectivelyVisible, contentAt } from '../domain/evaluator';
import { newId } from '../domain/ids';
import {
  addBlankKeyframe, addKeyframe, addLayer, addObjects, arrangeObjects, clearFrame, cloneObject, createTween, deleteLayer,
  duplicateFrame, duplicateLayer, insertFrames, locateObject, mapObjects, moveLayer, removeFrames, removeKeyframe, removeObjects,
  setObjectTransform, updateLayer, type ArrangeMode,
} from '../domain/ops';
import type { Asset, BitmapObject, Layer, SceneObject } from '../domain/schema';
import { AssetImportError, importImage } from '../features/assets';
import { commit, getState, store, toast } from './state';
import { frameObjects } from './scene';
import { sampleObject } from '../domain/evaluator';

const activeLayer = (): Layer | undefined => {
  const s = getState();
  return s.project.layers.find((l) => l.id === s.activeLayerId);
};

function guardLayer(): Layer | null {
  const l = activeLayer();
  if (!l) return null;
  if (l.locked) { toast(`"${l.name}" is locked.`, 'warning'); return null; }
  return l;
}

// ------------------------------------------------------------ selection

export function selectAll() {
  const s = getState();
  store.set({ selection: frameObjects(s, { editableOnly: true }).map((o) => o.source.id) });
}

export function deselect() { store.set({ selection: [] }); }

export function deleteSelection() {
  const s = getState();
  if (!s.selection.length) return;
  const ids = s.selection;
  commit(ids.length > 1 ? `Delete ${ids.length} objects` : 'Delete object', (p) => removeObjects(p, ids), ids);
  store.set({ selection: [] });
}

let clipboard: SceneObject[] = [];

export function copySelection() {
  const s = getState();
  clipboard = s.selection.flatMap((id) => {
    const loc = locateObject(s.project, id);
    return loc ? [structuredClone(loc.object)] : [];
  });
  if (clipboard.length) toast(`Copied ${clipboard.length} object${clipboard.length > 1 ? 's' : ''}`);
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

export function paste(offset = 20) {
  if (!clipboard.length) return;
  const l = guardLayer();
  if (!l) return;
  const s = getState();
  const frame = s.currentFrame;
  const copies = clipboard.map((o) => {
    const c = cloneObject(o);
    return { ...c, transform: { ...c.transform, x: c.transform.x + offset, y: c.transform.y + offset }, keyframes: c.keyframes.map((k) => ({ ...k, x: k.x + offset, y: k.y + offset })) };
  });
  commit('Paste', (p) => addObjects(p, l.id, frame, copies), copies.map((c) => c.id));
  store.set({ selection: copies.map((c) => c.id) });
  clipboard = copies.map((c) => structuredClone(c));
}

export function duplicateSelection() {
  copySelection();
  paste();
}

export function nudgeSelection(dx: number, dy: number) {
  const s = getState();
  if (!s.selection.length) return;
  const frame = s.currentFrame;
  commit('Nudge', (p) => mapObjects(p, s.selection, (o) => {
    const t = sampleObject(o, frame).transform;
    return setObjectTransform(o, frame, { x: t.x + dx, y: t.y + dy });
  }), s.selection);
}

export function arrange(mode: ArrangeMode) {
  const s = getState();
  if (!s.selection.length) return;
  commit({ front: 'Bring to front', forward: 'Bring forward', backward: 'Send backward', back: 'Send to back' }[mode], (p) => arrangeObjects(p, s.selection, mode));
}

export function flipSelection(axis: 'h' | 'v') {
  const s = getState();
  if (!s.selection.length) return;
  const frame = s.currentFrame;
  commit(axis === 'h' ? 'Flip horizontal' : 'Flip vertical', (p) => mapObjects(p, s.selection, (o) => {
    const t = sampleObject(o, frame).transform;
    return setObjectTransform(o, frame, axis === 'h' ? { scaleX: -t.scaleX } : { scaleY: -t.scaleY });
  }));
}

// ------------------------------------------------------------ frames

export function goToFrame(f: number) {
  const s = getState();
  const frame = Math.max(0, Math.min(s.project.durationFrames - 1, Math.round(f)));
  if (frame !== s.currentFrame) store.set({ currentFrame: frame, editingTextId: null });
}

function rangeOrCurrent(): { layerIds: string[]; start: number; end: number } {
  const s = getState();
  return s.frameRange ?? { layerIds: [s.activeLayerId], start: s.currentFrame, end: s.currentFrame };
}

export function cmdDuplicateFrame() {
  const l = guardLayer();
  if (!l) return;
  const f = getState().currentFrame;
  let target = f + 1;
  commit('Duplicate frame', (p) => { const r = duplicateFrame(p, l.id, f); target = r.target; return r.project; });
  store.set({ currentFrame: target, selection: [], frameRange: null });
}

export function cmdBlankFrame() {
  const l = guardLayer();
  if (!l) return;
  const f = getState().currentFrame;
  let target = f + 1;
  commit('Add blank frame', (p) => { const r = addBlankKeyframe(p, l.id, f); target = r.target; return r.project; });
  store.set({ currentFrame: target, selection: [], frameRange: null });
}

export function cmdInsertFrame() {
  const r = rangeOrCurrent();
  const n = r.end - r.start + 1;
  commit(n > 1 ? `Insert ${n} frames` : 'Insert frame', (p) => r.layerIds.reduce((acc, id) => insertFrames(acc, id, r.start, n), p));
}

export function cmdDeleteFrames() {
  const r = rangeOrCurrent();
  const s = getState();
  if (r.layerIds.some((id) => s.project.layers.find((l) => l.id === id)?.locked)) { toast('A selected layer is locked.', 'warning'); return; }
  const n = r.end - r.start + 1;
  commit(n > 1 ? `Delete ${n} frames` : 'Delete frame', (p) => r.layerIds.reduce((acc, id) => removeFrames(acc, id, r.start, r.end), p));
  store.set({ frameRange: null, selection: [] });
}

export function cmdClearFrame() {
  const r = rangeOrCurrent();
  commit('Clear frame contents', (p) => r.layerIds.reduce((acc, id) => {
    let out = acc;
    for (let f = r.start; f <= r.end; f++) out = clearFrame(out, id, f);
    return out;
  }, p));
  store.set({ selection: [] });
}

export function cmdAddKeyframe() {
  const s = getState();
  if (!s.selection.length) { toast('Select objects to key their position, rotation, scale and opacity.', 'info'); return; }
  commit('Add keyframe', (p) => mapObjects(p, s.selection, (o) => addKeyframe(o, s.currentFrame)), s.selection);
}

export function cmdRemoveKeyframe() {
  const s = getState();
  if (!s.selection.length) return;
  commit('Remove keyframe', (p) => mapObjects(p, s.selection, (o) => removeKeyframe(o, s.currentFrame)), s.selection);
}

export function cmdCreateTween() {
  const s = getState();
  if (!s.selection.length) { toast('Select artwork to tween first.', 'info'); return; }
  let end = 0;
  const ok = commit('Create motion tween', (p) => {
    const r = createTween(p, s.selection, s.currentFrame);
    if (!r) return p;
    end = r.endFrame;
    return r.project;
  });
  if (ok) {
    store.set({ currentFrame: end, tool: 'transform' });
    toast(`Tween keyed at frames ${frameLabel(rangeStart())}–${end + 1}. Transform the artwork here to set the end pose.`, 'success');
  } else toast('Could not create a tween here (no room before the next keyframe).', 'warning');
}

function rangeStart() {
  const s = getState();
  const loc = s.selection[0] ? locateObject(s.project, s.selection[0]) : null;
  const e = loc?.layer.exposureTrack.find((x) => x.contentId === loc.content.id);
  return e?.startFrame ?? s.currentFrame;
}
const frameLabel = (f: number) => f + 1;

// ------------------------------------------------------------ layers

export function cmdAddLayer() {
  const s = getState();
  let id = '';
  commit('Add layer', (p) => { const r = addLayer(p, s.activeLayerId); id = r.layerId; return r.project; });
  store.set({ activeLayerId: id });
}

export function cmdDeleteLayer(layerId = getState().activeLayerId) {
  const s = getState();
  if (s.project.layers.length <= 1) { toast('A project needs at least one layer.', 'info'); return; }
  const name = s.project.layers.find((l) => l.id === layerId)?.name;
  commit(`Delete layer "${name}"`, (p) => deleteLayer(p, layerId));
}

export function cmdDuplicateLayer(layerId = getState().activeLayerId) {
  let id = '';
  commit('Duplicate layer', (p) => { const r = duplicateLayer(p, layerId); id = r.layerId; return r.project; });
  store.set({ activeLayerId: id });
}

export function cmdMoveLayer(layerId: string, toIndex: number) {
  commit('Reorder layer', (p) => moveLayer(p, layerId, toIndex));
}

export function cmdUpdateLayer(layerId: string, patch: Partial<Layer>, label: string) {
  commit(label, (p) => updateLayer(p, layerId, patch));
  if (patch.locked || patch.visible === false) {
    const s = getState();
    const ids = new Set(s.project.layers.find((l) => l.id === layerId)?.objectTracks.flatMap((c) => c.objects.map((o) => o.id)));
    store.set({ selection: s.selection.filter((id) => !ids.has(id)) });
  }
}

export function toggleSolo(layerId: string) {
  const l = getState().project.layers.find((x) => x.id === layerId);
  if (l) cmdUpdateLayer(layerId, { solo: !l.solo }, l.solo ? 'Unsolo layer' : 'Solo layer');
}

// ------------------------------------------------------------ import

export async function importFiles(files: File[]) {
  const l = guardLayer();
  if (!l) return;
  const s0 = getState();
  if (!isLayerEffectivelyVisible(s0.project, l)) { toast(`"${l.name}" is hidden. Show it to place images.`, 'warning'); return; }
  const placed: BitmapObject[] = [];
  const assets: Asset[] = [];
  for (const file of files) {
    try {
      const a = await importImage(file, file.name);
      assets.push(a);
      const p = getState().project;
      const fit = Math.min(1, (p.width * 0.8) / a.width, (p.height * 0.8) / a.height);
      const offset = placed.length * 24;
      placed.push({
        id: newId('obj'), kind: 'bitmap', name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Bitmap', visible: true, locked: false, opacity: 1,
        assetRef: a.id, geometry: { width: a.width, height: a.height },
        transform: { ...identityTransform(p.width / 2 + offset, p.height / 2 + offset, a.width / 2, a.height / 2), scaleX: fit, scaleY: fit },
        style: { fill: { type: 'none' }, stroke: { type: 'none' }, strokeWidth: 0, cap: 'round', join: 'round', dash: [], fillRule: 'nonzero' },
        metadata: {}, keyframes: [],
      });
    } catch (e) {
      toast(e instanceof AssetImportError ? e.message : `Could not import "${file.name}": ${(e as Error).message}`, 'error');
    }
  }
  if (!placed.length) return;
  const frame = getState().currentFrame;
  commit(placed.length > 1 ? `Import ${placed.length} images` : 'Import image', (p) => {
    const known = new Set(p.assets.map((a) => a.id));
    const newAssets = assets.filter((a, i) => !known.has(a.id) && assets.findIndex((b) => b.id === a.id) === i);
    return addObjects({ ...p, assets: [...p.assets, ...newAssets] }, l.id, frame, placed);
  }, placed.map((o) => o.id));
  store.set((s) => ({ selection: placed.map((o) => o.id), assetsVersion: s.assetsVersion + 1 }));
}

export function pickImageFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.multiple = true;
  input.onchange = () => { if (input.files?.length) void importFiles(Array.from(input.files)); };
  input.click();
}

export function hasContentAtFrame(layer: Layer, f: number) {
  return !!contentAt(layer, f);
}
