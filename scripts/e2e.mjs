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

// Path edit mode (fresh context, so earlier steps do not affect it)
{
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx2.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errors.push('path-edit: ' + m.text()); });
  pg.on('pageerror', (e) => errors.push('path-edit pageerror: ' + e.message));
  await pg.goto('http://localhost:4173/');
  await pg.waitForSelector('.stage canvas');
  await pg.waitForTimeout(400);
  const st = () => pg.evaluate(() => window.__studio.get());
  const objs = async () => (await st()).project.layers.flatMap((l) => l.objectTracks.flatMap((c) => c.objects));
  const box = await pg.locator('.stage').boundingBox();
  // document point -> page point
  const P = async (x, y) => { const v = (await st()).viewport; return [box.x + v.panX + x * v.zoom, box.y + v.panY + y * v.zoom]; };
  // local anchor -> document point (no rotation/scale in these checks)
  const docOf = (o, p) => [p[0] - o.transform.pivotX + o.transform.x, p[1] - o.transform.pivotY + o.transform.y];
  const drag = async (from, to) => {
    await pg.mouse.move(...(await P(...from))); await pg.mouse.down();
    await pg.mouse.move(...(await P(...to)), { steps: 8 }); await pg.mouse.up();
  };
  const hold = async (at) => { await pg.mouse.move(...(await P(...at))); await pg.mouse.down(); await pg.waitForTimeout(800); await pg.mouse.up(); };
  const lastLabel = async () => { const p = (await st()).past; return p[p.length - 1]?.label; };
  const near = (a, b, tol = 1.5) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

  await pg.keyboard.press('u');
  await drag([400, 300], [800, 600]);
  const rect = (await objs())[0];
  await pg.keyboard.press('v');
  await pg.mouse.dblclick(...(await P(600, 300)));
  check('double-click a shape enters path edit mode', (await st()).pathEdit?.id === rect.id && (await pg.locator('.pe-anchor').count()) === 4);

  await drag([600, 300], [600, 200]);
  let o = (await objs())[0];
  const [a0, a1] = [o.geometry.segments[0], o.geometry.segments[1]];
  const mid = (() => { // cubic point at t = 0.5 of the bent top edge
    const p0 = a0.p, p1 = [a0.p[0] + a0.ho[0], a0.p[1] + a0.ho[1]], p2 = [a1.p[0] + a1.hi[0], a1.p[1] + a1.hi[1]], p3 = a1.p;
    return [0, 1].map((k) => (p0[k] + 3 * p1[k] + 3 * p2[k] + p3[k]) / 8);
  })();
  check('dragging the path bends it under the pointer', o.kind === 'path' && near(docOf(o, mid), [600, 200], 3) && (await lastLabel()) === 'Bend path',
    `${o.kind} mid=${docOf(o, mid).map((n) => n.toFixed(1))}`);

  await drag([400, 300], [350, 250]);
  o = (await objs())[0];
  check('dragging an anchor moves it', near(docOf(o, o.geometry.segments[0].p), [350, 250]) && (await lastLabel()) === 'Move anchor');

  await hold([800, 600]);
  o = (await objs())[0];
  const s2 = o.geometry.segments[2];
  check('holding a sharp anchor makes it smooth', Math.hypot(...s2.ho) > 1 && Math.hypot(...s2.hi) > 1 && (await lastLabel()) === 'Make anchor smooth');

  const hoEnd = docOf(o, [s2.p[0] + s2.ho[0], s2.p[1] + s2.ho[1]]);
  await drag(hoEnd, [hoEnd[0] - 40, hoEnd[1] + 60]);
  o = (await objs())[0];
  const t2 = o.geometry.segments[2];
  const cross = (t2.hi[0] * t2.ho[1] - t2.hi[1] * t2.ho[0]) / (Math.hypot(...t2.hi) * Math.hypot(...t2.ho));
  check('dragging a handle keeps a smooth anchor smooth', Math.abs(cross) < 0.02 && (await lastLabel()) === 'Adjust handle', `cross=${cross.toFixed(3)}`);

  await hold([800, 600]);
  o = (await objs())[0];
  check('holding a curved anchor makes it sharp', Math.hypot(...o.geometry.segments[2].ho) === 0 && Math.hypot(...o.geometry.segments[2].hi) === 0 && (await lastLabel()) === 'Make anchor sharp');
  await pg.screenshot({ path: `${SHOTS}/05-path-edit.png` });

  // Double-click the right edge (straight, x = 800 from y 300 to 600) to add an anchor there.
  const count0 = (await objs())[0].geometry.segments.length;
  await pg.mouse.dblclick(...(await P(800, 450)));
  o = (await objs())[0];
  const added = o.geometry.segments[(await st()).pathEdit.selected[0]];
  check('double-clicking the path adds an anchor there', o.geometry.segments.length === count0 + 1 && near(docOf(o, added.p), [800, 450], 3)
    && (await lastLabel()) === 'Add anchor', `${count0} -> ${o.geometry.segments.length}`);

  await pg.mouse.dblclick(...(await P(800, 450)));
  check('double-clicking an anchor shows the X button', (await pg.locator('.pe-delete-pop button').count()) === 1);
  await pg.mouse.click(...(await P(1200, 900)));
  check('clicking elsewhere hides the X button and changes nothing',
    (await pg.locator('.pe-delete-pop').count()) === 0 && (await objs())[0].geometry.segments.length === count0 + 1 && (await st()).pathEdit !== null);

  await pg.mouse.dblclick(...(await P(800, 450)));
  await pg.locator('.pe-delete-pop button').click();
  check('the X button deletes the anchor', (await objs())[0].geometry.segments.length === count0 && (await lastLabel()) === 'Delete anchor'
    && (await pg.locator('.pe-delete-pop').count()) === 0);

  await pg.keyboard.press('Escape');
  check('Esc leaves path edit mode', (await st()).pathEdit === null);

  // Properties panel: no object Locked box, Appearance above Animation, sections collapse and remember it
  const props = pg.locator('aside.props');
  const titles = await props.locator('.section-title').allInnerTexts();
  check('object properties have no Locked checkbox', (await props.getByLabel('Locked', { exact: true }).count()) === 0 && (await props.getByLabel('Visible').count()) === 1);
  const ai = titles.findIndex((t) => /^appearance$/i.test(t)), ani = titles.findIndex((t) => /^animation$/i.test(t));
  check('Appearance sits above Animation', ai >= 0 && ani > ai, titles.join(', '));
  const transform = props.locator('section[aria-label="Transform"]');
  await transform.locator('.section-toggle').click();
  const hidden = (await transform.locator('.section-body').count()) === 0 && (await transform.locator('.section-toggle').getAttribute('aria-expanded')) === 'false';
  await pg.reload(); await pg.waitForSelector('.stage canvas'); await pg.waitForTimeout(400);
  await pg.evaluate((id) => window.__studio.set({ selection: [id] }), rect.id);
  const stillHidden = (await props.locator('section[aria-label="Transform"] .section-body').count()) === 0;
  await props.locator('section[aria-label="Transform"] .section-toggle').click();
  check('section toggle hides and shows a group, and is remembered', hidden && stillHidden
    && (await props.locator('section[aria-label="Transform"] .section-body').count()) === 1);
  await pg.evaluate(() => window.__studio.set({ selection: [] }));

  // Brush stroke: edit its centerline
  await pg.keyboard.press('b');
  await pg.mouse.move(...(await P(300, 800))); await pg.mouse.down();
  for (let i = 0; i <= 30; i++) await pg.mouse.move(...(await P(300 + i * 20, 800)));
  await pg.mouse.up();
  const strokeBefore = (await objs()).find((x) => x.brush);
  await pg.keyboard.press('v');
  await pg.mouse.dblclick(...(await P(600, 800)));
  check('double-click a brush stroke edits its centerline', (await st()).pathEdit?.id === strokeBefore.id && (await pg.locator('.pe-anchor').count()) >= 2);
  await drag([600, 800], [600, 700]);
  const stroke = (await objs()).find((x) => x.id === strokeBefore.id);
  const yMin = Math.min(...stroke.brush.samples.map((q) => q[1]));
  check('bending a brush stroke re-draws it along the new centerline', !!stroke.brush.spine && docOf(stroke, [0, yMin])[1] < 720 && stroke.geometry.closed,
    `min y ${docOf(stroke, [0, yMin])[1].toFixed(1)}`);
  await pg.keyboard.press('ControlOrMeta+z');
  const undone = (await objs()).find((x) => x.id === strokeBefore.id);
  check('undo restores the brush stroke', !undone.brush.spine && undone.brush.samples.length === strokeBefore.brush.samples.length);

  // Combine shapes
  await pg.keyboard.press('Escape');
  await pg.keyboard.press('u');
  await drag([1000, 150], [1300, 450]);
  const cBack = (await objs()).at(-1);
  await drag([1150, 300], [1450, 600]);
  const cFront = (await objs()).at(-1);
  const select2 = () => pg.evaluate((ids) => window.__studio.set({ selection: ids }), [cBack.id, cFront.id]);
  const docBounds = (o) => { const pts = [o.geometry.segments, ...(o.geometry.subpaths ?? []).map((x) => x.segments)].flat().map((q) => docOf(o, q.p));
    return [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))].map(Math.round); };
  const before = (await objs()).length;
  await select2();
  await props.getByRole('button', { name: /^Intersect:/ }).click();
  const sel = (await st()).selection;
  const made = (await objs()).find((x) => x.id === sel[0]);
  check('Intersect keeps only the overlap', (await objs()).length === before - 1 && JSON.stringify(docBounds(made)) === JSON.stringify([1150, 300, 1300, 450])
    && (await lastLabel()) === 'Intersect shapes', JSON.stringify(docBounds(made)));
  await pg.keyboard.press('ControlOrMeta+z');
  check('undo restores both shapes', (await objs()).length === before && (await objs()).some((x) => x.id === cBack.id) && (await objs()).some((x) => x.id === cFront.id));

  await select2();
  await pg.getByRole('menuitem', { name: 'Edit' }).click();
  await pg.getByRole('menuitem', { name: 'Combine: Exclude' }).click();
  const exId = (await st()).selection[0];
  const ex = (await objs()).find((x) => x.id === exId);
  check('Edit › Combine: Exclude leaves a compound shape with the overlap cut out', (await objs()).length === before - 1 && ex.geometry.subpaths?.length === 1
    && (await lastLabel()) === 'Exclude overlap');
  await pg.screenshot({ path: `${SHOTS}/06-combine.png` });
  await pg.keyboard.press('ControlOrMeta+z');

  await select2();
  await props.getByRole('button', { name: /^Divide:/ }).click();
  check('Divide splits overlapping shapes into three pieces', (await objs()).length === before + 1 && (await st()).selection.length === 3);
  await ctx2.close();
}

