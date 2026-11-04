import { useEffect, useRef, useState } from 'react';
import { getState, redo, undo, useApp } from '../editor/state';
import { renameProject } from '../features/fileCommands';
import { commands, formatKeys, MENUS } from './commands';
import { Icon } from './icons';

function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  useApp((s) => [s.past.length, s.future.length, s.selection.length, s.panels, s.showGuides, s.debugMarkers, s.project.preferences, s.tool, s.project.layers.length]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!barRef.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [open]);

  useEffect(() => {
    if (open) barRef.current?.querySelector<HTMLElement>(`#menu-${open} [role^="menuitem"]:not(:disabled)`)?.focus();
  }, [open]);

  const focusTop = (id: string) => barRef.current?.querySelector<HTMLElement>(`#menubtn-${id}`)?.focus();
  const move = (dir: number) => {
    const idx = MENUS.findIndex((m) => m.id === open);
    const next = MENUS[(idx + dir + MENUS.length) % MENUS.length].id;
    setOpen(next);
  };

  return (
    <div className="menubar" role="menubar" aria-label="Application menu" ref={barRef}>
      {MENUS.map((m) => (
        <div key={m.id} className="menu-wrap">
          <button
            id={`menubtn-${m.id}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m.id}
            data-tip={`${m.label} menu`}
            data-tip-desc={m.help}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            onPointerEnter={() => { if (open && open !== m.id) setOpen(m.id); }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(m.id); }
              if (e.key === 'ArrowRight') { e.preventDefault(); const i = MENUS.findIndex((x) => x.id === m.id); focusTop(MENUS[(i + 1) % MENUS.length].id); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); const i = MENUS.findIndex((x) => x.id === m.id); focusTop(MENUS[(i - 1 + MENUS.length) % MENUS.length].id); }
            }}
          >{m.label}</button>
          {open === m.id && (
            <div className="menu" role="menu" id={`menu-${m.id}`} aria-label={m.label}
              onKeyDown={(e: React.KeyboardEvent) => {
                const items = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'));
                const i = items.indexOf(document.activeElement as HTMLElement);
                if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
                if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
                if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
                if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(null); focusTop(m.id); }
                if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
                if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
                if (e.key === 'Tab') setOpen(null);
              }}
            >
              {m.items.map((id, i) => {
                if (id === '-') return <hr key={i} />;
                const c = commands[id];
                const checked = c.checked?.();
                const enabled = c.enabled ? c.enabled() : true;
                return (
                  <button
                    key={id}
                    role={checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                    aria-checked={checked}
                    disabled={!enabled}
                    tabIndex={-1}
                    data-tip={c.label}
                    data-tip-desc={c.help}
                    data-tip-pos="right"
                    onClick={() => { setOpen(null); c.run(); }}
                  >
                    <span className="check">{checked ? <Icon name="check" size={16} /> : null}</span>
                    <span className="label">{c.label}</span>
                    {c.keys && <kbd>{formatKeys(c.keys)}</kbd>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProjectName() {
  const name = useApp((s) => s.project.name);
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  return (
    <input
      className="project-name"
      aria-label="Project name"
      data-tip="Project name"
      data-tip-desc="Click to rename the project. The name is used for saved and exported files."
      value={v}
      size={Math.max(8, Math.min(32, v.length + 1))}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value)}
      onBlur={() => (v.trim() ? renameProject(v) : setV(name))}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') { setV(name); (e.currentTarget as HTMLInputElement).blur(); }
      }}
    />
  );
}

function SaveStatus() {
  const s = useApp((st) => ({ status: st.saveStatus, error: st.saveError, dirty: st.fileDirty }));
  const text = s.status === 'error' ? 'Autosave failed' : s.status === 'saved' ? 'Saved locally' : 'Saving…';
  return (
    <span className="status-chip" data-status={s.status} role="status" aria-live="polite"
      data-tip={text} data-tip-desc={s.error ?? (s.dirty ? 'Autosaved in this browser. Use File › Save to download a project file.' : 'Your work is autosaved in this browser.')}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text">{text}</span>
    </span>
  );
}

export function TopBar() {
  const h = useApp((s) => ({ canUndo: s.past.length > 0, canRedo: s.future.length > 0, undoLabel: s.past[s.past.length - 1]?.label, redoLabel: s.future[s.future.length - 1]?.label }));
  return (
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">A</span><span className="brand-name">Animation Studio</span></div>
      <MenuBar />
      <div className="topbar-center">
        <ProjectName />
        <SaveStatus />
      </div>
      <div className="topbar-right">
        <button className="icon-btn" aria-label={`Undo${h.undoLabel ? ` ${h.undoLabel}` : ''} (${formatKeys(['Mod+Z'])})`} data-tip={`Undo${h.undoLabel ? `: ${h.undoLabel}` : ''}`} data-tip-keys={formatKeys(['Mod+Z'])} data-tip-desc={commands['edit.undo'].help} disabled={!h.canUndo} onClick={undo}><Icon name="undo" /></button>
        <button className="icon-btn" aria-label={`Redo${h.redoLabel ? ` ${h.redoLabel}` : ''} (${formatKeys(['Mod+Shift+Z'])})`} data-tip={`Redo${h.redoLabel ? `: ${h.redoLabel}` : ''}`} data-tip-keys={formatKeys(['Mod+Shift+Z'])} data-tip-desc={commands['edit.redo'].help} disabled={!h.canRedo} onClick={redo}><Icon name="redo" /></button>
        <button className="btn primary" style={{ marginLeft: 6 }} onClick={() => commands['file.export'].run()} aria-label={`Export (${formatKeys(['Mod+Shift+E'])})`}
          data-tip="Export" data-tip-keys={formatKeys(['Mod+Shift+E'])} data-tip-desc={commands['file.export'].help}>
          <Icon name="export" size={16} /><span>Export</span>
        </button>
      </div>
    </header>
  );
}

export { getState };
