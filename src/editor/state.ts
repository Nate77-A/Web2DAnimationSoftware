// Application state, command history and core actions.
import { createProject, defaultBrush, defaultText } from '../domain/defaults';
import { newId, nowIso } from '../domain/ids';
import { locateObject } from '../domain/ops';
import type { BrushSettings, Paint, Project, ShapeType, Style, TextData, Vec } from '../domain/schema';
import type { KeyRef } from '../domain/keyframes';
import type { Rect } from '../domain/math';
import type { TimelineClip } from '../domain/timelineClipboard';
import { createStore, useSelector } from './store';

export type ToolId = 'select' | 'transform' | 'brush' | 'paint' | 'eraser' | 'shape' | 'pen' | 'text' | 'bucket' | 'eyedropper' | 'hand' | 'zoom';

/** Command record: deterministic do/undo payloads (structurally shared project snapshots), no closures. */
export interface Command {
  id: string;
  label: string;
  before: Project;
  after: Project;
  affectedIds: string[];
  timestamp: number;
}

export interface Viewport { panX: number; panY: number; zoom: number }
export interface FrameRange { layerIds: string[]; start: number; end: number }
export interface Toast { id: string; kind: 'info' | 'success' | 'warning' | 'error'; text: string; sticky?: boolean }

export type Dialog =
  | { kind: 'export'; tab?: 'png' | 'gif' | 'mp4' | 'svg' }
  | { kind: 'projects' }
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; confirmHelp?: string; danger?: boolean; onConfirm: () => void; altLabel?: string; altHelp?: string; onAlt?: () => void }
  | { kind: 'prompt'; title: string; label: string; value: string; confirmLabel: string; confirmHelp?: string; onConfirm: (v: string) => void }
  | { kind: 'recovery'; message: string; details: string[]; raw: string | null; projectId: string | null };

export interface PenDraft { segments: { p: Vec; hi: Vec; ho: Vec }[]; hover: Vec | null; dragging: boolean }

export interface OverlayState {
  marquee: Rect | null;
  pen: PenDraft | null;
  eraser: { pos: Vec; r: number } | null;
  zoomBox: Rect | null;
  brushCursor: { pos: Vec; r: number } | null;
}

export interface ToolOptions {
  brush: BrushSettings & { opacity: number };
  /** Paint Brush: paints with the fill color; `merge` joins strokes with touching paint of the same color. */
  paint: BrushSettings & { opacity: number; merge: boolean };
  eraser: { size: number; mode: 'split' | 'delete'; allLayers: boolean };
  shape: { type: ShapeType; sides: number; cornerRadius: number };
  pen: { showHandles: boolean };
  text: TextData;
  eyedropper: { target: 'fill' | 'stroke'; allLayers: boolean };
}

export interface PanelState { tools: boolean; properties: boolean; timeline: boolean }

/** Path edit mode (double-click a path, shape or brush stroke with the Select tool). */
export interface PathEditState {
  id: string;
  /** Selected anchor indices. */
  selected: number[];
  /** Curve being bent (from anchor `curve` to the next); its handles stay visible. */
  curve: number | null;
  /** Anchor being held down; the overlay shows a ring that fills until it toggles smooth/sharp. */
  hold: number | null;
  /** What is under the pointer, for the cursor. */
  hover: 'anchor' | 'handle' | 'curve' | null;
  /** Anchor whose delete (X) button is showing, after double-clicking it. */
  deletePrompt: number | null;
}

export interface AppState {
  project: Project;
  past: Command[];
  future: Command[];
  gestureBase: Project | null;
  saveStatus: 'saved' | 'saving' | 'pending' | 'error';
  saveError: string | null;
  fileDirty: boolean;
  tool: ToolId;
  transientTool: ToolId | null;
  toolOptions: ToolOptions;
  fill: Paint;
  stroke: Paint;
  strokeStyle: Pick<Style, 'strokeWidth' | 'cap' | 'join' | 'dash'>;
  recentColors: string[];
  selection: string[];
  editingTextId: string | null;
  pathEdit: PathEditState | null;
  viewport: Viewport;
  stageSize: { width: number; height: number };
  panels: PanelState;
  showGuides: boolean;
  debugMarkers: boolean;
  markers: Vec[];
  overlay: OverlayState;
  currentFrame: number;
  activeLayerId: string;
  frameRange: FrameRange | null;
  /** Keyframes selected in the timeline (drawing and tween keys). */
  keySelection: KeyRef[];
  /** Frames or keyframes copied from the timeline. */
  timelineClip: TimelineClip | null;
  /** After Copy, the next click on a timeline frame pastes there. */
  pasteArmed: boolean;
  playing: boolean;
  timelineZoom: number;
  assetsVersion: number;
  toasts: Toast[];
  dialog: Dialog | null;
  ready: boolean;
}

