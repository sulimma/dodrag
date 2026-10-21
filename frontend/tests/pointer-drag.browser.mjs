import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Limited Chromium input check; does not verify the native Windows/WebView2 host.
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', error => console.error('PAGE ERROR:', error));
  await page.addInitScript(() => {
    const iso = new Date().toISOString(); let seq = 0;
    const event = (type, payload) => ({ seq: ++seq, id: `e${seq}`, timestamp: iso, type, payload, undone: false });
    const events = Array.from({ length: 60 }, (_, i) => event('TASK_CREATED', {
      taskId: `T${i}`, title: `Task ${i}`, configuredStart: iso, createdAt: iso,
    }));
    localStorage.setItem('dodrag_sqlite_fallback_events_v1', JSON.stringify(events));
    localStorage.setItem('dodrag_settings_fallback_v1', JSON.stringify({
      knownDatabases: [{ name: 'test', path: 'test.db', exists: true, isDemo: false }],
      activeDatabasePath: 'test.db', autostart: false,
    }));
  });
  await page.goto('http://127.0.0.1:5198');
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  const source = page.locator('[data-task-drag="T0"]');
  await source.waitFor();
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  for (let run = 0; run < 2; run++) {
    await source.scrollIntoViewIfNeeded();
    const bounds = await (run === 0 ? source.locator('[data-drag-handle]') : source.locator('[data-task-title-area]')).boundingBox();
    const startX = run === 0 ? bounds.x + bounds.width / 2 : bounds.x + bounds.width - 10;
    if (run === 1) {
      const text = await source.locator('[data-task-selectable-text]').boundingBox();
      assert.ok(startX > text.x + text.width, 'free list area is not part of selectable title text');
    }
    await page.mouse.move(startX, bounds.y + bounds.height / 2);
    if (run === 1) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(startX + 30, bounds.y + bounds.height / 2, { steps: 5 });
    await page.waitForSelector('[data-task-drag-preview]', { timeout: 3000 });
    await page.mouse.move(500, 400);
    const before = await source.evaluate(node => node.closest('.overflow-y-auto').scrollTop);
    await page.mouse.wheel(0, 450);
    await page.waitForFunction(before => document.querySelector('[data-task-drag]').closest('.overflow-y-auto').scrollTop > before + 100, before);
    assert.equal(await page.locator('[data-task-drag-preview]').count(), 1);
    await page.keyboard.press('Escape'); await page.mouse.up();
    if (run === 1) await page.keyboard.up('Alt');
    assert.equal(await page.locator('[data-task-drag-preview]').count(), 0);
  }
  await page.getByRole('button', { name: 'Gantt', exact: true }).click();
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const bar = page.locator('[data-gantt-node="T0"]');
  await bar.scrollIntoViewIfNeeded();
  const bounds = await bar.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 15, bounds.y + bounds.height / 2, { steps: 5 });
  await page.waitForSelector('[data-task-drag-preview]');
  await page.mouse.move(700, 400);
  const scrollLeft = await bar.evaluate(node => node.closest('.overflow-y-auto').scrollLeft);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 450);
  await page.waitForFunction(before => document.querySelector('[data-gantt-node]').closest('.overflow-y-auto').scrollLeft > before + 100, scrollLeft);
  await page.keyboard.up('Shift');
  assert.equal(await page.locator('[data-task-drag-preview]').count(), 1);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Alt');
  assert.equal(await page.locator('[data-task-drag-preview]').count(), 0);
  console.log('PASS: repeated real pointer drags retain native browser wheel scrolling');
} finally {
  await browser.close(); await server.close();
}
