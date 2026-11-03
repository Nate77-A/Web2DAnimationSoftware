// Command registry: one place for menu items, shortcut labels and keyboard dispatch.
import {
  arrange, cmdAddKeyframe, cmdAddLayer, cmdBlankFrame, cmdClearFrame, cmdCreateTween, cmdDeleteFrames, cmdDeleteLayer,
  cmdDuplicateFrame, cmdDuplicateLayer, cmdInsertFrame, cmdRemoveKeyframe, copySelection, cutSelection, deleteSelection,
  deselect, duplicateSelection, flipSelection, goToFrame, nudgeSelection, paste, pickImageFiles, selectAll,
} from '../editor/actions';
import { fitToStage, setSpaceDown, setZoom } from '../editor/Stage';
import { commit, getState, redo, store, undo, type PanelState } from '../editor/state';
import { setTool, tools, TOOL_LIST } from '../editor/tools';
import { newProject, openProject, saveProjectAs, saveProjectFile } from '../features/fileCommands';
import { togglePlay } from '../timeline/playback';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface Command {
  id: string;
  label: string;
  keys?: string[]; // e.g. 'Mod+Shift+Z'
  run: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
}

const hasSel = () => getState().selection.length > 0;
const togglePanel = (k: keyof PanelState) => store.set((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } }));
export const setPref = (patch: Partial<ReturnType<typeof getState>['project']['preferences']>) =>
  commit('Change preferences', (p) => ({ ...p, preferences: { ...p.preferences, ...patch } }));

export function setTimelineZoom(z: number) {
  store.set({ timelineZoom: Math.max(4, Math.min(48, Math.round(z))) });
}

export const commands: Record<string, Command> = {};
function def(c: Command) { commands[c.id] = c; return c; }

// File
def({ id: 'file.new', label: 'New Project', keys: ['Mod+Alt+N'], run: newProject });
def({ id: 'file.open', label: 'Open…', keys: ['Mod+O'], run: openProject });
def({ id: 'file.projects', label: 'Projects in This Browser…', run: () => store.set({ dialog: { kind: 'projects' } }) });
def({ id: 'file.save', label: 'Save', keys: ['Mod+S'], run: () => void saveProjectFile() });
def({ id: 'file.saveAs', label: 'Save As…', keys: ['Mod+Shift+S'], run: saveProjectAs });
def({ id: 'file.import', label: 'Import Image to Stage…', keys: ['Mod+Shift+O'], run: pickImageFiles });
def({ id: 'file.export', label: 'Export…', keys: ['Mod+Shift+E'], run: () => store.set({ dialog: { kind: 'export' } }) });

// Edit
def({ id: 'edit.undo', label: 'Undo', keys: ['Mod+Z'], run: undo, enabled: () => getState().past.length > 0 });
def({ id: 'edit.redo', label: 'Redo', keys: ['Mod+Shift+Z', 'Mod+Y'], run: redo, enabled: () => getState().future.length > 0 });
def({ id: 'edit.cut', label: 'Cut', keys: ['Mod+X'], run: cutSelection, enabled: hasSel });
def({ id: 'edit.copy', label: 'Copy', keys: ['Mod+C'], run: copySelection, enabled: hasSel });
def({ id: 'edit.paste', label: 'Paste', keys: ['Mod+V'], run: () => paste() });
def({ id: 'edit.duplicate', label: 'Duplicate', keys: ['Mod+D'], run: duplicateSelection, enabled: hasSel });
def({ id: 'edit.delete', label: 'Delete', keys: ['Delete', 'Backspace'], run: deleteSelection, enabled: hasSel });
def({ id: 'edit.selectAll', label: 'Select All', keys: ['Mod+A'], run: selectAll });
def({ id: 'edit.deselect', label: 'Deselect', keys: ['Mod+Shift+A'], run: deselect, enabled: hasSel });
def({ id: 'edit.front', label: 'Bring to Front', keys: ['Mod+Shift+]'], run: () => arrange('front'), enabled: hasSel });
def({ id: 'edit.forward', label: 'Bring Forward', keys: ['Mod+]'], run: () => arrange('forward'), enabled: hasSel });
def({ id: 'edit.backward', label: 'Send Backward', keys: ['Mod+['], run: () => arrange('backward'), enabled: hasSel });
def({ id: 'edit.back', label: 'Send to Back', keys: ['Mod+Shift+['], run: () => arrange('back'), enabled: hasSel });
def({ id: 'edit.flipH', label: 'Flip Horizontal', run: () => flipSelection('h'), enabled: hasSel });
def({ id: 'edit.flipV', label: 'Flip Vertical', run: () => flipSelection('v'), enabled: hasSel });

