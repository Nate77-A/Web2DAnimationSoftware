import { useEffect, useRef, useState } from 'react';
import { activeTool, setToolOptions, store, useApp, type ShapeTool } from '../editor/state';
import { setTool, TOOL_LIST } from '../editor/tools';
import { ColorPopover, describePaint, PaintSwatch, useDismiss } from './controls';
import { SHAPE_CHOICES } from './shapeChoices';
import { Icon } from './icons';
import { formatKeys } from './commands';

export function ToolRail() {
  const s = useApp((st) => ({ tool: st.tool, active: activeTool(st), fill: st.fill, stroke: st.stroke, shape: st.toolOptions.shape.type }));
  const [shapeMenu, setShapeMenu] = useState<DOMRect | null>(null);
  const holdTimer = useRef(0);
  const suppressClick = useRef(false);
  const shapeIcon = SHAPE_CHOICES.find((c) => c.value === s.shape)?.icon ?? 'shape';
  /** Shape tool: press and hold (or right-click) for every shape. */
  const holdProps = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      const el = e.currentTarget as HTMLButtonElement;
      clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => { suppressClick.current = true; setShapeMenu(el.getBoundingClientRect()); }, 450);
    },
    onPointerUp: () => clearTimeout(holdTimer.current),
    onPointerLeave: () => clearTimeout(holdTimer.current),
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => { e.preventDefault(); setShapeMenu((e.currentTarget as HTMLButtonElement).getBoundingClientRect()); },
  };
  const [pop, setPop] = useState<'fill' | 'stroke' | null>(null);
  const fillBtn = useRef<HTMLButtonElement | null>(null);
  const strokeBtn = useRef<HTMLButtonElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = Array.from(railRef.current!.querySelectorAll<HTMLButtonElement>('button.tool'));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  };

  return (
    <nav className="rail" role="toolbar" aria-orientation="vertical" aria-label="Tools" ref={railRef} onKeyDown={onKey}>
      {TOOL_LIST.map((t, i) => (
        <span key={t.id} style={{ display: 'contents' }}>
          {i > 0 && (t.id === 'brush' || t.id === 'eyedropper') && <div className="rail-sep" aria-hidden="true" />}
          <button
            className={`icon-btn tool${t.id === 'shape' ? ' has-flyout' : ''}`}
            aria-label={`${t.label} (${t.shortcut})`}
            aria-haspopup={t.id === 'shape' ? 'menu' : undefined}
            {...(t.id === 'shape' ? holdProps : {})}
            aria-pressed={s.tool === t.id}
            data-tip={t.label}
            data-tip-keys={t.shortcut}
            data-tip-desc={t.id === 'shape' ? `${t.help} Press and hold for every shape.` : t.help}
            data-tip-pos="right"
            tabIndex={s.tool === t.id ? 0 : -1}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setTool(t.id); }}
            style={s.active === t.id && s.tool !== t.id ? { outline: '1px dashed var(--accent)' } : undefined}
          >
            <Icon name={t.id === 'shape' ? shapeIcon : t.id} size={22} />
          </button>
        </span>
      ))}
      <div className="rail-sep" aria-hidden="true" />
      <div className="swatches">
        <button ref={fillBtn} className="swatch-btn fill" aria-label={`Fill color: ${describePaint(s.fill)}`} data-tip="Fill color" data-tip-desc="Color used inside new shapes, text and paint-bucket fills. Click to change it." data-tip-pos="right" aria-haspopup="dialog" aria-expanded={pop === 'fill'}
          onClick={() => setPop(pop === 'fill' ? null : 'fill')}><PaintSwatch paint={s.fill} /></button>
        <button ref={strokeBtn} className="swatch-btn stroke" aria-label={`Stroke color: ${describePaint(s.stroke)}`} data-tip="Stroke color" data-tip-desc="Color used for outlines and brush strokes. Click to change it." data-tip-pos="right" aria-haspopup="dialog" aria-expanded={pop === 'stroke'}
          onClick={() => setPop(pop === 'stroke' ? null : 'stroke')}><PaintSwatch paint={s.stroke} /></button>
      </div>
      <div className="swatch-mini-row">
        <button className="icon-btn sm" aria-label={`Swap fill and stroke (${formatKeys(['X'])})`} data-tip="Swap colors" data-tip-keys="X" data-tip-desc="Exchange the fill and stroke colors." data-tip-pos="right" onClick={() => store.set({ fill: s.stroke, stroke: s.fill })}><Icon name="swap" size={14} /></button>
      </div>
      {shapeMenu && (
        <ShapeFlyout anchor={shapeMenu} current={s.shape} onClose={() => setShapeMenu(null)}
          onPick={(type) => { setShapeMenu(null); setToolOptions('shape', { type }); setTool('shape'); }} />
      )}
      {pop === 'fill' && <ColorPopover anchor={fillBtn.current} title="Fill" paint={s.fill} onChange={(p) => store.set({ fill: p })} onClose={() => setPop(null)} />}
      {pop === 'stroke' && <ColorPopover anchor={strokeBtn.current} title="Stroke" paint={s.stroke} onChange={(p) => store.set({ stroke: p })} onClose={() => setPop(null)} />}
    </nav>
  );
}

/** Pop-up beside the Shape tool listing every shape it can draw. */
function ShapeFlyout({ anchor, current, onPick, onClose }: { anchor: DOMRect; current: ShapeTool; onPick: (t: ShapeTool) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, onClose);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }, []);
  const top = Math.max(8, Math.min(window.innerHeight - 8 - SHAPE_CHOICES.length * 34 - 40, anchor.top - 8));
  return (
    <div ref={ref} className="shape-flyout" role="menu" aria-label="Shapes" style={{ left: anchor.right + 8, top }}
      onKeyDown={(e: React.KeyboardEvent) => {
        const items = Array.from(ref.current!.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      }}>
      <div className="tl-menu-title">Shapes</div>
      {SHAPE_CHOICES.map((c) => (
        <button key={c.value} type="button" role="menuitemradio" aria-checked={c.value === current} data-tip={c.title} data-tip-desc={c.tip} data-tip-pos="right"
          onClick={() => onPick(c.value)}>
          <Icon name={c.icon} size={18} /><span>{c.title}</span>
          {c.value === current && <Icon name="check" size={14} className="flyout-check" />}
        </button>
      ))}
    </div>
  );
}
