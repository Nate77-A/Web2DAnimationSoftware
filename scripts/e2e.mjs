// Playwright desktop workflow test against the production build.
//   npm run build && node scripts/e2e.mjs [screenshotDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from './serve.mjs';

const SHOTS = process.argv[2] ?? 'test-results';
fs.mkdirSync(SHOTS, { recursive: true });
const server = serve(process.env.DIST ?? 'dist');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const state = () => page.evaluate(() => window.__studio.get());
const proj = async () => (await state()).project;
const objectCount = async () => (await proj()).layers.reduce((n, l) => n + l.objectTracks.reduce((m, c) => m + c.objects.length, 0), 0);

await page.goto('http://localhost:4173/');
await page.waitForSelector('.stage canvas');
await page.waitForTimeout(400);
await shot('01-initial');

const stage = await page.locator('.stage').boundingBox();
const at = (fx, fy) => [stage.x + stage.width * fx, stage.y + stage.height * fy];

// Brush stroke
await page.keyboard.press('b');
await page.mouse.move(...at(0.3, 0.4));
await page.mouse.down();
for (let i = 0; i <= 20; i++) await page.mouse.move(...at(0.3 + i * 0.012, 0.4 + Math.sin(i / 3) * 0.05));
await page.mouse.up();
check('brush creates a vector path', (await objectCount()) === 1);
const p1 = await proj();
const brush = p1.layers[0].objectTracks[0].objects[0];
check('brush path has samples metadata', brush.kind === 'path' && brush.brush?.samples.length > 5, `${brush.brush?.samples.length} samples`);

// Rectangle
await page.keyboard.press('u');
await page.mouse.move(...at(0.55, 0.3));
await page.mouse.down();
await page.mouse.move(...at(0.65, 0.45), { steps: 5 });
await page.mouse.up();
check('shape tool creates rectangle', (await objectCount()) === 2);
const st = await state();
check('new shape is selected', st.selection.length === 1);

// Undo / redo
await page.keyboard.press('Control+z');
check('undo removes shape', (await objectCount()) === 1);
await page.keyboard.press('Control+Shift+z');
check('redo restores shape', (await objectCount()) === 2);

// Transform handles visible with transform tool
await page.keyboard.press('q');
await page.waitForTimeout(50);
check('transform handles render', (await page.locator('[data-handle]').count()) === 9);
const rot = await page.locator('[data-handle="rot"]').boundingBox();
const before = (await state()).selection[0];
await page.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2);
await page.mouse.down();
await page.mouse.move(rot.x + 120, rot.y + 80, { steps: 6 });
await page.mouse.up();
const rotated = (await proj()).layers[0].objectTracks[0].objects.find((o) => o.id === before);
check('rotate handle rotates object', Math.abs(rotated.transform.rotation) > 5, `${rotated.transform.rotation.toFixed(1)}°`);
await shot('02-drawn');

// Zoom field
await page.locator('.zoom-field').click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('75');
await page.keyboard.press('Enter');
check('typing 75 sets 75% zoom', Math.abs((await state()).viewport.zoom - 0.75) < 1e-6);
await page.keyboard.press('Control+0');

// Layers
await page.getByLabel('Add layer').click();
check('add layer', (await proj()).layers.length === 2);
const top = (await proj()).layers[1];
await page.getByLabel(`Hide ${top.name}`).click();
check('hide layer', (await proj()).layers[1].visible === false);
await page.getByLabel(`Show ${top.name}`).click();
await page.getByLabel(`Lock ${top.name}`).click();
check('lock layer', (await proj()).layers[1].locked === true);
await page.getByLabel(`Unlock ${top.name}`).click();
await page.getByLabel(`Solo ${top.name}`).click();
check('solo layer', (await proj()).layers[1].solo === true);
await page.getByLabel(`Unsolo ${top.name}`).click();

// Frames: duplicate frame 1 -> 2 on layer 1 and verify independence
await page.evaluate(() => window.__studio.set({ activeLayerId: window.__studio.get().project.layers[0].id, currentFrame: 0, selection: [] }));
await page.keyboard.press('F6');
let p = await proj();
const spans = p.layers[0].exposureTrack;
check('duplicate frame creates a new span at frame 2', spans.some((e) => e.startFrame === 1), JSON.stringify(spans));
const c0 = p.layers[0].objectTracks.find((c) => c.id === spans.find((e) => e.startFrame === 0).contentId);
const c1 = p.layers[0].objectTracks.find((c) => c.id === spans.find((e) => e.startFrame === 1).contentId);
check('duplicated content is independent (new ids)', c0.objects.length === c1.objects.length && c0.objects.every((o, i) => o.id !== c1.objects[i].id));
await page.keyboard.press('F7');
p = await proj();
check('add blank frame', p.layers[0].exposureTrack.length === 3 && (await state()).currentFrame === 2);