const HISTORY_LIMIT = 200;

export function initialState(project: Project = createProject()): AppState {
  return {
    project,
    past: [],
    future: [],
    gestureBase: null,
    saveStatus: 'saved',
    saveError: null,
    fileDirty: false,
    tool: 'brush',
    transientTool: null,
    toolOptions: {
      brush: { ...defaultBrush(), opacity: 1 },
      paint: { ...defaultBrush(), size: 30, opacity: 1, merge: true },
      eraser: { size: 24, mode: 'split', allLayers: false },
      shape: { type: 'rect', sides: 6, cornerRadius: 0 },
      pen: { showHandles: true },
      text: defaultText(),
      eyedropper: { target: 'fill', allLayers: true },
    },
    fill: { type: 'solid', color: '#3CC8D6FF' },
    stroke: { type: 'solid', color: '#16191EFF' },
    strokeStyle: { strokeWidth: 4, cap: 'round', join: 'round', dash: [] },
    recentColors: ['#16191EFF', '#FFFFFFFF', '#3CC8D6FF', '#F2A33AFF', '#EF6A82FF', '#58C77AFF'],
    selection: [],
    editingTextId: null,
    pathEdit: null,
    viewport: { panX: 0, panY: 0, zoom: 0.5 },
    stageSize: { width: 800, height: 600 },
    panels: { tools: true, properties: true, timeline: true },
    showGuides: false,
    debugMarkers: false,
    markers: [],
    overlay: { marquee: null, pen: null, eraser: null, zoomBox: null, brushCursor: null },
    currentFrame: 0,
    activeLayerId: project.layers[project.layers.length - 1].id,
    frameRange: null,
    keySelection: [],
    timelineClip: null,
    pasteArmed: false,
    playing: false,
    timelineZoom: 16,
    assetsVersion: 0,
    toasts: [],
    dialog: null,
    ready: false,
  };
}

export const store = createStore<AppState>(initialState());
export const useApp = <R,>(sel: (s: AppState) => R) => useSelector(store, sel);
export const getState = store.get;

// ------------------------------------------------------------ toasts

