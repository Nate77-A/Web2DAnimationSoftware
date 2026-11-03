import { useEffect, useRef, useState } from 'react';
import { dismissToast, getState, store, toast, useApp, type Dialog } from '../editor/state';
import { db } from '../features/db';
import { downloadBlob } from '../features/export/common';
import { switchToProject } from '../features/persistence';
import { commands, formatKeys, MENUS } from './commands';
import { ExportDialog } from './ExportDialog';
import { Icon } from './icons';

function Modal({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, [tabindex="0"], summary') ?? []);
    (el?.querySelector<HTMLElement>('[autofocus]') ?? focusables()[0])?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    el?.addEventListener('keydown', key);
    return () => { el?.removeEventListener('keydown', key); prev?.focus?.(); };
  }, []);
  return (
    <div className="backdrop" ref={ref} aria-label={label} onPointerDown={(e: React.PointerEvent) => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}

const close = () => store.set({ dialog: null });

function ConfirmDialog({ d }: { d: Extract<Dialog, { kind: 'confirm' }> }) {
  return (
    <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
      <div className="dialog-head"><h2 id="confirm-title">{d.title}</h2></div>
      <div className="dialog-body"><p id="confirm-body" style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>{d.body}</p></div>
      <div className="dialog-foot">
        {d.confirmLabel !== 'OK' && <button className="btn ghost" onClick={close}>Cancel</button>}
        {d.altLabel && d.onAlt && <button className="btn" onClick={() => { close(); d.onAlt!(); }}>{d.altLabel}</button>}
        <button className={`btn ${d.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => { close(); d.onConfirm(); }}>{d.confirmLabel}</button>
      </div>
    </div>
  );
}

function PromptDialog({ d }: { d: Extract<Dialog, { kind: 'prompt' }> }) {
  const [v, setV] = useState(d.value);
  const submit = () => { close(); d.onConfirm(v); };
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
      <div className="dialog-head"><h2 id="prompt-title">{d.title}</h2></div>
      <div className="dialog-body">
        <label className="field"><span>{d.label}</span>
          <input className="input" autoFocus value={v} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value)} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') submit(); }} />
        </label>
      </div>
      <div className="dialog-foot"><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={submit} disabled={!v.trim()}>{d.confirmLabel}</button></div>
    </div>
  );
}

function RecoveryDialog({ d }: { d: Extract<Dialog, { kind: 'recovery' }> }) {
  return (
    <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="rec-title">
      <div className="dialog-head"><Icon name="warning" /><h2 id="rec-title">Your last project could not be restored</h2></div>
      <div className="dialog-body">
        <div className="notice error"><div>{d.message}{d.details.length > 0 && <ul>{d.details.map((x) => <li key={x}>{x}</li>)}</ul>}</div></div>
        <p className="hint">The damaged data was kept untouched in local storage and a fresh project was opened, so nothing was overwritten. You can download the raw data for recovery or support.</p>
      </div>
      <div className="dialog-foot">
        {d.raw && <button className="btn" onClick={() => void downloadBlob(new Blob([d.raw!], { type: 'application/json' }), 'recovered-project-data.json')}>Download raw data</button>}
        <button className="btn primary" autoFocus onClick={close}>Continue with new project</button>
      </div>
    </div>
  );
}

function ProjectsDialog() {
  const [list, setList] = useState<{ id: string; name: string; updatedAt: string; size: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const current = useApp((s) => s.project.id);
  const load = () => db.listProjects().then(setList).catch((e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="proj-title">
      <div className="dialog-head"><Icon name="folder" /><h2 id="proj-title">Projects in this browser</h2><button className="icon-btn sm" aria-label="Close" onClick={close}><Icon name="close" size={16} /></button></div>
      <div className="dialog-body">
        <p className="hint" style={{ margin: 0 }}>Projects autosave to this browser’s offline storage. Use File › Save to download a portable .anims file.</p>
        {err && <div className="notice error">{err}</div>}
        {!list && !err && <p className="hint">Loading…</p>}
        {list && (
          <div className="list">
            {list.map((p) => (
              <div key={p.id} className={`list-item${p.id === current ? ' current' : ''}`}>
                <div className="meta"><div>{p.name}</div><div>{new Date(p.updatedAt).toLocaleString()} · {(p.size / 1024).toFixed(0)} KB{p.id === current ? ' · open now' : ''}</div></div>
                <button className="btn sm" disabled={p.id === current} onClick={async () => {
                  try { await switchToProject(p.id); close(); window.dispatchEvent(new Event('studio:fit')); } catch (e) { toast(`Could not open: ${(e as Error).message}`, 'error'); }
                }}>Open</button>
                <button className="icon-btn sm" aria-label={`Delete ${p.name}`} disabled={p.id === current} onClick={() => store.set({
                  dialog: { kind: 'confirm', title: `Delete “${p.name}”?`, body: 'This removes the project from this browser. Downloaded .anims files are not affected. This cannot be undone.', confirmLabel: 'Delete', danger: true,
                    onConfirm: () => { void db.deleteProject(p.id).then(() => { toast('Project deleted'); store.set({ dialog: { kind: 'projects' } }); }); } },
                })}><Icon name="trash" size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="dialog-foot"><button className="btn" onClick={() => commands['file.new'].run()}>New project</button><button className="btn" onClick={() => { close(); commands['file.open'].run(); }}>Open file…</button></div>
    </div>
  );
}

function ShortcutsDialog() {
  const sections = MENUS.map((m) => ({ title: m.label, items: m.items.filter((i) => i !== '-' && commands[i].keys).map((i) => commands[i]) }));
  const toolsSection = { title: 'Tools & colors', items: Object.values(commands).filter((c) => (c.id.startsWith('tool.') || c.id.startsWith('color.') || c.id.startsWith('brush.')) && c.keys) };
  return (
    <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="kbd-title">
      <div className="dialog-head"><h2 id="kbd-title">Keyboard shortcuts</h2><button className="icon-btn sm" aria-label="Close" onClick={close}><Icon name="close" size={16} /></button></div>
      <div className="dialog-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        {[toolsSection, ...sections].filter((s) => s.items.length).map((s) => (
          <div key={s.title}>
            <h3 style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.6px', margin: '0 0 8px' }}>{s.title}</h3>
            <div className="kbd-table">{s.items.map((c) => <span key={c.id} style={{ display: 'contents' }}><span>{c.label}</span><kbd>{formatKeys(c.keys)}</kbd></span>)}</div>
          </div>
        ))}
        <div>
          <h3 style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.6px', margin: '0 0 8px' }}>Stage</h3>
          <div className="kbd-table">
            <span>Pan</span><kbd>Space + drag</kbd><span>Zoom at pointer</span><kbd>{formatKeys(['Mod'])} + wheel / pinch</kbd>
            <span>Nudge selection</span><kbd>Arrows (Shift ×10)</kbd><span>Return to Select from Hand/Zoom/Eyedropper</span><kbd>Esc</kbd>
            <span>Touch: pan while drawing</span><kbd>1 finger</kbd><span>Touch: zoom</span><kbd>2-finger pinch</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutDialog() {
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div className="dialog-head"><h2 id="about-title">2D Animation Studio {__APP_VERSION__}</h2><button className="icon-btn sm" aria-label="Close" onClick={close}><Icon name="close" size={16} /></button></div>
      <div className="dialog-body">
        <p className="hint" style={{ margin: 0 }}>Offline-capable vector drawing and animation in the browser. Projects autosave locally; exports render from project data.</p>
        <div className="notice"><div><strong>Known limits in this version</strong><ul>
          <li>Eraser splits brush strokes or deletes objects; it does not erase pixels of imported images.</li>
          <li>Paint Bucket fills closed vector shapes only (no bitmap flood fill).</li>
          <li>MP4 needs WebCodecs (Chrome/Edge 94+, Safari 16.4+) and never keeps transparency.</li>
          <li>GIF transparency is 1-bit and palettes are limited to 256 colors.</li>
          <li>CSS-only SVG cannot swap frame-by-frame drawings; use CSS + JavaScript mode.</li>
          <li>Text uses installed/web-safe fonts; fonts are not embedded in exports.</li>
          <li>Out of scope for now: audio, symbols, bone rigs, filters, camera, collaboration and cloud sync.</li>
        </ul></div></div>
      </div>
    </div>
  );
}

export function Dialogs() {
  const d = useApp((s) => s.dialog);
  if (!d) return null;
  const onClose = () => { if (d.kind !== 'recovery') close(); };
  return (
    <Modal onClose={onClose} label="Dialog">
      {d.kind === 'export' && <ExportDialog initialTab={d.tab} />}
      {d.kind === 'confirm' && <ConfirmDialog d={d} />}
      {d.kind === 'prompt' && <PromptDialog d={d} />}
      {d.kind === 'recovery' && <RecoveryDialog d={d} />}
      {d.kind === 'projects' && <ProjectsDialog />}
      {d.kind === 'shortcuts' && <ShortcutsDialog />}
      {d.kind === 'about' && <AboutDialog />}
    </Modal>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-kind={t.kind}>
          <Icon name={t.kind === 'error' || t.kind === 'warning' ? 'warning' : t.kind === 'success' ? 'check' : 'info'} size={16} />
          <span>{t.text}</span>
          <button className="icon-btn sm" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export { getState };