// Motion tween on frame 1 shape
await page.evaluate(() => window.__studio.set({ currentFrame: 0 }));
const rectId = c0.objects.find((o) => o.kind === 'shape').id;
await page.evaluate((id) => window.__studio.set({ selection: [id] }), rectId);
await page.keyboard.press('Shift+T');
p = await proj();
const span0 = p.layers[0].exposureTrack.find((e) => e.startFrame === 0);
check('create tween extends span and keys object', span0.endFrame > 0, `span ${span0.startFrame}-${span0.endFrame}`);

// Export PNG (single frame)
await page.keyboard.press('Control+Shift+E');
await page.waitForSelector('#export-title');
await shot('03-export');
await page.locator('.dialog select.input').first().selectOption('current');
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()]);
const pngPath = `${SHOTS}/export.png`;
await dl.saveAs(pngPath);
const buf = fs.readFileSync(pngPath);
check('PNG export downloads a valid PNG', buf.slice(1, 4).toString() === 'PNG' && buf.length > 1000, `${buf.length} bytes`);

// GIF export (range 1-6)
await page.keyboard.press('Control+Shift+E');
await page.getByRole('tab', { name: 'Animated GIF' }).click();
await page.locator('.dialog select.input').first().selectOption('custom');
await page.getByLabel('End frame').fill('6');
await page.getByLabel('End frame').press('Enter');
await page.getByLabel('Output width').fill('480');
await page.getByLabel('Output width').press('Enter');
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Export GIF' }).click()]);
const gifPath = `${SHOTS}/export.gif`;
await dl2.saveAs(gifPath);
const gif = fs.readFileSync(gifPath);
check('GIF export downloads GIF89a', gif.slice(0, 6).toString() === 'GIF89a', `${gif.length} bytes`);

// SVG export (JS mode because layer has frame-by-frame spans)
await page.keyboard.press('Control+Shift+E');
await page.getByRole('tab', { name: 'SVG' }).click();
await page.waitForTimeout(50);
const cssBlocked = await page.getByRole('button', { name: 'Export SVG' }).isDisabled();
check('CSS-only SVG is blocked with an explanation for frame-by-frame content', cssBlocked && (await page.locator('.notice.error').count()) > 0);
await page.getByRole('radio', { name: 'CSS + JavaScript' }).click();
const [dl3] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export SVG' }).click()]);
const svgPath = `${SHOTS}/export.svg`;
await dl3.saveAs(svgPath);
const svg = fs.readFileSync(svgPath, 'utf8');
check('SVG export is self-contained', svg.includes('<svg') && svg.includes('<script>') && !/https?:\/\/(?!www\.w3\.org)/.test(svg), `${svg.length} chars`);

// MP4 export (WebCodecs) and decode check in a <video> element
await page.keyboard.press('Control+Shift+E');
await page.getByRole('tab', { name: 'MP4 video' }).click();
await page.locator('.dialog select.input').first().selectOption('custom');
await page.getByLabel('End frame').fill('24');
await page.getByLabel('End frame').press('Enter');
await page.getByLabel('Output width').fill('640');
await page.getByLabel('Output width').press('Enter');
await page.waitForSelector('.notice.ok, .notice.error');
const mp4Supported = (await page.locator('.notice.ok').count()) > 0;
if (mp4Supported) {
  const [dl5] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Export MP4' }).click()]);
  const mp4Path = `${SHOTS}/export.mp4`;
  await dl5.saveAs(mp4Path);
  const b64 = fs.readFileSync(mp4Path).toString('base64');
  const meta = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    return new Promise((res) => { v.onloadedmetadata = () => res({ d: v.duration, w: v.videoWidth, h: v.videoHeight }); v.onerror = () => res({ error: v.error?.message || 'decode error' }); });
  }, b64);
  check('MP4 export decodes with the right size and duration', !meta.error && meta.w === 640 && meta.h === 360 && Math.abs(meta.d - 1) < 0.1, JSON.stringify(meta));
} else {
  console.log('SKIP  MP4 export (browser reports no H.264 encoder; UI shows the unsupported notice)');
  await page.keyboard.press('Escape');
}