export function toast(text: string, kind: Toast['kind'] = 'info', sticky = false) {
  const t: Toast = { id: newId('toast'), kind, text, sticky };
  store.set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  if (!sticky) setTimeout(() => dismissToast(t.id), kind === 'error' ? 7000 : 3500);
}
export function dismissToast(id: string) {
  store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// ------------------------------------------------------------ commands

function touch(p: Project): Project {
  return { ...p, updatedAt: nowIso() };
}

function pruneSelection(p: Project, sel: string[]): string[] {
  const next = sel.filter((id) => locateObject(p, id));
  return next.length === sel.length ? sel : next;
}

/** After undo/redo, select the objects the command touched (when they exist) so the change is visible. */
function restoreSelection(p: Project, affected: string[], current: string[]): string[] {
  const live = affected.filter((id) => locateObject(p, id));
  return live.length ? live : pruneSelection(p, current);
}

function activeLayerFix(p: Project, id: string): string {
  return p.layers.some((l) => l.id === id) ? id : p.layers[p.layers.length - 1].id;
}

/** Applies a pure project transformation as one undoable command. */
export function commit(label: string, fn: (p: Project) => Project, affectedIds: string[] = []): boolean {
  const s = store.get();
  if (s.gestureBase) cancelGesture();
  const before = store.get().project;
  const after = fn(before);
  if (after === before) return false;
  pushCommand(label, before, touch(after), affectedIds);
  return true;
}

/**
 * Like commit, but folds into the previous command when it has the same label and targets within
 * a short window (numeric scrubbing, slider drags, color picking) so undo restores the pre-drag value.
 */
export function commitMerge(label: string, fn: (p: Project) => Project, affectedIds: string[] = []): boolean {
  const s = store.get();
  const last = s.past[s.past.length - 1];
  const key = affectedIds.join(',');
  if (last && !s.gestureBase && last.label === label && last.affectedIds.join(',') === key && Date.now() - last.timestamp < 1200 && last.after === s.project) {
    const after = fn(s.project);
    if (after === s.project) return false;
    const merged: Command = { ...last, after: touch(after), timestamp: Date.now() };
    store.set({ project: merged.after, past: [...s.past.slice(0, -1), merged], future: [], fileDirty: true });
    return true;
  }
  return commit(label, fn, affectedIds);
}

function pushCommand(label: string, before: Project, after: Project, affectedIds: string[]) {
  const cmd: Command = { id: newId('cmd'), label, before, after, affectedIds, timestamp: Date.now() };
  store.set((s) => ({
    project: after,
    past: [...s.past.slice(-(HISTORY_LIMIT - 1)), cmd],
    future: [],
    fileDirty: true,
    selection: pruneSelection(after, s.selection),
    activeLayerId: activeLayerFix(after, s.activeLayerId),
  }));
}

/** Gestures preview live edits without history entries; endGesture records a single command. */
export function beginGesture() {
  const s = store.get();
  if (!s.gestureBase) store.set({ gestureBase: s.project });
}
export function updateGesture(fn: (base: Project) => Project) {
  const base = store.get().gestureBase;
  if (!base) return;
  store.set({ project: fn(base) });
}
export function endGesture(label: string, affectedIds: string[] = []) {
  const s = store.get();
  if (!s.gestureBase) return;
  const before = s.gestureBase;
  store.set({ gestureBase: null });
  if (s.project === before) return;
  pushCommand(label, before, touch(s.project), affectedIds);
}
export function cancelGesture() {
  const s = store.get();
  if (s.gestureBase) store.set({ project: s.gestureBase, gestureBase: null });
}

export function undo() {
  const s = store.get();
  if (s.gestureBase) { cancelGesture(); return; }
  const cmd = s.past[s.past.length - 1];
  if (!cmd) return;
  store.set({
    project: cmd.before,
    past: s.past.slice(0, -1),
    future: [...s.future, cmd],
    fileDirty: true,
    selection: restoreSelection(cmd.before, cmd.affectedIds, s.selection),
    activeLayerId: activeLayerFix(cmd.before, s.activeLayerId),
    editingTextId: null,
  });
  toast(`Undo: ${cmd.label}`);
}

export function redo() {
  const s = store.get();
  const cmd = s.future[s.future.length - 1];
  if (!cmd) return;
  store.set({
    project: cmd.after,
    future: s.future.slice(0, -1),
    past: [...s.past, cmd],
    fileDirty: true,
    selection: restoreSelection(cmd.after, cmd.affectedIds, s.selection),
    activeLayerId: activeLayerFix(cmd.after, s.activeLayerId),
  });
  toast(`Redo: ${cmd.label}`);
}

/** Replaces the whole project (open/new). Clears history. */
export function loadProjectIntoEditor(project: Project, opts: { fileDirty?: boolean } = {}) {
  store.set({
    project,
    past: [],
    future: [],
    gestureBase: null,
    selection: [],
    editingTextId: null,
    pathEdit: null,
    currentFrame: 0,
    frameRange: null,
    keySelection: [],
    pasteArmed: false,
    playing: false,
    activeLayerId: project.layers[project.layers.length - 1].id,
    fileDirty: opts.fileDirty ?? false,
    overlay: initialState().overlay,
  });
}

export function setOverlay(patch: Partial<OverlayState>) {
  store.set((s) => ({ overlay: { ...s.overlay, ...patch } }));
}

export function setToolOptions<K extends keyof ToolOptions>(key: K, patch: Partial<ToolOptions[K]>) {
  store.set((s) => ({ toolOptions: { ...s.toolOptions, [key]: { ...s.toolOptions[key], ...patch } } }));
}

export function pushRecentColor(hex: string) {
  store.set((s) => ({ recentColors: [hex, ...s.recentColors.filter((c) => c !== hex)].slice(0, 12) }));
}

export function activeTool(s: AppState = store.get()): ToolId {
  return s.transientTool ?? s.tool;
}