// View
def({ id: 'view.zoomIn', label: 'Zoom In', keys: ['Mod+=', 'Mod++'], run: () => setZoom(getState().viewport.zoom * 1.25) });
def({ id: 'view.zoomOut', label: 'Zoom Out', keys: ['Mod+-'], run: () => setZoom(getState().viewport.zoom / 1.25) });
def({ id: 'view.fit', label: 'Fit Stage', keys: ['Mod+0'], run: fitToStage });
def({ id: 'view.actual', label: 'Actual Size (100%)', keys: ['Mod+1'], run: () => setZoom(1) });
def({ id: 'view.guides', label: 'Center & Safe-Area Guides', keys: ['Mod+;'], run: () => store.set((s) => ({ showGuides: !s.showGuides })), checked: () => getState().showGuides });
def({ id: 'view.onion', label: 'Onion Skin', keys: ['Alt+Shift+O'], run: () => setPref({ onionSkin: !getState().project.preferences.onionSkin }), checked: () => getState().project.preferences.onionSkin });
def({ id: 'view.markers', label: 'Debug: Coordinate Markers', run: () => store.set((s) => ({ debugMarkers: !s.debugMarkers, markers: [] })), checked: () => getState().debugMarkers });

// Timeline
def({ id: 'tl.play', label: 'Play / Pause', keys: ['Enter'], run: togglePlay });
def({ id: 'tl.prev', label: 'Previous Frame', keys: [','], run: () => goToFrame(getState().currentFrame - 1) });
def({ id: 'tl.next', label: 'Next Frame', keys: ['.'], run: () => goToFrame(getState().currentFrame + 1) });
def({ id: 'tl.first', label: 'First Frame', keys: ['Home'], run: () => goToFrame(0) });
def({ id: 'tl.last', label: 'Last Frame', keys: ['End'], run: () => goToFrame(getState().project.durationFrames - 1) });
def({ id: 'tl.insertFrame', label: 'Insert Frame (extend hold)', keys: ['F5'], run: cmdInsertFrame });
def({ id: 'tl.deleteFrame', label: 'Delete Frame', keys: ['Shift+F5'], run: cmdDeleteFrames });
def({ id: 'tl.duplicateFrame', label: 'Duplicate Frame', keys: ['F6'], run: cmdDuplicateFrame });
def({ id: 'tl.blankFrame', label: 'Add Blank Frame', keys: ['F7'], run: cmdBlankFrame });
def({ id: 'tl.clearFrame', label: 'Clear Frame Contents', run: cmdClearFrame });
def({ id: 'tl.tween', label: 'Create Motion Tween', keys: ['Shift+T'], run: cmdCreateTween, enabled: hasSel });
def({ id: 'tl.addKey', label: 'Add Keyframe at Playhead', keys: ['F9'], run: cmdAddKeyframe, enabled: hasSel });
def({ id: 'tl.removeKey', label: 'Remove Keyframe at Playhead', keys: ['Shift+F9'], run: cmdRemoveKeyframe, enabled: hasSel });
def({ id: 'tl.addLayer', label: 'Add Layer', keys: ['Mod+Alt+L'], run: cmdAddLayer });
def({ id: 'tl.duplicateLayer', label: 'Duplicate Layer', run: () => cmdDuplicateLayer() });
def({ id: 'tl.deleteLayer', label: 'Delete Layer', run: () => cmdDeleteLayer(), enabled: () => getState().project.layers.length > 1 });
def({ id: 'tl.loop', label: 'Loop Playback', run: () => setPref({ loopPlayback: !getState().project.preferences.loopPlayback }), checked: () => getState().project.preferences.loopPlayback });
def({ id: 'tl.zoomIn', label: 'Timeline Zoom In', keys: ['='], run: () => setTimelineZoom(getState().timelineZoom * 1.25) });
def({ id: 'tl.zoomOut', label: 'Timeline Zoom Out', keys: ['-'], run: () => setTimelineZoom(getState().timelineZoom / 1.25) });
def({ id: 'tl.fit', label: 'Fit Selection in Timeline', keys: ['Shift+F'], run: () => window.dispatchEvent(new Event('studio:timeline-fit')) });

