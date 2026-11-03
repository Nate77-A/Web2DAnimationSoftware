// Context-sensitive properties: tool settings, single/multi object properties, or document + layer.
import { useEffect, useRef, useState } from 'react';
import { FONT_FAMILIES } from '../domain/defaults';
import { exposureAt, sampleObject } from '../domain/evaluator';
import { applyVector, rotate, unionRects, transformMatrix, transformRect } from '../domain/math';
import { locateObject, mapObjects, setKeyframeEase, setObjectTransform } from '../domain/ops';
import type { BlendMode, Ease, Paint, SceneObject, Style, TextData } from '../domain/schema';
import { cmdAddKeyframe, cmdCreateTween, cmdRemoveKeyframe, arrange, flipSelection, goToFrame } from '../editor/actions';
import { cachedLocalBounds, clearMeasureCache } from '../editor/renderer';
import { commit, commitMerge, getState, setToolOptions, store, useApp, activeTool } from '../editor/state';
import { fitToStage, setZoom } from '../editor/Stage';
import { formatKeys, setPref } from './commands';
import { Check, Field, NumberField, PaintField, Seg } from './controls';
import { Icon } from './icons';
import { DocSizePopover } from './StageHeader';

const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'];
const FPS_PRESETS = [8, 12, 15, 24, 25, 30, 48, 50, 60];

const fontAvailCache = new Map<string, boolean>();
function fontAvailable(family: string): boolean {
  const first = family.split(',')[0].trim().replace(/["']/g, '');
  if (/^(serif|sans-serif|monospace|system-ui|cursive|fantasy)$/.test(first)) return true;
  if (fontAvailCache.has(first)) return fontAvailCache.get(first)!;
  const c = document.createElement('canvas').getContext('2d')!;
  const test = 'mmmmmmmmmmlli1WQ@#';
  const widths = ['monospace', 'serif', 'sans-serif'].map((fb) => { c.font = `72px ${fb}`; return c.measureText(test).width; });
  const ok = ['monospace', 'serif', 'sans-serif'].some((fb, i) => { c.font = `72px "${first}", ${fb}`; return c.measureText(test).width !== widths[i]; });
  fontAvailCache.set(first, ok);
  return ok;
}

function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: string }) {
  return (
    <section className="section" aria-label={title}>
      <h3>{icon && <Icon name={icon} size={14} />}{title}</h3>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ style editors

function StyleEditor({ style, onChange, closed, showFill = true, title = 'Appearance' }: {
  style: Pick<Style, 'fill' | 'stroke' | 'strokeWidth' | 'cap' | 'join' | 'dash'> & Partial<Pick<Style, 'fillRule'>>;
  onChange: (patch: Partial<Style>) => void; closed: boolean; showFill?: boolean; title?: string;
}) {
  const dashStr = style.dash.join(' ');
  const [dash, setDash] = useState(dashStr);
  useEffect(() => setDash(dashStr), [dashStr]);
  return (
    <Section title={title}>
      {showFill && <PaintField label={closed ? 'Fill' : 'Fill (closed paths only)'} paint={style.fill} onChange={(fill) => onChange({ fill })} />}
      <PaintField label="Stroke" paint={style.stroke} onChange={(stroke) => onChange({ stroke })} />
      <div className="grid2">
        <NumberField label="Stroke width" scrubLabel="W" value={style.strokeWidth} min={0} max={1000} step={0.5} precision={1} unit="px" onChange={(strokeWidth) => onChange({ strokeWidth })} />
        <input className="input" aria-label="Dash pattern (e.g. 10 6)" placeholder="Dash e.g. 10 6" value={dash}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDash(e.target.value)}
          onBlur={() => {
            const arr = dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 8);
            onChange({ dash: arr.some((n) => n > 0) ? arr : [] });
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
      </div>
      <Field label="Cap">
        <Seg label="Line cap" value={style.cap} onChange={(cap) => onChange({ cap })} options={[{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} />
      </Field>
      <Field label="Join">
        <Seg label="Line join" value={style.join} onChange={(join) => onChange({ join })} options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]} />
      </Field>
      {style.fillRule && closed && (
        <Field label="Fill rule">
          <Seg label="Fill rule" value={style.fillRule} onChange={(fillRule) => onChange({ fillRule })} options={[{ value: 'nonzero', label: 'Non-zero' }, { value: 'evenodd', label: 'Even-odd' }]} />
        </Field>
      )}
    </Section>
  );
}

function TextEditorFields({ t, onChange }: { t: TextData; onChange: (patch: Partial<TextData>) => void }) {
  const avail = fontAvailable(t.fontFamily);
  return (
    <>
      <Field label="Font family">
        <select className="input" value={FONT_FAMILIES.includes(t.fontFamily) ? t.fontFamily : '__custom'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { if (e.target.value !== '__custom') { clearMeasureCache(); onChange({ fontFamily: e.target.value }); } }}>
          {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f.split(',')[0]}</option>)}
          {!FONT_FAMILIES.includes(t.fontFamily) && <option value="__custom">{t.fontFamily}</option>}
        </select>
      </Field>
      {!avail && <p className="hint warn">“{t.fontFamily.split(',')[0]}” is not installed here; a fallback font is shown and exported.</p>}
      <div className="grid2">
        <NumberField label="Font size" scrubLabel="Size" value={t.fontSize} min={1} max={2000} precision={1} unit="px" onChange={(fontSize) => onChange({ fontSize })} />
        <select className="input" aria-label="Font weight" value={t.fontWeight} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange({ fontWeight: Number(e.target.value) })}>
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w} {w === 400 ? 'Regular' : w === 700 ? 'Bold' : ''}</option>)}
        </select>
      </div>
      <div className="grid2">
        <Seg label="Font style" value={t.fontStyle} onChange={(fontStyle) => onChange({ fontStyle })} options={[{ value: 'normal', label: 'Normal' }, { value: 'italic', label: <em>Italic</em>, title: 'Italic' }]} />
        <Seg label="Alignment" value={t.align} onChange={(align) => onChange({ align })} options={[{ value: 'left', label: 'L', title: 'Align left' }, { value: 'center', label: 'C', title: 'Align center' }, { value: 'right', label: 'R', title: 'Align right' }]} />
      </div>
      <div className="grid3">
        <NumberField label="Line height" scrubLabel="LH" value={t.lineHeight} min={0.5} max={5} step={0.05} precision={2} onChange={(lineHeight) => onChange({ lineHeight })} />
        <NumberField label="Letter spacing" scrubLabel="LS" value={t.letterSpacing} min={-50} max={200} step={0.5} precision={1} onChange={(letterSpacing) => onChange({ letterSpacing })} />
        <NumberField label="Paragraph width (0 = auto)" scrubLabel="PW" value={t.width} min={0} max={100000} precision={0} onChange={(width) => onChange({ width })} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ tool sections

