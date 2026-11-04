// Hover help: one floating tooltip shared by every button. Buttons describe themselves with
//   data-tip="Name"  data-tip-keys="Shortcut"  data-tip-desc="What it does"  data-tip-pos="right|bottom"
// Anything without data-tip falls back to its native title, aria-label or text, so no button goes without help.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const TARGET = 'button, [role="menuitem"], [role="menuitemcheckbox"], [role="radio"], [role="tab"], [data-tip]';
const SHOW_DELAY = 450;
const WARM_MS = 400; // moving between buttons right after a tooltip hides shows the next one immediately
const TIP_ID = 'studio-tooltip';

interface Tip { el: HTMLElement; title: string; keys: string; desc: string; pos: string }

function readTip(el: HTMLElement): Tip | null {
  // Native title tooltips would double up with ours; move the text into a data attribute.
  const native = el.getAttribute('title');
  if (native) { el.dataset.tipNative = native; el.removeAttribute('title'); }
  const d = el.dataset;
  const label = el.getAttribute('aria-label')?.replace(/\s*\([^)]*\)\s*$/, '') ?? '';
  const title = d.tip || d.tipNative || label || el.textContent?.trim() || '';
  if (!title) return null;
  const desc = d.tipDesc && d.tipDesc !== title ? d.tipDesc : '';
  return { el, title, keys: d.tipKeys ?? '', desc, pos: d.tipPos ?? 'bottom' };
}

export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [xy, setXy] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    let hiddenAt = 0;
    const hide = () => {
      clearTimeout(timer);
      if (current) { current.removeAttribute('aria-describedby'); hiddenAt = performance.now(); }
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, immediate: boolean) => {
      if (el === current) return;
      hide();
      const t = readTip(el);
      if (!t) return;
      current = el;
      const open = () => {
        if (current !== el || !el.isConnected) return;
        el.setAttribute('aria-describedby', TIP_ID);
        setTip(t);
      };
      if (immediate || performance.now() - hiddenAt < WARM_MS) open();
      else timer = window.setTimeout(open, SHOW_DELAY);
    };
    const target = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>(TARGET) : null);

    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = target(e);
      if (el) show(el, false);
      else if (current) hide();
    };
    const out = (e: PointerEvent) => {
      if (!current) return;
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (!to || !current.contains(to)) hide();
    };
    const focusIn = (e: FocusEvent) => {
      const el = target(e);
      if (el && el.matches(':focus-visible')) show(el, true);
    };
    const focusOut = () => { if (current && !current.contains(document.activeElement)) hide(); };

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Place beside or below the button, flipped and clamped so it never leaves the window.
  useLayoutEffect(() => {
    if (!tip || !ref.current) { setXy(null); return; }
    const a = tip.el.getBoundingClientRect();
    const t = ref.current.getBoundingClientRect();
    const m = 8, gap = 8, vw = window.innerWidth, vh = window.innerHeight;
    let left: number, top: number;
    if (tip.pos === 'right') {
      left = a.right + gap;
      if (left + t.width > vw - m) left = a.left - gap - t.width;
      top = a.top + a.height / 2 - t.height / 2;
    } else {
      left = a.left + a.width / 2 - t.width / 2;
      top = a.bottom + gap;
      if (top + t.height > vh - m) top = a.top - gap - t.height;
    }
    setXy({ left: Math.max(m, Math.min(vw - m - t.width, left)), top: Math.max(m, Math.min(vh - m - t.height, top)) });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} id={TIP_ID} role="tooltip" className="tooltip"
      style={xy ? { left: xy.left, top: xy.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      <div className="tooltip-head">
        <strong>{tip.title}</strong>
        {tip.keys && <kbd>{tip.keys}</kbd>}
      </div>
      {tip.desc && <p>{tip.desc}</p>}
    </div>
  );
}
