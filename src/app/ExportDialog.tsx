import { useEffect, useMemo, useRef, useState } from 'react';
import { getState, store, toast, useApp } from '../editor/state';
import { downloadBlob, ExportCancelled, safeFileName, type Progress } from '../features/export/common';
import { exportGif, gifWarnings } from '../features/export/gif';
import { detectMp4Support, exportMp4, type Mp4Support } from '../features/export/mp4';
import { exportPng } from '../features/export/png';
import { analyzeSvg, exportSvg, type BitmapCompression, type BitmapPolicy } from '../features/export/svg';
import { Check, Field, NumberField, Seg } from './controls';
import { Icon } from './icons';

type Tab = 'png' | 'gif' | 'mp4' | 'svg';
type RangeMode = 'all' | 'current' | 'selection' | 'custom';

export function ExportDialog({ initialTab }: { initialTab?: Tab }) {
  const p = useApp((s) => s.project);
  const frame = useApp((s) => s.currentFrame);
  const sel = useApp((s) => s.frameRange);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'png');
  const [name, setName] = useState(safeFileName(p.name));
  const [w, setW] = useState(p.width);
  const [h, setH] = useState(p.height);
  const [lockAspect, setLockAspect] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>('all');
  const [cStart, setCStart] = useState(1);
  const [cEnd, setCEnd] = useState(p.durationFrames);
  const [fps, setFps] = useState(p.fps);
  // per-format
  const [alpha, setAlpha] = useState(true);
  const [zipLevel, setZipLevel] = useState(6);
  const [gifQuality, setGifQuality] = useState(80);
  const [gifLoop, setGifLoop] = useState(true);
  const [gifTransparent, setGifTransparent] = useState(false);
  const [mp4Quality, setMp4Quality] = useState(70);
  const [mp4Support, setMp4Support] = useState<Mp4Support | null>(null);
  const [svgMode, setSvgMode] = useState<'css' | 'js'>('css');
  const [svgSizing, setSvgSizing] = useState<'fixed' | 'responsive'>('fixed');
  const [crop, setCrop] = useState(true);
  const [svgLoop, setSvgLoop] = useState(true);
  const [bmp, setBmp] = useState<BitmapCompression>({ policy: 'original', quality: 85, maxSize: 0 });
  const [overrides, setOverrides] = useState<Record<string, BitmapCompression>>({});
  // run state
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const range = useMemo(() => {
    const last = p.durationFrames - 1;
    if (rangeMode === 'current') return { start: frame, end: frame };
    if (rangeMode === 'selection' && sel) return { start: sel.start, end: Math.min(last, sel.end) };
    if (rangeMode === 'custom') { const a = Math.max(0, Math.min(last, cStart - 1)), b = Math.max(0, Math.min(last, cEnd - 1)); return { start: Math.min(a, b), end: Math.max(a, b) }; }
    return { start: 0, end: last };
  }, [rangeMode, frame, sel, cStart, cEnd, p.durationFrames]);
  const frames = range.end - range.start + 1;

  useEffect(() => {
    if (tab !== 'mp4') return;
    let live = true;
    setMp4Support(null);
    void detectMp4Support({ width: w, height: h, fps, quality: mp4Quality }).then((r) => { if (live) setMp4Support(r); });
    return () => { live = false; };
  }, [tab, w, h, fps]);

  const svgAnalysis = useMemo(() => (tab === 'svg' ? analyzeSvg(p, range) : null), [tab, p, range]);
  const gifWarn = useMemo(() => (tab === 'gif' ? gifWarnings(p, { name, width: w, height: h, range, fps, quality: gifQuality, loop: gifLoop, transparent: gifTransparent }) : []), [tab, p, w, h, range, fps, gifTransparent]);

  const close = () => { abort.current?.abort(); store.set({ dialog: null }); };
  const setWidth = (v: number) => { setW(Math.round(v)); if (lockAspect) setH(Math.max(1, Math.round((v * p.height) / p.width))); };
  const setHeight = (v: number) => { setH(Math.round(v)); if (lockAspect) setW(Math.max(1, Math.round((v * p.width) / p.height))); };

  const run = async () => {
    setError(null);
    const ac = new AbortController();
    abort.current = ac;
    setProgress({ done: 0, total: 1, phase: 'Preparing' });
    const project = getState().project;
    const base = safeFileName(name);
    let saved = true;
    try {
      if (tab === 'png') {
        const blob = await exportPng(project, { name: base, width: w, height: h, range, alpha, compression: zipLevel }, setProgress, ac.signal);
        saved = await downloadBlob(blob, frames === 1 ? `${base}_${String(range.start + 1).padStart(4, '0')}.png` : `${base}_png.zip`);
      } else if (tab === 'gif') {
        const blob = await exportGif(project, { name: base, width: w, height: h, range, fps, quality: gifQuality, loop: gifLoop, transparent: gifTransparent }, setProgress, ac.signal);
        saved = await downloadBlob(blob, `${base}.gif`);
      } else if (tab === 'mp4') {
        const blob = await exportMp4(project, { name: base, width: w, height: h, range, fps, quality: mp4Quality }, setProgress, ac.signal);
        saved = await downloadBlob(blob, `${base}.mp4`);
      } else {
        const { blob } = await exportSvg(project, { name: base, width: w, height: h, range, fps, mode: svgMode, sizing: svgSizing, cropToArtboard: crop, loop: svgLoop, bitmap: bmp, bitmapOverrides: overrides }, setProgress, ac.signal);
        saved = await downloadBlob(blob, `${base}.svg`);
      }
      if (!saved) { toast('Download declined; the export was not saved', 'info'); return; }
      toast(`Exported ${tab.toUpperCase()} (${frames} frame${frames > 1 ? 's' : ''})`, 'success');
      store.set({ dialog: null });
    } catch (e) {
      if (e instanceof ExportCancelled) { toast('Export cancelled', 'info'); setProgress(null); return; }
      setError((e as Error).message);
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const busy = !!progress;
  const blocked = (tab === 'mp4' && !mp4Support?.supported) || (tab === 'svg' && svgMode === 'css' && !!svgAnalysis?.cssUnsupported.length);
  const tabs: { id: Tab; label: string; tip: string }[] = [
    { id: 'png', label: 'PNG', tip: 'Still images: one frame, or every frame as numbered PNGs in a ZIP. Supports transparency.' },
    { id: 'gif', label: 'Animated GIF', tip: 'A looping animation that plays almost anywhere. Limited to 256 colors per frame.' },
    { id: 'mp4', label: 'MP4 video', tip: 'A standard video file for sharing and video editors. No transparency.' },
    { id: 'svg', label: 'SVG', tip: 'A scalable vector animation for web pages. Stays sharp at any size.' },
  ];

  return (
    <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="dialog-head">
        <Icon name="export" />
        <h2 id="export-title">Export</h2>
        <button className="icon-btn sm" aria-label="Close export dialog" data-tip-desc="Close the export window without exporting." onClick={close}><Icon name="close" size={16} /></button>
      </div>
      <div className="tabs" role="tablist" aria-label="Export format">
        {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} data-tip={t.label} data-tip-desc={t.tip} disabled={busy} onClick={() => { setTab(t.id); setError(null); }}>{t.label}</button>)}
      </div>
      <div className="dialog-body" role="tabpanel">
        <div className="grid2">
          <Field label="File name"><input className="input" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} /></Field>
          <Field label="Frame range">
            <select className="input" value={rangeMode} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRangeMode(e.target.value as RangeMode)}>
              <option value="all">All frames (1–{p.durationFrames})</option>
              <option value="current">Current frame ({frame + 1})</option>
              <option value="selection" disabled={!sel}>Timeline selection{sel ? ` (${sel.start + 1}–${sel.end + 1})` : ''}</option>
              <option value="custom">Custom…</option>
            </select>
          </Field>
        </div>
        {rangeMode === 'custom' && (
          <div className="grid2">
            <NumberField label="Start frame" scrubLabel="From" value={cStart} min={1} max={p.durationFrames} precision={0} onChange={setCStart} />
            <NumberField label="End frame" scrubLabel="To" value={cEnd} min={1} max={p.durationFrames} precision={0} onChange={setCEnd} />
          </div>
        )}
        <div className="grid3">
          <NumberField label="Output width" scrubLabel="W" value={w} min={1} max={8192} precision={0} unit="px" onChange={setWidth} />
          <NumberField label="Output height" scrubLabel="H" value={h} min={1} max={8192} precision={0} unit="px" onChange={setHeight} />
          {tab !== 'png' ? <NumberField label="Frames per second" scrubLabel="FPS" value={fps} min={1} max={120} precision={0} onChange={(v) => setFps(Math.round(v))} /> : <div />}
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Check label="Keep aspect ratio" checked={lockAspect} onChange={setLockAspect} />
          <span className="hint">{frames} frame{frames > 1 ? 's' : ''}{tab !== 'png' ? ` · ${(frames / fps).toFixed(2)} s` : ''}</span>
        </div>

        {tab === 'png' && (
          <>
            <Check label="Transparent background (alpha)" checked={alpha} onChange={setAlpha} />
            {frames > 1 && <Field label={`ZIP compression level · ${zipLevel}`}><input type="range" min={0} max={9} value={zipLevel} aria-label="ZIP compression level" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setZipLevel(Number(e.target.value))} /></Field>}
            <p className="hint">{frames > 1 ? 'Numbered PNG files are delivered in a ZIP archive.' : 'A single PNG is downloaded.'} {alpha && p.background ? 'The document background color is included; set Background to None in Document properties for full transparency.' : ''} PNG pixel compression uses the browser’s lossless encoder.</p>
          </>
        )}
        {tab === 'gif' && (
          <>
            <Field label={`Palette quality · ${Math.round(16 + (gifQuality / 100) * 240)} colors`}>
              <input type="range" min={1} max={100} value={gifQuality} aria-label="GIF palette quality" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGifQuality(Number(e.target.value))} />
            </Field>
            <div className="row"><Check label="Loop forever" checked={gifLoop} onChange={setGifLoop} /><Check label="Transparent background" checked={gifTransparent} onChange={setGifTransparent} /></div>
            {gifWarn.length > 0 && <div className="notice warn"><Icon name="warning" size={16} /><div>GIF limits for this project:<ul>{gifWarn.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
          </>
        )}
        {tab === 'mp4' && (
          <>
            <Field label={`Quality · ${mp4Quality}`}><input type="range" min={1} max={100} value={mp4Quality} aria-label="MP4 quality" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMp4Quality(Number(e.target.value))} /></Field>
            {!mp4Support ? <div className="notice"><Icon name="info" size={16} />Checking this browser’s H.264 encoder…</div>
              : <div className={`notice ${mp4Support.supported ? 'ok' : 'error'}`}><Icon name={mp4Support.supported ? 'check' : 'warning'} size={16} /><span>{mp4Support.reason}</span></div>}
            <p className="hint">MP4 (H.264) has no transparency: frames are flattened onto the document background{p.background ? '' : ' (white, because the background is transparent)'}. Odd dimensions are rounded to even numbers.</p>
          </>
        )}
        {tab === 'svg' && svgAnalysis && (
          <>
            <div className="grid2">
              <Field label="Animation mode">
                <Seg label="SVG animation mode" value={svgMode} onChange={setSvgMode} options={[{ value: 'css', label: 'CSS only', title: 'CSS only', tip: 'Animates with CSS alone. Works where scripts are blocked, but cannot swap frame-by-frame drawings.' }, { value: 'js', label: 'CSS + JavaScript', title: 'CSS + JavaScript', tip: 'Adds a small script so frame-by-frame drawings play too. Needs scripts to be allowed where it is shown.' }]} />
              </Field>
              <Field label="Sizing">
                <Seg label="SVG sizing" value={svgSizing} onChange={setSvgSizing} options={[{ value: 'fixed', label: 'Fixed', title: 'Fixed size', tip: 'The SVG keeps the exact pixel width and height you set.' }, { value: 'responsive', label: 'Responsive', title: 'Responsive', tip: 'The SVG stretches to fit its container, keeping its proportions.' }]} />
              </Field>
            </div>
            <div className="row"><Check label="Crop to artboard" checked={crop} onChange={setCrop} />{frames > 1 && <Check label="Loop" checked={svgLoop} onChange={setSvgLoop} />}</div>
            {svgMode === 'css' && svgAnalysis.cssUnsupported.length > 0 && (
              <div className="notice error"><Icon name="warning" size={16} /><div>CSS-only output cannot represent this range:<ul>{svgAnalysis.cssUnsupported.map((x) => <li key={x}>{x}</li>)}</ul></div></div>
            )}
            {svgAnalysis.warnings.length > 0 && <div className="notice"><Icon name="info" size={16} /><div><ul style={{ margin: 0 }}>{svgAnalysis.warnings.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
            {svgAnalysis.bitmaps.length > 0 && (
              <>
                <div className="grid3">
                  <Field label="Bitmap compression">
                    <select className="input" value={bmp.policy} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBmp({ ...bmp, policy: e.target.value as BitmapPolicy })}>
                      <option value="original">Original bytes</option><option value="webp">WebP</option><option value="jpeg">JPEG (no alpha)</option><option value="png">PNG</option>
                    </select>
                  </Field>
                  <NumberField label="Bitmap quality" scrubLabel="Q" value={bmp.quality} min={5} max={100} precision={0} onChange={(quality) => setBmp({ ...bmp, quality })} disabled={bmp.policy === 'original' || bmp.policy === 'png'} />
                  <NumberField label="Max bitmap size (0 = original)" scrubLabel="Max" value={bmp.maxSize} min={0} max={8192} precision={0} unit="px" onChange={(maxSize) => setBmp({ ...bmp, maxSize })} />
                </div>
                <details>
                  <summary className="hint" style={{ cursor: 'pointer' }}>Per-bitmap overrides ({Object.keys(overrides).length})</summary>
                  <div className="list" style={{ marginTop: 8 }}>
                    {svgAnalysis.bitmaps.map((a) => {
                      const o = overrides[a.id];
                      return (
                        <div className="list-item" key={a.id}>
                          <div className="meta"><div>{a.name}</div><div>{a.width}×{a.height} · {(a.byteLength / 1024).toFixed(0)} KB</div></div>
                          <select className="input" style={{ width: 130 }} aria-label={`Compression for ${a.name}`} value={o?.policy ?? 'inherit'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                            const v = e.target.value;
                            setOverrides((prev) => { const n = { ...prev }; if (v === 'inherit') delete n[a.id]; else n[a.id] = { ...bmp, policy: v as BitmapPolicy }; return n; });
                          }}>
                            <option value="inherit">Use global</option><option value="original">Original</option><option value="webp">WebP</option><option value="jpeg">JPEG</option><option value="png">PNG</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </>
            )}
            <p className="hint">{frames === 1 ? 'Exports a static SVG of the selected frame.' : svgMode === 'css' ? 'CSS-only animates transforms and opacity of tweened objects.' : 'JavaScript mode swaps frame-by-frame drawings and replays tweens exactly as previewed.'} Bitmaps are embedded as data URIs; nothing is loaded from the network.</p>
          </>
        )}
        {error && <div className="notice error" role="alert"><Icon name="warning" size={16} /><span style={{ whiteSpace: 'pre-wrap' }}>{error}</span></div>}
        {progress && (
          <div aria-live="polite">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><span className="hint">{progress.phase}…</span><span className="hint">{Math.round((progress.done / Math.max(1, progress.total)) * 100)}%</span></div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
          </div>
        )}
      </div>
      <div className="dialog-foot">
        <span className="hint" style={{ alignSelf: 'center' }}>Exports render from the project data, not the screen.</span>
        <div className="spacer" />
        {busy ? <button className="btn" data-tip-desc="Stop the export in progress." onClick={() => abort.current?.abort()}>Cancel export</button> : <button className="btn ghost" data-tip-desc="Close the export window without exporting." onClick={close}>Close</button>}
        <button className="btn primary" data-tip={`Export ${tab.toUpperCase()}`} data-tip-desc="Render the animation with these settings and download the file." onClick={() => void run()} disabled={busy || blocked}>Export {tab.toUpperCase()}</button>
      </div>
    </div>
  );
}