// Image import (uses the PNG exported above as the fixture)
await page.evaluate(() => window.__studio.set({ currentFrame: 0 }));
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+Shift+O')]);
await chooser.setFiles(pngPath);
await page.waitForFunction(() => window.__studio.get().project.assets.length === 1);
p = await proj();
check('image import stores asset and places a bitmap', p.assets.length === 1 && p.layers.some((l) => l.objectTracks.some((c) => c.objects.some((o) => o.kind === 'bitmap'))));
await page.keyboard.press('Delete');

// Bucket + eraser on a fresh layer
await page.getByLabel('Add layer').click();
await page.evaluate(() => window.__studio.set({ currentFrame: 30, selection: [] }));
await page.keyboard.press('u');
await page.getByRole('radio', { name: 'Rectangle' }).click();
await page.mouse.move(...at(0.1, 0.1)); await page.mouse.down(); await page.mouse.move(...at(0.2, 0.25), { steps: 3 }); await page.mouse.up();
await page.evaluate(() => window.__studio.set({ fill: { type: 'solid', color: '#FF0000FF' }, selection: [] }));
await page.keyboard.press('k');
await page.mouse.click(...at(0.15, 0.17));
const activeLayer = async () => { const st = await state(); return st.project.layers.find((l) => l.id === st.activeLayerId); };
const filled = (await activeLayer()).objectTracks.flatMap((c) => c.objects).find((o) => o.kind === 'shape');
check('paint bucket fills a closed shape', filled?.style.fill.color === '#FF0000FF');
await page.evaluate(() => window.__studio.set({ fill: { type: 'solid', color: '#0000FFFF' } }));
await page.keyboard.press('i');
await page.mouse.click(...at(0.15, 0.17));
check('eyedropper samples rendered color', (await state()).fill.color?.startsWith('#FF0000'));
await page.keyboard.press('b');
await page.mouse.move(...at(0.3, 0.8)); await page.mouse.down();
for (let i = 0; i <= 20; i++) await page.mouse.move(...at(0.3 + i * 0.01, 0.8));
await page.mouse.up();
const layerObjs = async () => (await activeLayer()).objectTracks.flatMap((c) => c.objects).filter((o) => o.kind === 'path').length;
const beforeErase = await layerObjs();
await page.keyboard.press('e');
await page.mouse.move(...at(0.4, 0.72)); await page.mouse.down(); await page.mouse.move(...at(0.4, 0.88), { steps: 6 }); await page.mouse.up();
check('eraser splits a brush stroke in two', (await layerObjs()) === beforeErase + 1, `${beforeErase} -> ${await layerObjs()}`);
await page.keyboard.press('Control+z');
check('erase is undoable', (await layerObjs()) === beforeErase);

// Save .anims
const [dl4] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
const animsPath = `${SHOTS}/project.anims`;
await dl4.saveAs(animsPath);
check('native save writes a ZIP .anims', fs.readFileSync(animsPath).slice(0, 2).toString() === 'PK');

// Persistence: reload restores project
await page.waitForTimeout(1200);
const idBefore = (await proj()).id, countBefore = await objectCount();
await page.reload();
await page.waitForSelector('.stage canvas');
await page.waitForTimeout(300);
check('reload restores project from IndexedDB', (await proj()).id === idBefore && (await objectCount()) === countBefore);

// Playback
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const playing = (await state()).playing, f = (await state()).currentFrame;
await page.keyboard.press('Enter');
check('playback advances frames', playing && f > 0, `frame ${f + 1}`);

// Keyboard menus
await page.getByRole('menuitem', { name: 'Window' }).click();
await page.getByRole('menuitemcheckbox', { name: 'Timeline' }).click();
check('Window menu hides timeline', (await page.locator('.timeline').count()) === 0);
await page.getByRole('menuitem', { name: 'Window' }).click();
await page.getByRole('menuitemcheckbox', { name: 'Timeline' }).click();
check('Window menu restores timeline', (await page.locator('.timeline').count()) === 1);
await page.keyboard.press('Escape');
await page.keyboard.press('v');
await page.evaluate(() => window.__studio.set({ currentFrame: 0, selection: [] }));
await page.waitForTimeout(100);
await shot('04-final');

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