function ToolSection() {
  const s = useApp((st) => ({ tool: activeTool(st), o: st.toolOptions, fill: st.fill, stroke: st.stroke, ss: st.strokeStyle, zoom: st.viewport.zoom }));
  const setStyle = (patch: Partial<Style>) => {
    const { fill, stroke, fillRule: _fr, ...rest } = patch;
    void _fr;
    store.set((st) => ({ ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}), strokeStyle: { ...st.strokeStyle, ...rest } }));
  };
  const swatchStyle = { fill: s.fill, stroke: s.stroke, ...s.ss };
  switch (s.tool) {
    case 'brush': {
      const b = s.o.brush;
      return (
        <Section title="Brush" icon="brush">
          <PaintField label="Color (stroke swatch)" paint={s.stroke} onChange={(stroke) => store.set({ stroke })} allowNone={false} />
          <div className="grid2">
            <NumberField label="Base size" scrubLabel="Size" value={b.size} min={0.5} max={500} step={0.5} precision={1} unit="px" onChange={(size) => setToolOptions('brush', { size })} />
            <NumberField label="Opacity" scrubLabel="Op" value={Math.round(b.opacity * 100)} min={1} max={100} precision={0} unit="%" onChange={(v) => setToolOptions('brush', { opacity: v / 100 })} />
          </div>
          <Field label={`Smoothing · ${b.smoothing}`}>
            <input type="range" min={0} max={100} value={b.smoothing} aria-label="Smoothing" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToolOptions('brush', { smoothing: Number(e.target.value) })} />
          </Field>
          <Field label="Cap">
            <Seg label="Brush cap" value={b.cap} onChange={(cap) => setToolOptions('brush', { cap })} options={[{ value: 'round', label: 'Round' }, { value: 'butt', label: 'Flat' }]} />
          </Field>
          <Check label="Pressure sensitivity" checked={b.pressure.enabled} onChange={(enabled) => setToolOptions('brush', { pressure: { ...b.pressure, enabled } })} />
          {b.pressure.enabled && (
            <div className="grid2">
              <NumberField label="Minimum width at light pressure" scrubLabel="Min" value={Math.round(b.pressure.min * 100)} min={0} max={100} precision={0} unit="%" onChange={(v) => setToolOptions('brush', { pressure: { ...b.pressure, min: v / 100 } })} />
              <NumberField label="Maximum width at full pressure" scrubLabel="Max" value={Math.round(b.pressure.max * 100)} min={0} max={100} precision={0} unit="%" onChange={(v) => setToolOptions('brush', { pressure: { ...b.pressure, max: v / 100 } })} />
            </div>
          )}
          <Check label="Tilt affects width" checked={b.tilt.enabled} onChange={(enabled) => setToolOptions('brush', { tilt: { ...b.tilt, enabled } })} />
          {b.tilt.enabled && (
            <Field label={`Angle response · ${Math.round(b.tilt.response * 100)}%`}>
              <input type="range" min={0} max={100} value={Math.round(b.tilt.response * 100)} aria-label="Tilt angle response" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToolOptions('brush', { tilt: { ...b.tilt, response: Number(e.target.value) / 100 } })} />
            </Field>
          )}
          <p className="hint">Pressure and tilt apply only when your pen or Apple Pencil reports them. Mouse strokes use the base size.</p>
        </Section>
      );
    }
    case 'eraser': {
      const e = s.o.eraser;
      return (
        <Section title="Eraser" icon="eraser">
          <NumberField label="Size" scrubLabel="Size" value={e.size} min={1} max={500} precision={0} unit="px" onChange={(size) => setToolOptions('eraser', { size })} />
          <Field label="Behavior">
            <Seg label="Eraser behavior" value={e.mode} onChange={(mode) => setToolOptions('eraser', { mode })} options={[{ value: 'split', label: 'Split strokes' }, { value: 'delete', label: 'Delete objects' }]} />
          </Field>
          <Check label="Erase on all layers" checked={e.allLayers} onChange={(allLayers) => setToolOptions('eraser', { allLayers })} />
          <p className="hint">{e.mode === 'split' ? 'Cuts brush strokes where you sweep. Shapes, text and images are not affected — use Delete objects for those.' : 'Removes any object the eraser touches.'} Pixel erasing of imported images isn’t available in this version.</p>
        </Section>
      );
    }
    case 'shape': {
      const o = s.o.shape;
      return (
        <>
          <Section title="Shape" icon="shape">
            <Seg label="Shape type" value={o.type} onChange={(type) => setToolOptions('shape', { type })} options={[
              { value: 'rect', label: <Icon name="rect" size={16} />, title: 'Rectangle' }, { value: 'ellipse', label: <Icon name="ellipse" size={16} />, title: 'Ellipse' },
              { value: 'triangle', label: <Icon name="triangle" size={16} />, title: 'Triangle' }, { value: 'polygon', label: <Icon name="polygon" size={16} />, title: 'Polygon' },
            ]} />
            <div className="grid2">
              {o.type === 'polygon' && <NumberField label="Sides" scrubLabel="Sides" value={o.sides} min={3} max={64} precision={0} onChange={(sides) => setToolOptions('shape', { sides })} />}
              {o.type === 'rect' && <NumberField label="Corner radius" scrubLabel="R" value={o.cornerRadius} min={0} max={5000} precision={0} unit="px" onChange={(cornerRadius) => setToolOptions('shape', { cornerRadius })} />}
            </div>
          </Section>
          <StyleEditor title="New shape style" style={swatchStyle} onChange={setStyle} closed />
        </>
      );
    }
    case 'pen':
      return (
        <>
          <Section title="Pen" icon="pen">
            <Check label="Show Bézier handles" checked={s.o.pen.showHandles} onChange={(showHandles) => setToolOptions('pen', { showHandles })} />
            <p className="hint">Fill is applied only when you close the path by clicking its first point.</p>
          </Section>
          <StyleEditor title="New path style" style={swatchStyle} onChange={setStyle} closed />
        </>
      );
    case 'text':
      return (
        <>
          <Section title="Text" icon="text">
            <TextEditorFields t={s.o.text} onChange={(patch) => setToolOptions('text', patch)} />
          </Section>
          <Section title="New text fill"><PaintField label="Fill" paint={s.fill} onChange={(fill) => store.set({ fill })} /></Section>
        </>
      );
    case 'bucket':
      return (
        <Section title="Paint Bucket" icon="bucket">
          <PaintField label="Fill to apply" paint={s.fill} onChange={(fill) => store.set({ fill })} />
          <p className="hint">Fills closed vector shapes and closed paths with a solid, linear or radial fill. Filling arbitrary bitmap regions comes in a later version.</p>
        </Section>
      );
    case 'eyedropper':
      return (
        <Section title="Eyedropper" icon="eyedropper">
          <Field label="Sample into">
            <Seg label="Sample target" value={s.o.eyedropper.target} onChange={(target) => setToolOptions('eyedropper', { target })} options={[{ value: 'fill', label: 'Fill' }, { value: 'stroke', label: 'Stroke' }]} />
          </Field>
          <Check label="Sample all layers" checked={s.o.eyedropper.allLayers} onChange={(allLayers) => setToolOptions('eyedropper', { allLayers })} />
          <p className="hint">Off: samples only the active layer. Hold Alt to sample into the other swatch.</p>
        </Section>
      );
    case 'zoom':
    case 'hand':
      return (
        <Section title={s.tool === 'zoom' ? 'Zoom' : 'Hand'} icon={s.tool}>
          <div className="grid3">
            {[0.25, 0.5, 1, 2, 4, 8].map((z) => <button key={z} className="btn sm" aria-pressed={Math.abs(s.zoom - z) < 1e-3} onClick={() => setZoom(z)}>{z * 100}%</button>)}
          </div>
          <button className="btn" onClick={fitToStage}><Icon name="fit" size={16} /> Fit to stage</button>
        </Section>
      );
    default:
      return null;
  }
}