// Window
def({ id: 'win.tools', label: 'Tools', run: () => togglePanel('tools'), checked: () => getState().panels.tools });
def({ id: 'win.properties', label: 'Properties', run: () => togglePanel('properties'), checked: () => getState().panels.properties });
def({ id: 'win.timeline', label: 'Timeline', run: () => togglePanel('timeline'), checked: () => getState().panels.timeline });
def({ id: 'win.reset', label: 'Show All Panels', run: () => store.set({ panels: { tools: true, properties: true, timeline: true } }) });
def({ id: 'help.shortcuts', label: 'Keyboard Shortcuts', keys: ['Shift+?'], run: () => store.set({ dialog: { kind: 'shortcuts' } }) });
def({ id: 'help.about', label: 'About & Known Limits', run: () => store.set({ dialog: { kind: 'about' } }) });

for (const t of TOOL_LIST) def({ id: `tool.${t.id}`, label: t.label, keys: [t.shortcut], run: () => setTool(t.id), checked: () => getState().tool === t.id });
def({ id: 'color.swap', label: 'Swap Fill and Stroke', keys: ['X'], run: () => store.set((s) => ({ fill: s.stroke, stroke: s.fill })) });
def({ id: 'color.default', label: 'Default Colors', keys: ['D'], run: () => store.set({ fill: { type: 'solid', color: '#FFFFFFFF' }, stroke: { type: 'solid', color: '#000000FF' } }) });
def({ id: 'brush.smaller', label: 'Decrease Tool Size', keys: ['['], run: () => resizeTool(1 / 1.2) });
def({ id: 'brush.larger', label: 'Increase Tool Size', keys: [']'], run: () => resizeTool(1.2) });

function resizeTool(f: number) {
  const s = getState();
  if (s.tool === 'eraser') store.set({ toolOptions: { ...s.toolOptions, eraser: { ...s.toolOptions.eraser, size: Math.max(1, Math.min(500, Math.round(s.toolOptions.eraser.size * f))) } } });
  else store.set({ toolOptions: { ...s.toolOptions, brush: { ...s.toolOptions.brush, size: Math.max(0.5, Math.min(500, +(s.toolOptions.brush.size * f).toFixed(1))) } } });
}

