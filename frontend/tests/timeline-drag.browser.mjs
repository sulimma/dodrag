// Bounded regression: real pointer capture, CSS hit targets and visible insertion
// feedback. DOM tests separately cover persistence; no native app/user database.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5196, strictPort: true, hmr: false } });
await server.listen();
let browser;
try {
 browser = await chromium.launch({ headless: true });
 const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
 page.setDefaultTimeout(8000);
 const errors = []; page.on('pageerror', error => errors.push(String(error)));
 const html = await server.transformIndexHtml('/__timeline_test', '<div id="fixture"></div><script type="module" src="/tests/timeline-drag.fixture.tsx"></script>');
 await page.route('**/__timeline_test*', route => route.fulfill({ contentType: 'text/html', body: html }));
 for (const zoom of [1, 1.5, 2]) {
  await page.goto(`http://127.0.0.1:5196/__timeline_test?zoom=${zoom}`);
  await page.locator('[data-task-drag="B"]').waitFor();
  const marker = page.locator('[data-task-drag="marker:date:2026-11-12"]');
  const dragTo = async (source, x, y) => {
   const box = await source.boundingBox();
   await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down();
   await page.mouse.move(x, y, { steps: 6 });
  };
  // A marker uses both card halves; the actual gap works too. Normal task-card
  // centers retain their dependency action, rather than becoming insertion zones.
  for (const position of ['upper', 'lower', 'gap']) {
   const a = await page.locator('[data-task-drag="A"]').boundingBox();
   const b = await page.locator('[data-task-drag="B"]').boundingBox();
   const y = position === 'gap' ? (a.y + a.height + b.y) / 2 : b.y + b.height * (position === 'upper' ? .25 : .75);
   const count = (await page.locator('#moves').textContent()).split('|').filter(Boolean).length;
   await dragTo(marker, b.x + 150, y);
   const expected = position === 'gap' ? ['insert:A:after', 'insert:B:before'] : [`insert:B:${position === 'upper' ? 'before' : 'after'}`];
   await page.waitForFunction(expected => expected.includes(document.querySelector('#target').textContent), expected);
   const target = await page.locator('#target').textContent();
   assert.ok(position === 'gap' ? ['insert:A:after', 'insert:B:before'].includes(target) : target === `insert:B:${position === 'upper' ? 'before' : 'after'}`, target);
   const visibleLine = await page.locator('[data-insertion-active="true"] > div').evaluate(line => {
    const style = getComputedStyle(line), rect = line.getBoundingClientRect();
    return rect.width > 0 && parseFloat(style.borderTopWidth) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.borderTopColor);
   });
   assert.ok(visibleLine, 'Insertion feedback must be visibly painted');
   await page.mouse.up();
   await page.waitForFunction(count => document.querySelector('#moves').textContent.split('|').filter(Boolean).length === count + 1, count);
   assert.ok((await page.locator('#moves').textContent()).endsWith(target.replace('insert:', 'marker:')));
  }
  const b = await page.locator('[data-task-drag="B"]').boundingBox();
  await dragTo(page.locator('[data-task-drag="A"]'), b.x + 150, b.y + b.height / 2);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#moves').textContent.endsWith('dependency'));
  console.log(`PASS: marker card halves/gap, visible feedback, release and unchanged task-card drop at ${zoom * 100}% CSS zoom`);
 }
 assert.deepEqual(errors, []);
} finally { await browser?.close(); await server.close(); }