// ------------------------------------------------------------------ object sections

const PIVOTS: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];
const KIND_LABEL: Record<SceneObject['kind'], string> = { path: 'Path', shape: 'Shape', text: 'Text', bitmap: 'Bitmap', group: 'Group' };

function SingleObject({ o, frame, layerId }: { o: SceneObject; frame: number; layerId: string }) {
  const id = o.id;
  const smp = sampleObject(o, frame);
  const t = smp.transform;
  const b = cachedLocalBounds(o);
  const w = Math.abs(t.scaleX) * b.width, h = Math.abs(t.scaleY) * b.height;
  const upd = (label: string, fn: (x: SceneObject) => SceneObject) => commitMerge(label, (p) => mapObjects(p, [id], fn), [id]);
  const setT = (label: string, patch: Parameters<typeof setObjectTransform>[2], opacity?: number) => upd(label, (x) => setObjectTransform(x, frame, patch, opacity));
  const keyHere = o.keyframes.find((k) => k.frame === frame);
  const project = useApp((s) => s.project);
  const asset = o.kind === 'bitmap' ? project.assets.find((a) => a.id === o.assetRef) : undefined;
  const pivotUnit: [number, number] = [b.width ? (t.pivotX - b.x) / b.width : 0.5, b.height ? (t.pivotY - b.y) / b.height : 0.5];
  const setPivot = (u: [number, number]) => {
    const np: [number, number] = [b.x + b.width * u[0], b.y + b.height * u[1]];
    const d = applyVector(rotate(t.rotation), [t.scaleX * (np[0] - t.pivotX), t.scaleY * (np[1] - t.pivotY)]);
    // Move pivot without moving the artwork: shift position by the transformed pivot delta (all keys too).
    commit('Set pivot', (p) => mapObjects(p, [id], (x) => ({
      ...x,
      transform: { ...x.transform, pivotX: np[0], pivotY: np[1], x: x.transform.x + d[0], y: x.transform.y + d[1] },
      keyframes: x.keyframes.map((k) => {
        const dk = applyVector(rotate(k.rotation), [k.scaleX * (np[0] - t.pivotX), k.scaleY * (np[1] - t.pivotY)]);
        return { ...k, x: k.x + dk[0], y: k.y + dk[1] };
      }),
    })), [id]);
  };
  const [name, setName] = useState(o.name);
  useEffect(() => setName(o.name), [o.name, id]);

  return (
    <>
      <Section title="Object">
        <div className="row">
          <input className="input" aria-label="Object name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== o.name && upd('Rename object', (x) => ({ ...x, name: name.trim().slice(0, 200) }))}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
          <span className="badge accent">{KIND_LABEL[o.kind]}{o.kind === 'path' && o.brush ? ' · brush' : ''}</span>
        </div>
        <div className="row">
          <Check label="Visible" checked={o.visible} onChange={(v) => upd('Toggle visibility', (x) => ({ ...x, visible: v }))} />
          <Check label="Locked" checked={o.locked} onChange={(v) => { upd('Toggle lock', (x) => ({ ...x, locked: v })); if (v) store.set({ selection: [] }); }} />
        </div>
      </Section>
      <Section title="Transform">
        <div className="grid2">
          <NumberField label="X position" scrubLabel="X" value={t.x} precision={1} onChange={(x) => setT('Move', { x })} />
          <NumberField label="Y position" scrubLabel="Y" value={t.y} precision={1} onChange={(y) => setT('Move', { y })} />
          <NumberField label="Width" scrubLabel="W" value={w} min={0.01} precision={1} onChange={(v) => b.width && setT('Scale', { scaleX: Math.sign(t.scaleX || 1) * (v / b.width) })} />
          <NumberField label="Height" scrubLabel="H" value={h} min={0.01} precision={1} onChange={(v) => b.height && setT('Scale', { scaleY: Math.sign(t.scaleY || 1) * (v / b.height) })} />
          <NumberField label="Rotation" scrubLabel="∠" value={t.rotation} precision={1} unit="°" onChange={(rotation) => setT('Rotate', { rotation })} />
          <NumberField label="Opacity" scrubLabel="Op" value={Math.round(smp.opacity * 100)} min={0} max={100} precision={0} unit="%" onChange={(v) => setT('Opacity', {}, v / 100)} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <span className="field-label">Pivot</span>
            <div className="pivot-grid" role="group" aria-label="Pivot point">
              {PIVOTS.map((u, i) => (
                <button key={i} aria-label={`Pivot ${['top left', 'top', 'top right', 'left', 'center', 'right', 'bottom left', 'bottom', 'bottom right'][i]}`}
                  aria-pressed={Math.abs(pivotUnit[0] - u[0]) < 0.01 && Math.abs(pivotUnit[1] - u[1]) < 0.01} onClick={() => setPivot(u)} />
              ))}
            </div>
          </div>
          <div className="row">
            <button className="icon-btn sm" aria-label="Flip horizontal" data-tip="Flip horizontal" data-tip-pos="bottom" onClick={() => flipSelection('h')}><Icon name="flipH" size={16} /></button>
            <button className="icon-btn sm" aria-label="Flip vertical" data-tip="Flip vertical" data-tip-pos="bottom" onClick={() => flipSelection('v')}><Icon name="flipV" size={16} /></button>
            <button className="btn sm" onClick={() => setT('Reset transform', { rotation: 0, scaleX: 1, scaleY: 1 }, 1)}>Reset</button>
          </div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => arrange('front')} aria-label="Bring to front">Front</button>
          <button className="btn sm" onClick={() => arrange('forward')} aria-label="Bring forward">Forward</button>
          <button className="btn sm" onClick={() => arrange('backward')} aria-label="Send backward">Backward</button>
          <button className="btn sm" onClick={() => arrange('back')} aria-label="Send to back">Back</button>
        </div>
      </Section>
      <Section title="Animation" icon="keyframe">
        <p className="hint">
          {o.keyframes.length === 0 ? 'Not animated. Add a keyframe or create a motion tween; edits then key automatically at the playhead.'
            : keyHere ? `Keyframe at frame ${frame + 1}. Edits update this key.` : `Interpolated at frame ${frame + 1}. Editing here adds a keyframe.`}
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={cmdCreateTween}><Icon name="tween" size={14} /> Create tween</button>
          {keyHere ? <button className="btn sm" onClick={cmdRemoveKeyframe}>Remove key <kbd>{formatKeys(['Shift+F9'])}</kbd></button>
            : <button className="btn sm" onClick={cmdAddKeyframe}>Add key <kbd>{formatKeys(['F9'])}</kbd></button>}
        </div>
        {keyHere && (
          <Field label="Ease to next key">
            <select className="input" value={keyHere.ease} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => upd('Set ease', (x) => setKeyframeEase(x, frame, e.target.value as Ease))}>
              <option value="linear">Linear</option><option value="easeIn">Ease in</option><option value="easeOut">Ease out</option><option value="easeInOut">Ease in-out</option>
            </select>
          </Field>
        )}
        {o.keyframes.length > 0 && (
          <div className="key-chips" aria-label="Keyframes">
            {o.keyframes.map((k) => <button key={k.frame} aria-current={k.frame === frame} aria-label={`Go to keyframe at frame ${k.frame + 1}`} onClick={() => goToFrame(k.frame)}>◆ {k.frame + 1}</button>)}
          </div>
        )}
      </Section>
      {o.kind === 'shape' && (
        <Section title="Shape">
          <Seg label="Shape type" value={o.geometry.shape} onChange={(shape) => upd('Change shape', (x) => (x.kind === 'shape' ? { ...x, geometry: { ...x.geometry, shape } } : x))} options={[
            { value: 'rect', label: <Icon name="rect" size={16} />, title: 'Rectangle' }, { value: 'ellipse', label: <Icon name="ellipse" size={16} />, title: 'Ellipse' },
            { value: 'triangle', label: <Icon name="triangle" size={16} />, title: 'Triangle' }, { value: 'polygon', label: <Icon name="polygon" size={16} />, title: 'Polygon' },
          ]} />
          <div className="grid2">
            {o.geometry.shape === 'polygon' && <NumberField label="Sides" scrubLabel="Sides" value={o.geometry.sides} min={3} max={64} precision={0} onChange={(sides) => upd('Polygon sides', (x) => (x.kind === 'shape' ? { ...x, geometry: { ...x.geometry, sides } } : x))} />}
            {o.geometry.shape === 'rect' && <NumberField label="Corner radius" scrubLabel="R" value={o.geometry.cornerRadius} min={0} precision={0} unit="px" onChange={(cornerRadius) => upd('Corner radius', (x) => (x.kind === 'shape' ? { ...x, geometry: { ...x.geometry, cornerRadius } } : x))} />}
          </div>
        </Section>
      )}
      {o.kind === 'text' && (
        <Section title="Typography">
          <TextEditorFields t={o.text} onChange={(patch) => upd('Edit typography', (x) => (x.kind === 'text' ? { ...x, text: { ...x.text, ...patch } } : x))} />
          <button className="btn sm" onClick={() => store.set({ editingTextId: id })}>Edit text…</button>
        </Section>
      )}
      {(o.kind === 'path' || o.kind === 'shape') && (
        <StyleEditor style={o.style} closed={o.kind === 'shape' || o.geometry.closed} onChange={(patch) => upd('Edit style', (x) => ({ ...x, style: { ...x.style, ...patch } }))}
          title={o.kind === 'path' && o.brush ? 'Brush stroke color (fill)' : 'Appearance'} />
      )}
      {o.kind === 'text' && (
        <StyleEditor style={o.style} closed onChange={(patch) => upd('Edit style', (x) => ({ ...x, style: { ...x.style, ...patch } }))} />
      )}
      {o.kind === 'path' && o.brush && (
        <Section title="Brush data">
          <p className="hint">{o.brush.samples.length} samples · pressure {o.brush.hasPressure ? 'recorded' : 'not reported by device'} · tilt {o.brush.hasTilt ? 'recorded' : 'not reported'} · smoothing {o.brush.settings.smoothing}</p>
        </Section>
      )}
      {o.kind === 'bitmap' && asset && (
        <Section title="Bitmap asset" icon="image">
          <p className="hint">{asset.name}<br />{asset.width} × {asset.height}px · {asset.mime.replace('image/', '').toUpperCase()} · {(asset.byteLength / 1024).toFixed(0)} KB<br />Stored offline in this browser; the original bytes are kept unchanged.</p>
          <button className="btn sm" onClick={() => setT('Reset to original size', { scaleX: 1, scaleY: 1, rotation: 0 })}>Original size (100%)</button>
        </Section>
      )}
      <LayerInfo layerId={layerId} />
    </>
  );
}

