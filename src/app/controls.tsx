// Reusable accessible controls: numeric fields with scrubbing, segmented choices, paint chips, popovers.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cssColor, normalizeHexInput, paintPreviewCss, parseHex, toHex6, toHex8, withAlpha } from '../domain/color';
import type { ColorStop, Paint } from '../domain/schema';
import { pushRecentColor, useApp } from '../editor/state';
import { Icon } from './icons';

// ------------------------------------------------------------------ NumberField

/** Safe arithmetic for numeric fields ("100*2", "45+10", "(1920-40)/2"). No eval. */
export function evalArithmetic(src: string): number {
  const toks = src.match(/\d*\.?\d+|[-+*/()]/g);
  if (!toks || toks.join('') !== src.replace(/\s+/g, '')) return NaN;
  let i = 0;
  const peek = () => toks[i];
  const factor = (): number => {
    const t = toks[i++];
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') { const v = expr(); if (toks[i++] !== ')') return NaN; return v; }
    return Number(t);
  };
  const term = (): number => {
    let v = factor();
    while (peek() === '*' || peek() === '/') { const op = toks[i++]; const r = factor(); v = op === '*' ? v * r : v / r; }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = toks[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  const v = expr();
  return i === toks.length ? v : NaN;
}

export function NumberField(props: {
  label: string; value: number | null; onChange: (v: number) => void; min?: number; max?: number; step?: number;
  precision?: number; unit?: string; scrubLabel?: string; disabled?: boolean; title?: string;
}) {
  const { label, value, onChange, min = -Infinity, max = Infinity, step = 1, precision = 2, unit, scrubLabel, disabled } = props;
  const fmt = (v: number | null) => (v === null || Number.isNaN(v) ? '' : String(+v.toFixed(precision)));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const id = useId();
  useEffect(() => { if (!focused) setText(fmt(value)); }, [value, focused]);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commitText = () => {
    // allow simple arithmetic like "100*2" or "45+10"
    const t = text.trim();
    if (!t) { setText(fmt(value)); return; }
    let v = Number(t);
    if (Number.isNaN(v)) v = evalArithmetic(t);
    if (Number.isFinite(v)) { const c = clamp(v); onChange(c); setText(fmt(c)); } else setText(fmt(value));
  };
  const scrub = useRef<{ x: number; v: number } | null>(null);
  return (
    <label className="num" title={props.title ?? label} htmlFor={id} aria-disabled={disabled}>
      <span
        className="scrub"
        aria-hidden="true"
        onPointerDown={(e: React.PointerEvent<HTMLSpanElement>) => {
          if (disabled || value === null) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e: React.PointerEvent<HTMLSpanElement>) => {
          if (!scrub.current) return;
          const dx = e.clientX - scrub.current.x;
          const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          onChange(clamp(+(scrub.current.v + Math.round(dx / 2) * step * k).toFixed(precision)));
        }}
        onPointerUp={() => { scrub.current = null; }}
      >{scrubLabel ?? label}</span>
      <span className="sr-only">{label}</span>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={label}
        onFocus={(e: React.FocusEvent<HTMLInputElement>) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={() => { setFocused(false); commitText(); }}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') { commitText(); (e.currentTarget as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setText(fmt(value)); (e.currentTarget as HTMLInputElement).blur(); }
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== null) {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clamp(+(value + d).toFixed(precision));
            onChange(v); setText(fmt(v));
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ Segmented

export function Seg<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: React.ReactNode; title?: string; tip?: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} aria-label={o.title} data-tip={o.title} data-tip-desc={o.tip}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><span>{label}</span>{children}</div>;
}

// ------------------------------------------------------------------ Paint chip + popover

export function PaintSwatch({ paint }: { paint: Paint }) {
  return paint.type === 'none' ? <i className="none-slash" /> : <i style={{ background: paintPreviewCss(paint) }} />;
}

export function describePaint(p: Paint): string {
  if (p.type === 'none') return 'None';
  if (p.type === 'solid') { const a = parseHex(p.color).a; return `${toHex6(p.color)}${a < 1 ? ` · ${Math.round(a * 100)}%` : ''}`; }
  return `${p.type === 'linear' ? 'Linear' : 'Radial'} gradient · ${p.stops.length} stops`;
}

export function PaintField({ label, paint, onChange, allowNone = true }: { label: string; paint: Paint; onChange: (p: Paint) => void; allowNone?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="paint-field">
      <button ref={btn} type="button" className="paint-chip" aria-label={`${label}: ${describePaint(paint)}. Open color editor`} aria-haspopup="dialog"
        data-tip={label} data-tip-desc={`Currently ${describePaint(paint)}. Click to choose a solid color, a gradient or none.`} aria-expanded={open}
        onClick={() => setOpen(!open)}><PaintSwatch paint={paint} /></button>
      <div className="field" style={{ flex: 1 }}>
        <span>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text)' }}>{describePaint(paint)}</span>
      </div>
      {open && <ColorPopover anchor={btn.current} title={label} paint={paint} onChange={onChange} onClose={() => setOpen(false)} allowNone={allowNone} />}
    </div>
  );
}

export function usePopoverPosition(anchor: HTMLElement | null, ref: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!anchor || !el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = a.right + 8, top = a.top;
    if (left + w > window.innerWidth - 8) left = a.left - w - 8;
    if (left < 8) left = Math.min(window.innerWidth - w - 8, Math.max(8, a.left));
    if (left === a.left || left < a.left && left + w > a.left) top = a.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor]);
  return pos;
}

