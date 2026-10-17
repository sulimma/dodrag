import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const view of ['Liste', 'Netzplan', 'Gantt']) {
    const horizontal = view === 'Gantt';
    const page = await browser.newPage({ viewport: { width: 1400, height: 650 } });
    await page.addInitScript(() => {
      const today = new Date(); today.setHours(9, 0, 0, 0);
      const iso = today.toISOString();
      let seq = 0;
      const event = (type, payload) => ({ seq: ++seq, id: `e${seq}`, timestamp: iso, type, payload, undone: false });
      const ids = Array.from({ length: 30 }, (_, i) => `T${String(i).padStart(2, '0')}`);
      const events = ids.map((taskId, i) => {
        const date = new Date(today); date.setDate(date.getDate() + i);
        return event('TASK_CREATED', { taskId, title: `Title ${taskId}`, configuredStart: date.toISOString(), createdAt: iso });
      });
      for (let i = 1; i < ids.length; i++) events.push(event('DEPENDENCY_ADDED', { predecessorId: ids[i - 1], taskId: ids[i] }));
      const far = new Date(today); far.setDate(far.getDate() + 80);
      events.push(event('TASK_CREATED', { taskId: 'FAR', title: 'Outside calendar window', configuredStart: far.toISOString(), createdAt: iso }));
      events.push(event('DEPENDENCY_ADDED', { predecessorId: 'T29', taskId: 'FAR' }));
      events.push(event('TASK_CREATED', { taskId: 'X', title: 'Unrelated', configuredStart: iso, createdAt: iso }));
      localStorage.setItem('dodrag_sqlite_fallback_events_v1', JSON.stringify(events));
      localStorage.setItem('dodrag_settings_fallback_v1', JSON.stringify({ knownDatabases: [{ name: 'test', path: 'test.db', exists: true, isDemo: false }], activeDatabasePath: 'test.db', autostart: false }));
    });
    await page.goto('http://127.0.0.1:5197');
    await page.getByRole('button', { name: view, exact: true }).click();
    const selected = page.locator(horizontal ? '[data-gantt-node="T15"]' : 'main [data-task-drag="T15"]');
    await selected.waitFor();
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await selected.evaluate(row => row.scrollIntoView({ block: 'center', inline: 'center' }));
    const layout = () => page.locator('main').evaluate(main => ({ width: main.clientWidth, height: main.clientHeight,
      scrollWidth: main.scrollWidth, scrollHeight: main.scrollHeight, scrollTop: main.scrollTop, scrollLeft: main.scrollLeft,
      rows: [...main.querySelectorAll('[data-task-drag]')].map(row => { const r = row.getBoundingClientRect(); return [r.top, r.left]; }) }));
    const select = () => horizontal ? selected.click() : selected.locator('[data-drag-handle]').click();
    const checkCounts = async () => {
      await page.waitForFunction(horizontal => {
        const main = document.querySelector('main');
        const viewport = main.getBoundingClientRect();
        const start = horizontal ? viewport.left + main.clientLeft : viewport.top + main.clientTop;
        const end = start + (horizontal ? main.clientWidth : main.clientHeight);
        return ['predecessor', 'successor'].every(role => {
          const count = [...main.querySelectorAll(`[data-dependency-highlight="${role}"]`)].filter(row => {
            if (row.dataset.highlightSide) return row.dataset.highlightSide === (role === 'predecessor' ? 'before' : 'after');
            const rect = row.getBoundingClientRect();
            return role === 'predecessor' ? (horizontal ? rect.right : rect.bottom) <= start : (horizontal ? rect.left : rect.top) >= end;
          }).length;
          const badge = document.querySelector(`[data-dependency-indicator="${role}"]`);
          return count === 0 ? !badge : badge?.textContent.trim() === String(count);
        });
      }, horizontal);
    };
    const before = await layout();
    await select();
    await checkCounts();
    assert.equal(await page.locator('[data-dependency-indicator]').count(), 2, 'both directions outside viewport');
    assert.deepEqual(await layout(), before, 'appearing overlays do not shift layout');
    for (const [role, color, arrow] of [['predecessor', 'amber', horizontal ? 'left' : 'up'], ['successor', 'purple', horizontal ? 'right' : 'down']]) {
      const badge = page.locator(`[data-dependency-indicator="${role}"]`);
      assert.ok((await badge.getAttribute('class')).includes(`text-${color}-800`));
      assert.equal(await badge.locator(`svg.lucide-arrow-${arrow}`).count(), 1, 'arrow direction');
    }
    await page.locator('main').evaluate((main, horizontal) => { if (horizontal) main.scrollLeft = 0; else main.scrollTop = 0; }, horizontal);
    await checkCounts();
    assert.equal(await page.locator('[data-dependency-indicator="predecessor"]').count(), 0);
    await page.locator('main').evaluate((main, horizontal) => { if (horizontal) main.scrollLeft = main.scrollWidth; else main.scrollTop = main.scrollHeight; }, horizontal);
    await checkCounts();
    if (horizontal) {
      assert.equal((await page.locator('[data-dependency-indicator="successor"]').textContent()).trim(), '1', 'unrendered far successor still counted');
      assert.equal(await page.locator('[data-gantt-node="FAR"]').count(), 0);
    } else assert.equal(await page.locator('[data-dependency-indicator="successor"]').count(), 0);
    await page.setViewportSize({ width: 1100, height: 480 });
    await checkCounts();
    await selected.evaluate(row => row.scrollIntoView({ block: 'center', inline: 'center' }));
    await checkCounts();
    const highlighted = await layout();
    await select();
    await checkCounts();
    assert.equal(await page.locator('[data-dependency-indicator]').count(), 0, 'deselection clears overlays');
    assert.deepEqual(await layout(), highlighted, 'disappearing overlays do not shift layout');
    await select();
    await checkCounts();
    if (horizontal) {
      await page.getByRole('button', { name: 'Naechstes Zeitfenster', exact: true }).click({ force: true });
      await checkCounts();
      assert.equal((await page.locator('[data-dependency-indicator="predecessor"]').textContent()).trim(), '15', 'unrendered predecessors counted once after navigation');
    }
    await page.getByRole('button', { name: view === 'Liste' ? 'Netzplan' : 'Liste', exact: true }).click();
    await page.getByRole('button', { name: view, exact: true }).click();
    await checkCounts();
    console.log(`PASS ${view}: exact dependency counts, arrow direction, scrolling, resize, selection, view switching, stable layout`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