function MultiObject({ objs, frame }: { objs: { o: SceneObject }[]; frame: number }) {
  const ids = objs.map((x) => x.o.id);
  const boxes = objs.map(({ o }) => { const smp = sampleObject(o, frame); return transformRect(transformMatrix(smp.transform), cachedLocalBounds(o)); });
  const u = unionRects(boxes)!;
  const kinds = [...new Set(objs.map(({ o }) => KIND_LABEL[o.kind]))].join(', ');
  const moveAll = (dx: number, dy: number) => commitMerge('Move', (p) => mapObjects(p, ids, (x) => { const t = sampleObject(x, frame).transform; return setObjectTransform(x, frame, { x: t.x + dx, y: t.y + dy }); }), ids);
  const scaleAll = (fx: number, fy: number) => commitMerge('Scale', (p) => mapObjects(p, ids, (x) => {
    const t = sampleObject(x, frame).transform;
    return setObjectTransform(x, frame, { x: u.x + (t.x - u.x) * fx, y: u.y + (t.y - u.y) * fy, scaleX: t.scaleX * fx, scaleY: t.scaleY * fy });
  }), ids);
  const opac = objs.map(({ o }) => sampleObject(o, frame).opacity);
  const same = opac.every((v) => Math.abs(v - opac[0]) < 1e-6);
  const vector = objs.filter(({ o }) => o.kind === 'path' || o.kind === 'shape' || o.kind === 'text');
  const first = vector[0]?.o;
  return (
    <>
      <Section title={`${objs.length} objects`}>
        <p className="hint">{kinds}</p>
        <div className="grid2">
          <NumberField label="Selection X" scrubLabel="X" value={u.x} precision={1} onChange={(v) => moveAll(v - u.x, 0)} />
          <NumberField label="Selection Y" scrubLabel="Y" value={u.y} precision={1} onChange={(v) => moveAll(0, v - u.y)} />
          <NumberField label="Selection width" scrubLabel="W" value={u.width} min={0.01} precision={1} onChange={(v) => u.width && scaleAll(v / u.width, 1)} />
          <NumberField label="Selection height" scrubLabel="H" value={u.height} min={0.01} precision={1} onChange={(v) => u.height && scaleAll(1, v / u.height)} />
        </div>
        <NumberField label="Opacity (all)" scrubLabel="Op" value={same ? Math.round(opac[0] * 100) : null} min={0} max={100} precision={0} unit="%"
          onChange={(v) => commitMerge('Opacity', (p) => mapObjects(p, ids, (x) => setObjectTransform(x, frame, {}, v / 100)), ids)} />
        <div className="row">
          <button className="btn sm" onClick={() => arrange('front')}>Front</button>
          <button className="btn sm" onClick={() => arrange('back')}>Back</button>
          <button className="btn sm" onClick={() => flipSelection('h')}>Flip H</button>
          <button className="btn sm" onClick={() => flipSelection('v')}>Flip V</button>
        </div>
        <button className="btn sm" onClick={cmdAddKeyframe}><Icon name="keyframe" size={14} /> Add keyframe to all</button>
      </Section>
      {first && (
        <StyleEditor title={`Appearance (${vector.length} vector)`} style={first.style} closed onChange={(patch) => commitMerge('Edit style', (p) => mapObjects(p, vector.map((x) => x.o.id), (x) => ({ ...x, style: { ...x.style, ...patch } })), ids)} />
      )}
    </>
  );
}