export const MENUS: { id: string; label: string; items: (string | '-')[] }[] = [
  { id: 'file', label: 'File', items: ['file.new', 'file.open', 'file.projects', '-', 'file.save', 'file.saveAs', '-', 'file.import', 'file.export'] },
  { id: 'edit', label: 'Edit', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', '-', 'edit.selectAll', 'edit.deselect', '-', 'edit.front', 'edit.forward', 'edit.backward', 'edit.back', '-', 'edit.flipH', 'edit.flipV'] },
  { id: 'view', label: 'View', items: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.actual', '-', 'view.guides', 'view.onion', 'view.markers'] },
  { id: 'timeline', label: 'Timeline', items: ['tl.play', 'tl.loop', '-', 'tl.insertFrame', 'tl.deleteFrame', 'tl.duplicateFrame', 'tl.blankFrame', 'tl.clearFrame', '-', 'tl.tween', 'tl.addKey', 'tl.removeKey', '-', 'tl.addLayer', 'tl.duplicateLayer', 'tl.deleteLayer', '-', 'tl.zoomIn', 'tl.zoomOut', 'tl.fit'] },
  { id: 'window', label: 'Window', items: ['win.tools', 'win.properties', 'win.timeline', 'win.reset', '-', 'help.shortcuts', 'help.about'] },
];

export function formatKeys(keys?: string[]): string {
  if (!keys?.length) return '';
  const k = keys[0];
  return k.split('+').map((p) => {
    if (p === 'Mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'Alt') return isMac ? '⌥' : 'Alt';
    if (p === 'Shift') return isMac ? '⇧' : 'Shift';
    if (p === 'Delete') return isMac ? '⌦' : 'Del';
    if (p === 'Enter') return isMac ? '↩' : 'Enter';
    return p.length === 1 ? p.toUpperCase() : p;
  }).join(isMac ? '' : '+');
}

function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  // Alt changes e.key on macOS; fall back to the physical key for letters/digits.
  if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (e.code === 'Equal') key = '=';
  else if (e.code === 'Minus') key = '-';
  else if (e.code === 'BracketLeft') key = '[';
  else if (e.code === 'BracketRight') key = ']';
  else if (e.code === 'Comma') key = ',';
  else if (e.code === 'Period') key = '.';
  else if (e.code === 'Semicolon') key = ';';
  else if (e.code === 'Slash') key = '?';
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

let keyIndex: Map<string, Command> | null = null;
function index() {
  if (keyIndex) return keyIndex;
  keyIndex = new Map();
  for (const c of Object.values(commands)) for (const k of c.keys ?? []) {
    const norm = k.split('+').map((p) => (p.length === 1 ? p.toUpperCase() : p)).join('+');
    keyIndex.set(norm, c);
  }
  return keyIndex;
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'color'].includes(type);
  }
  return tag === 'SELECT';
}

export function installKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const s = getState();
    const typing = isTypingTarget(e.target);
    const combo = comboOf(e);
    if (typing) {
      // Allow document-level save/export while typing in a field; leave everything else to the field.
      if (['Mod+S', 'Mod+Shift+S', 'Mod+Shift+E'].includes(combo)) { e.preventDefault(); index().get(combo)?.run(); }
      return;
    }
    if (s.dialog) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) setSpaceDown(true);
      return;
    }
    // Active tool gets first refusal (pen: Enter/Esc/Backspace).
    if (tools[s.transientTool ?? s.tool].key?.(e)) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      const t = TOOL_LIST.find((x) => x.id === s.tool);
      if (t?.transient) setTool('select');
      else if (s.frameRange) store.set({ frameRange: null });
      else deselect();
      return;
    }
    if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey) {
      const d = e.shiftKey ? 10 : 1;
      if (s.selection.length) {
        e.preventDefault();
        nudgeSelection(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        goToFrame(s.currentFrame + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
      }
      return;
    }
    // Let buttons/menus handle Enter/Space themselves.
    const el = e.target as HTMLElement;
    if (combo === 'Enter' && el && (el.tagName === 'BUTTON' || el.getAttribute('role')?.startsWith('menuitem'))) return;
    const cmd = index().get(combo);
    if (!cmd) return;
    if (cmd.enabled && !cmd.enabled()) { e.preventDefault(); return; }
    e.preventDefault();
    cmd.run();
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') setSpaceDown(false); });
  window.addEventListener('blur', () => setSpaceDown(false));
}