/** Closes a popover on outside pointerdown or Escape. Pass `active = false` while it is closed, or it swallows Escape. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, anchor?: HTMLElement | null, active = true) {
  useEffect(() => {
    if (!active) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor?.focus(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [onClose, anchor, active]);
}

const DEFAULT_STOPS: ColorStop[] = [{ offset: 0, color: '#3CC8D6FF' }, { offset: 1, color: '#9B7BF2FF' }];

export function ColorPopover({ anchor, title, paint, onChange, onClose, allowNone = true }: {
  anchor: HTMLElement | null; title: string; paint: Paint; onChange: (p: Paint) => void; onClose: () => void; allowNone?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const pos = usePopoverPosition(anchor, ref);
  useDismiss(ref, onClose, anchor);
  const recent = useApp((s) => s.recentColors);
  const [stopIdx, setStopIdx] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus(); }, []);

  const lastSolid = useRef<string>(paint.type === 'solid' ? paint.color : '#3CC8D6FF');
  if (paint.type === 'solid') lastSolid.current = paint.color;
  const stops = paint.type === 'linear' || paint.type === 'radial' ? paint.stops : null;
  const sel = stops ? stops[Math.min(stopIdx, stops.length - 1)] : null;
  const activeColor = paint.type === 'solid' ? paint.color : sel ? sel.color : lastSolid.current;

  const setType = (t: Paint['type']) => {
    if (t === paint.type) return;
    if (t === 'none') onChange({ type: 'none' });
    else if (t === 'solid') onChange({ type: 'solid', color: stops ? stops[0].color : lastSolid.current });
    else {
      const st = stops ?? [{ offset: 0, color: lastSolid.current }, { offset: 1, color: DEFAULT_STOPS[1].color }];
      onChange(t === 'linear' ? { type: 'linear', stops: st, angle: paint.type === 'linear' ? paint.angle : 0 } : { type: 'radial', stops: st });
    }
  };
  const setColor = (hex: string) => {
    if (paint.type === 'solid' || paint.type === 'none') onChange({ type: 'solid', color: hex });
    else if (stops) onChange({ ...paint, stops: stops.map((s, i) => (i === stopIdx ? { ...s, color: hex } : s)) } as Paint);
  };
  const setStops = (next: ColorStop[]) => { if (paint.type === 'linear' || paint.type === 'radial') onChange({ ...paint, stops: next }); };
  const moveStop = (i: number, offset: number) => {
    if (!stops) return;
    setStops(stops.map((s, j) => (j === i ? { ...s, offset: Math.min(1, Math.max(0, +offset.toFixed(3))) } : s)));
  };
  const { a } = parseHex(activeColor);
  const [hexText, setHexText] = useState(activeColor);
  useEffect(() => setHexText(activeColor), [activeColor]);

  return (
    <div ref={ref} className="popover" role="dialog" aria-label={`${title} color`} style={{ left: pos.left, top: pos.top }}>
      <h4>{title}<button className="icon-btn sm" aria-label="Close color editor" data-tip-desc="Close the color editor. Your changes are already applied." onClick={onClose}><Icon name="close" size={16} /></button></h4>
      <Seg label="Paint type" value={paint.type} onChange={setType} options={[
        ...(allowNone ? [{ value: 'none' as const, label: 'None', tip: 'No color: leaves the fill empty or hides the outline.' }] : []),
        { value: 'solid' as const, label: 'Solid', tip: 'One flat color.' },
        { value: 'linear' as const, label: 'Linear', tip: 'A gradient that blends colors along a straight line at an angle you choose.' },
        { value: 'radial' as const, label: 'Radial', tip: 'A gradient that blends colors outward from the center.' },
      ]} />
      {stops && (
        <div>
          <div
            ref={barRef}
            className="grad-bar"
            style={{ background: `linear-gradient(90deg, ${[...stops].sort((x, y) => x.offset - y.offset).map((s) => `${cssColor(s.color)} ${s.offset * 100}%`).join(',')})` }}
            title="Click to add a color stop"
            onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
              if (e.target !== barRef.current || stops.length >= 16) return;
              const r = barRef.current!.getBoundingClientRect();
              const off = (e.clientX - r.left) / r.width;
              setStops([...stops, { offset: +off.toFixed(3), color: activeColor }]);
              setStopIdx(stops.length);
            }}
          >
            {stops.map((s, i) => (
              <button
                key={i}
                type="button"
                className="grad-stop"
                aria-pressed={i === stopIdx}
                aria-label={`Color stop ${i + 1} at ${Math.round(s.offset * 100)}%. Arrow keys move, Delete removes`}
                data-tip={`Color stop ${i + 1}`} data-tip-desc="Click to edit this stop's color; drag to move it along the gradient." 
                style={{ left: `${s.offset * 100}%`, background: cssColor(s.color) }}
                onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  setStopIdx(i);
                  const el = e.currentTarget as HTMLElement;
                  el.setPointerCapture(e.pointerId);
                  const r = barRef.current!.getBoundingClientRect();
                  const mv = (ev: PointerEvent) => moveStop(i, (ev.clientX - r.left) / r.width);
                  const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
                  el.addEventListener('pointermove', mv);
                  el.addEventListener('pointerup', up);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
                  const d = e.shiftKey ? 0.1 : 0.01;
                  if (e.key === 'ArrowLeft') { e.preventDefault(); moveStop(i, s.offset - d); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); moveStop(i, s.offset + d); }
                  if ((e.key === 'Delete' || e.key === 'Backspace') && stops.length > 2) {
                    e.preventDefault(); setStops(stops.filter((_, j) => j !== i)); setStopIdx(0);
                  }
                }}
              />
            ))}
          </div>
          <div className="row">
            <NumberField label="Stop position" scrubLabel="Pos" value={sel ? sel.offset * 100 : 0} unit="%" min={0} max={100} precision={0} onChange={(v) => moveStop(stopIdx, v / 100)} />
            {paint.type === 'linear' && <NumberField label="Gradient angle" scrubLabel="∠" value={paint.angle} unit="°" min={-360} max={360} precision={0} onChange={(v) => onChange({ ...paint, angle: v })} />}
            <button className="icon-btn sm" aria-label="Remove selected stop" data-tip-desc="Delete the selected color stop. A gradient needs at least two." disabled={stops.length <= 2} onClick={() => { setStops(stops.filter((_, j) => j !== stopIdx)); setStopIdx(0); }}><Icon name="trash" size={16} /></button>
          </div>
        </div>
      )}
      {paint.type !== 'none' && (
        <>
          <div className="color-area">
            <input className="color-native" type="color" aria-label="Pick color" value={toHex6(activeColor).toLowerCase()}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(withAlpha(e.target.value + 'ff', a))} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input className="input" aria-label="Hex color (RGB or RGBA)" value={hexText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHexText(e.target.value)}
                onBlur={() => { const h = normalizeHexInput(hexText); if (h) { setColor(h); pushRecentColor(h); } else setHexText(activeColor); }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
              <NumberField label="Alpha" scrubLabel="A" value={Math.round(a * 100)} unit="%" min={0} max={100} precision={0}
                onChange={(v) => setColor(withAlpha(activeColor, v / 100))} />
            </div>
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: 4 }}>Recent</div>
            <div className="recent">
              {recent.map((c) => (
                <button key={c} type="button" aria-label={`Use ${toHex6(c)}`} data-tip={`Use ${c}`} data-tip-desc="Apply this recently used color."  onClick={() => { setColor(c); pushRecentColor(c); }}
                  style={{ background: '#fff' }}><i style={{ background: cssColor(c) }} /></button>
              ))}
            </div>
          </div>
          <button className="btn sm" data-tip-desc="Save the current color to the Recent row for quick reuse." onClick={() => { pushRecentColor(toHex8(parseHex(activeColor))); }}>Add to recent</button>
        </>
      )}
    </div>
  );
}