// ------------------------------------------------------------------ document + layer

function LayerInfo({ layerId }: { layerId: string }) {
  const layer = useApp((s) => s.project.layers.find((l) => l.id === layerId));
  const frame = useApp((s) => s.currentFrame);
  if (!layer) return null;
  const e = exposureAt(layer, frame);
  return (
    <Section title={`Layer · ${layer.name}`}>
      <Field label="Blend mode">
        <select className="input" value={layer.blendMode} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => commit('Blend mode', (p) => ({ ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, blendMode: ev.target.value as BlendMode } : l)) }))}>
          {BLEND_MODES.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1).replace('-', ' ')}</option>)}
        </select>
      </Field>
      <p className="hint">{e ? `Frame ${frame + 1} shows the drawing held from frame ${e.startFrame + 1} to ${e.endFrame + 1}.` : `Frame ${frame + 1} is empty on this layer. Drawing here creates a new keyframe.`}{layer.locked ? ' Layer is locked.' : ''}</p>
    </Section>
  );
}

function FpsPicker() {
  const fps = useApp((s) => s.project.fps);
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
      {FPS_PRESETS.map((f) => <button key={f} className="btn sm" aria-pressed={f === fps} style={f === fps ? { borderColor: 'var(--accent)', color: 'var(--accent-strong)' } : undefined} onClick={() => commit('Frame rate', (p) => (p.fps === f ? p : { ...p, fps: f }))}>{f}</button>)}
    </div>
  );
}

