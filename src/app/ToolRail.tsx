import { useRef, useState } from 'react';
import { activeTool, store, useApp } from '../editor/state';
import { setTool, TOOL_LIST } from '../editor/tools';
import { ColorPopover, describePaint, PaintSwatch } from './controls';
import { Icon } from './icons';
import { formatKeys } from './commands';

export function ToolRail() {
  const s = useApp((st) => ({ tool: st.tool, active: activeTool(st), fill: st.fill, stroke: st.stroke }));
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
          {(i === 2 || i === 8) && <div className="rail-sep" aria-hidden="true" />}
          <button
            className="icon-btn tool"
            aria-label={`${t.label} (${t.shortcut})`}
            aria-pressed={s.tool === t.id}
            data-tip={`${t.label}  ${t.shortcut}`}
            tabIndex={s.tool === t.id ? 0 : -1}
            onClick={() => setTool(t.id)}
            style={s.active === t.id && s.tool !== t.id ? { outline: '1px dashed var(--accent)' } : undefined}
          >
            <Icon name={t.id} size={22} />
          </button>
        </span>
      ))}
      <div className="rail-sep" aria-hidden="true" />
      <div className="swatches">
        <button ref={fillBtn} className="swatch-btn fill" aria-label={`Fill color: ${describePaint(s.fill)}`} data-tip="Fill" aria-haspopup="dialog" aria-expanded={pop === 'fill'}
          onClick={() => setPop(pop === 'fill' ? null : 'fill')}><PaintSwatch paint={s.fill} /></button>
        <button ref={strokeBtn} className="swatch-btn stroke" aria-label={`Stroke color: ${describePaint(s.stroke)}`} data-tip="Stroke (also brush color)" aria-haspopup="dialog" aria-expanded={pop === 'stroke'}
          onClick={() => setPop(pop === 'stroke' ? null : 'stroke')}><PaintSwatch paint={s.stroke} /></button>
      </div>
      <div className="swatch-mini-row">
        <button className="icon-btn sm" aria-label={`Swap fill and stroke (${formatKeys(['X'])})`} data-tip="Swap  X" onClick={() => store.set({ fill: s.stroke, stroke: s.fill })}><Icon name="swap" size={14} /></button>
      </div>
      {pop === 'fill' && <ColorPopover anchor={fillBtn.current} title="Fill" paint={s.fill} onChange={(p) => store.set({ fill: p })} onClose={() => setPop(null)} />}
      {pop === 'stroke' && <ColorPopover anchor={strokeBtn.current} title="Stroke" paint={s.stroke} onChange={(p) => store.set({ stroke: p })} onClose={() => setPop(null)} />}
    </nav>
  );
}