// Timeline keyframes: select and move (fresh context)
{
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx3.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errors.push('keys: ' + m.text()); });
  pg.on('pageerror', (e) => errors.push('keys pageerror: ' + e.message));
  await pg.goto('http://localhost:4173/');
  await pg.waitForSelector('.stage canvas');
  await pg.waitForTimeout(400);
  const st = () => pg.evaluate(() => window.__studio.get());
  // Layer: drawing A 1-10 (tween keys on 1 and 10), drawing B 11-20, empty 21-25, drawing C 26-30.
  await pg.evaluate(() => {
    const s = window.__studio.get();
    const o = (id, keys) => ({ id, name: id, kind: 'shape', visible: true, locked: false, opacity: 1, metadata: {}, keyframes: keys.map((f) => ({ frame: f, x: 300 + f * 20, y: 300, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ease: 'linear' })),
      style: { fill: { type: 'solid', color: '#3CC8D6FF' }, stroke: { type: 'none' }, strokeWidth: 0, cap: 'round', join: 'round', dash: [], fillRule: 'nonzero' },
      geometry: { shape: 'rect', width: 80, height: 80, sides: 4, cornerRadius: 0 }, transform: { x: 300, y: 300, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 40, pivotY: 40 } });
    const l = s.project.layers[0];
    const layer = { ...l, exposureTrack: [{ startFrame: 0, endFrame: 9, contentId: 'ka' }, { startFrame: 10, endFrame: 19, contentId: 'kb' }, { startFrame: 25, endFrame: 29, contentId: 'kc' }],
      objectTracks: [{ id: 'ka', objects: [o('ball', [0, 9])] }, { id: 'kb', objects: [o('box', [])] }, { id: 'kc', objects: [o('end', [])] }] };
    window.__studio.set({ project: { ...s.project, layers: [layer] }, activeLayerId: layer.id, currentFrame: 0 });
  });
  await pg.waitForTimeout(150);
  const rows = await pg.locator('.tl-rows canvas').boundingBox();
  const ppf = (await st()).timelineZoom;
  const DOT = (f) => [rows.x + (f + 0.5) * ppf, rows.y + 13];
  const DIA = (f) => [rows.x + (f + 0.5) * ppf, rows.y + 20];
  const spans = async () => (await st()).project.layers[0].exposureTrack.map((e) => `${e.startFrame}-${e.endFrame}`).join(' ');
  const sel = async () => (await st()).keySelection.map((k) => `${k.kind[0]}${k.frame}`).sort().join(' ');
  const label = async () => { const p = (await st()).past; return p[p.length - 1]?.label; };
  const dragTo = async (from, to) => { await pg.mouse.move(...from); await pg.mouse.down(); await pg.mouse.move(...to, { steps: 6 }); await pg.mouse.up(); };

  await pg.mouse.click(...DOT(10));
  check('clicking a drawing keyframe selects it', (await sel()) === 'd10' && (await st()).currentFrame === 10);
  await dragTo(DOT(10), DOT(13));
  check('dragging a keyframe moves it; the drawing before holds longer', (await spans()) === '0-12 13-22 25-29' && (await label()) === 'Move keyframe' && (await sel()) === 'd13',
    await spans());
  await pg.keyboard.press('ControlOrMeta+z');

  await pg.mouse.click(...DOT(10));
  await pg.keyboard.down('Shift'); await pg.mouse.click(...DOT(25)); await pg.keyboard.up('Shift');
  check('Shift-click adds keyframes to the selection', (await sel()) === 'd10 d25');
  await dragTo(DOT(10), DOT(12));
  check('dragging moves all selected keyframes together', (await spans()) === '0-11 12-21 27-31' && (await label()) === 'Move keyframes', await spans());
  await pg.keyboard.press('ControlOrMeta+z');

  await dragTo(DIA(9), DIA(6));
  const ballKeys = (await st()).project.layers[0].objectTracks.find((c) => c.id === 'ka').objects[0].keyframes.map((k) => k.frame).join(',');
  check('dragging a tween keyframe moves it within its drawing', ballKeys === '0,6' && (await sel()) === 't6', ballKeys);
  await pg.keyboard.press('ControlOrMeta+z');

  await dragTo(DOT(10), DOT(3));
  check('a keyframe stops instead of cutting off a tween key', (await spans()) === '0-9 10-19 25-29'
    && (await pg.locator('.toast', { hasText: 'Keyframes stop at the next key' }).count()) >= 1, await spans());

  await dragTo(DOT(21), DOT(27));
  check('dragging across frames selects the keyframes inside', (await sel()) === 'd25' && (await st()).frameRange !== null);
  await pg.keyboard.press('Escape');
  check('Esc clears the keyframe selection', (await sel()) === '');

  // Hold menu: copy a frame, click another frame to paste
  const holdAt = async (pt) => { await pg.mouse.move(...pt); await pg.mouse.down(); await pg.waitForTimeout(750); await pg.mouse.up(); };
  const menuItem = (name) => pg.locator('.tl-menu [role^="menuitem"]', { hasText: name });
  await holdAt(DOT(15));
  check('holding on a frame opens the frame menu', (await menuItem('Copy frame').count()) === 1 && (await menuItem('Delete frame').count()) === 1);
  await menuItem('Copy frame').click();
  check('Copy arms click-to-paste', (await st()).pasteArmed && (await pg.locator('.tl-paste-banner').count()) === 1);
  await pg.mouse.click(...DOT(3));
  check('clicking a frame pastes there and pushes later frames right', (await spans()) === '0-2 3-3 4-10 11-20 26-30' && (await label()) === 'Paste frames'
    && !(await st()).pasteArmed, await spans());
  await pg.keyboard.press('ControlOrMeta+z');

  await holdAt(DOT(10));
  check('holding on a keyframe opens the keyframe menu', (await menuItem('Delete keyframe').count()) === 1);
  await menuItem('Delete keyframe').click();
  check('deleting a drawing keyframe lets the drawing before it hold', (await spans()) === '0-19 25-29' && (await label()) === 'Delete keyframe', await spans());
  await pg.keyboard.press('ControlOrMeta+z');

  await pg.evaluate(() => window.__studio.set({ toasts: [] })); // undo toasts stack over this part of the timeline
  await pg.mouse.click(...DOT(27), { button: 'right' });
  const rightMenu = (await menuItem('Copy frame').count()) === 1;
  await pg.keyboard.press('Escape');
  check('right-click opens the menu; Esc closes it without changes', rightMenu && (await pg.locator('.tl-menu').count()) === 0 && (await spans()) === '0-9 10-19 25-29',
    `menu=${rightMenu} open=${await pg.locator('.tl-menu').count()} ${await spans()}`);

  await pg.mouse.dblclick(...DIA(0));
  check('double-clicking a keyframe opens the ease menu', (await pg.locator('.tl-menu [role="menuitemradio"]').count()) === 4
    && (await pg.locator('.tl-menu [role="menuitemradio"][aria-checked="true"]').innerText()).includes('Linear'));
  await pg.screenshot({ path: `${SHOTS}/07-ease-menu.png` });
  await pg.locator('.tl-menu [role="menuitemradio"]', { hasText: 'Ease out' }).click();
  const ease0 = (await st()).project.layers[0].objectTracks.find((c) => c.id === 'ka').objects[0].keyframes[0].ease;
  check('choosing an ease sets it on the keyframe', ease0 === 'easeOut' && (await label()) === 'Set ease', ease0);
  await ctx3.close();
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