function DocumentSection() {
  const p = useApp((s) => ({ w: s.project.width, h: s.project.height, fps: s.project.fps, dur: s.project.durationFrames, bg: s.project.background, onion: s.project.preferences, active: s.activeLayerId }));
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeBtn = useRef<HTMLButtonElement | null>(null);
  const bgPaint: Paint = p.bg ? { type: 'solid', color: p.bg } : { type: 'none' };
  return (
    <>
      <Section title="Document">
        <div className="row">
          <button ref={sizeBtn} className="btn" style={{ flex: 1 }} aria-haspopup="dialog" onClick={() => setSizeOpen(!sizeOpen)}>{p.w} × {p.h} px</button>
          {sizeOpen && <DocSizePopover anchor={sizeBtn.current} onClose={() => setSizeOpen(false)} />}
        </div>
        <Field label="Frame rate (fps)">
          <NumberField label="Frames per second" scrubLabel="FPS" value={p.fps} min={1} max={120} precision={0} onChange={(fps) => commitMerge('Frame rate', (pr) => ({ ...pr, fps: Math.round(fps) }))} />
        </Field>
        <FpsPicker />
        <div className="grid2">
          <NumberField label="Duration in frames" scrubLabel="Frames" value={p.dur} min={1} max={100000} precision={0} onChange={(v) => commitMerge('Duration', (pr) => {
            const minDur = Math.max(1, ...pr.layers.flatMap((l) => l.exposureTrack.map((e) => e.endFrame + 1)));
            return { ...pr, durationFrames: Math.max(minDur, Math.round(v)) };
          })} />
          <div className="field"><span>Length</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{(p.dur / p.fps).toFixed(2)} s</span></div>
        </div>
        <PaintField label="Background" paint={bgPaint} onChange={(pt) => commitMerge('Background', (pr) => ({ ...pr, background: pt.type === 'solid' ? pt.color : pt.type === 'none' ? null : pt.stops[0].color }))} />
        <p className="hint">Choose None for a transparent background (shown as a checkerboard; kept in PNG, GIF and SVG exports).</p>
      </Section>
      <Section title="Onion skin" icon="onion">
        <Check label="Show neighboring frames" checked={p.onion.onionSkin} onChange={(onionSkin) => setPref({ onionSkin })} />
        <div className="grid2">
          <NumberField label="Frames before" scrubLabel="Before" value={p.onion.onionBefore} min={0} max={10} precision={0} onChange={(onionBefore) => setPref({ onionBefore })} />
          <NumberField label="Frames after" scrubLabel="After" value={p.onion.onionAfter} min={0} max={10} precision={0} onChange={(onionAfter) => setPref({ onionAfter })} />
        </div>
      </Section>
      <LayerInfo layerId={p.active} />
    </>
  );
}

