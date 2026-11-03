// Visual walkthrough screenshots (desktop + iPad-sized touch viewport). node scripts/visual.mjs <outDir>
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
const OUT = process.argv[2] ?? 'test-results';
const server = serve('dist', 4174);
const browser = await chromium.launch();
const errors = [];
async function session(name, opts, fn) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto('http://localhost:4174/');
  await page.waitForSelector('.stage canvas');
  await page.waitForTimeout(300);
  await fn(page);
  await ctx.close();
}
await session('desktop', { viewport: { width: 1440, height: 900 } }, async (page) => {
  const st = await page.locator('.stage').boundingBox();
  const at = (fx, fy) => [st.x + st.width * fx, st.y + st.height * fy];
  // gradient ellipse
  await page.keyboard.press('u');
  await page.getByRole('radio', { name: 'Ellipse' }).click();
  await page.mouse.move(...at(0.25, 0.3)); await page.mouse.down(); await page.mouse.move(...at(0.4, 0.6), { steps: 4 }); await page.mouse.up();
  await page.getByRole('button', { name: /^Fill:/ }).first().click();
  await page.getByRole('radio', { name: 'Linear' }).click();
  await page.screenshot({ path: `${OUT}/v1-gradient-popover.png` });
  await page.keyboard.press('Escape');
  // pen path
  await page.keyboard.press('p');
  await page.mouse.click(...at(0.5, 0.3));
  await page.mouse.move(...at(0.6, 0.3)); await page.mouse.down(); await page.mouse.move(...at(0.66, 0.45), { steps: 4 }); await page.mouse.up();
  await page.mouse.move(...at(0.7, 0.6)); await page.mouse.down(); await page.mouse.move(...at(0.75, 0.62), { steps: 3 }); await page.mouse.up();
  await page.mouse.move(...at(0.55, 0.62));
  await page.screenshot({ path: `${OUT}/v2-pen-draft.png` });
  await page.keyboard.press('Enter');
  // text
  await page.keyboard.press('t');
  await page.mouse.click(...at(0.3, 0.8));
  await page.keyboard.type('Hello frames');
  await page.screenshot({ path: `${OUT}/v3-text-edit.png` });
  await page.keyboard.press('Control+Enter');
  // brush frames + onion skin
  await page.keyboard.press('b');
  for (let f = 0; f < 3; f++) {
    await page.mouse.move(...at(0.75, 0.75 - f * 0.08)); await page.mouse.down();
    for (let i = 0; i < 12; i++) await page.mouse.move(...at(0.75 + i * 0.01, 0.75 - f * 0.08 + Math.sin(i / 2) * 0.03));
    await page.mouse.up();
    if (f < 2) await page.keyboard.press('F7');
  }
  await page.keyboard.press('Alt+Shift+O');
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/v4-onion-brush.png` });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.screenshot({ path: `${OUT}/v5-menu.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+?');
  await page.screenshot({ path: `${OUT}/v6-shortcuts.png` });
});
await session('ipad', { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false }, async (page) => {
  await page.screenshot({ path: `${OUT}/v7-ipad.png` });
});
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close(); server.close();