// ------------------------------------------------------------------ panel

export function PropertiesPanel() {
  const s = useApp((st) => ({ tool: activeTool(st), selection: st.selection, project: st.project, frame: st.currentFrame, playing: st.playing }));
  const objs = s.selection.flatMap((id) => { const loc = locateObject(s.project, id); return loc ? [{ o: loc.object, layerId: loc.layer.id }] : []; });
  const toolHasOptions = !['select', 'transform'].includes(s.tool);
  const title = objs.length === 1 ? `${KIND_LABEL[objs[0].o.kind]} properties` : objs.length > 1 ? 'Multiple selection' : toolHasOptions ? 'Tool properties' : 'Document';
  void getState;
  return (
    <aside className="props" aria-label="Properties">
      <div className="props-header">{title}{s.playing && <span className="badge">Playing</span>}</div>
      {toolHasOptions && <ToolSection />}
      {objs.length === 1 && <SingleObject o={objs[0].o} frame={s.frame} layerId={objs[0].layerId} />}
      {objs.length > 1 && <MultiObject objs={objs} frame={s.frame} />}
      {objs.length === 0 && !toolHasOptions && <DocumentSection />}
      {objs.length === 0 && toolHasOptions && <LayerInfo layerId={getState().activeLayerId} />}
    </aside>
  );
}
