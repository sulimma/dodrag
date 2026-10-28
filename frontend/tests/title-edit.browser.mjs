import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Disposable Chromium input check only, not native SQLite/Windows/WebView2 verification.
const server = await createServer({ server: { host: '127.0.0.1', port: 5199, strictPort: true } });
let browser;
const failures = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const view of ['Liste', 'Netzplan', 'Gantt', 'Detail', 'Mini']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 850 }, locale: 'de-DE' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        const iso = new Date().toISOString();
        localStorage.setItem('dodrag_sqlite_fallback_events_v1', JSON.stringify(['Alpha bravo', 'Charlie delta'].map((title, i) => ({
          seq: i + 1, id: `title-test-${i}`, timestamp: iso, undone: false, type: 'TASK_CREATED',
          payload: { taskId: `26-${101 + i}`, title, configuredStart: iso, createdAt: iso },
        }))));
        localStorage.setItem('dodrag_settings_fallback_v1', JSON.stringify({
          knownDatabases: [{ name: 'title-test', path: 'title-test.db', exists: true, isDemo: false }],
          activeDatabasePath: 'title-test.db', autostart: false, language: 'de',
        }));
      });
      await page.goto('http://127.0.0.1:5199', { timeout: 60000 });
      await page.locator('[data-task-drag="26-101"] [data-task-title]').waitFor();
      if (view === 'Mini') await page.getByTitle('Minimieren (Kompaktansicht in Bildschirmecke)', { exact: true }).click();
      else if (view === 'Detail') {
        await page.locator('[data-task-drag="26-101"] [data-drag-handle]').click();
        await page.locator('[data-detail-toggle]').click();
      } else await page.getByRole('button', { name: view, exact: true }).click();
      const selector = view === 'Mini' ? '[data-mini-task-id="26-101"] span[data-task-title]'
        : view === 'Detail' ? '[data-task-detail-panel] span[data-task-title]' : '[data-task-drag="26-101"] span[data-task-title]';
      const title = page.locator(selector);
      await title.waitFor();
      await title.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
      assert.equal(await title.getAttribute('contenteditable'), 'true');
      assert.equal(await title.getAttribute('data-task-title-editing'), null);
      const node = await title.elementHandle();
      const layout = () => title.evaluate(node => [node, node.parentElement].map(e => {
        const { x, y, width, height } = e.getBoundingClientRect();
        return { x, y, width, height, tag: e.tagName, children: e.childNodes.length };
      }));
      const before = await layout();
      const stable = async () => {
        assert.ok(await node.evaluate(n => n.isConnected && n === document.activeElement), `${view}: original span retains focus`);
        const after = await layout();
        for (let i = 0; i < before.length; i++) {
          for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[i][key] - after[i][key]) <= 0.5, `${view}: stable ${key}`);
          for (const key of ['tag', 'children']) assert.equal(after[i][key], before[i][key], `${view}: stable DOM ${key}`);
        }
      };
      // Caret boundaries avoid ambiguous subpixel hit-testing at narrow glyph midpoints.
      const point = index => title.evaluate((node, index) => {
        const range = document.createRange();
        range.setStart(node.firstChild, index); range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2 };
      }, index);
      const selection = () => title.evaluate(node => {
        const s = window.getSelection();
        return { text: s.toString().trim(), inside: node.contains(s.anchorNode) && node.contains(s.focusNode) };
      });
      const events = () => page.evaluate(() => JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')));
      const inactive = () => page.waitForFunction(selector => {
        const n = document.querySelector(selector); return n && !n.hasAttribute('data-task-title-editing');
      }, selector);
      const commit = async value => {
        await page.waitForFunction(value => JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1'))
          .some(e => e.type === 'TASK_RENAMED' && e.payload.taskId === '26-101' && e.payload.title === value), value);
        await inactive(); assert.equal(await title.textContent(), value);
      };
      const details = () => page.evaluate(() => document.querySelector('[data-detail-toggle]')?.getAttribute('aria-expanded') ?? null);
      const initialDetails = await details();
      const start = await point(1), end = await point(5);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      assert.equal(await page.locator('[data-task-drag-preview]').count(), 0);
      assert.deepEqual(await selection(), { text: 'lpha', inside: true }, `${view}: selection during inactive-title mouse drag`);
      await page.mouse.up();
      assert.deepEqual(await selection(), { text: 'lpha', inside: true }, `${view}: selection survives release`);
      assert.equal(await title.getAttribute('data-task-title-editing'), 'true');
      await stable(); await page.keyboard.press('Escape'); await inactive();
      const caret = await point(3);
      await page.mouse.click(caret.x, caret.y); await stable();
      await page.keyboard.type('x'); await page.keyboard.press('Enter'); await commit('Alpxha bravo');
      const word = await point(2);
      await page.mouse.dblclick(word.x, word.y);
      assert.deepEqual(await selection(), { text: 'Alpxha', inside: true }, `${view}: double click selects word`);
      assert.equal(await details(), initialDetails, `${view}: no title detail toggle`);
      if (view === 'Mini') assert.ok(await page.getByTitle('Fenster wiederherstellen', { exact: true }).isVisible());
      const beforeCancel = await events();
      await page.keyboard.type('Cancelled'); await page.keyboard.press('Escape'); await inactive();
      assert.equal(await title.textContent(), 'Alpxha bravo'); assert.deepEqual(await events(), beforeCancel);
      await title.focus(); assert.equal(await title.getAttribute('data-task-title-editing'), 'true');
      await page.keyboard.press('Control+a'); await page.keyboard.type('Echo bravo');
      await (view === 'Mini' ? page.locator('input').first()
        : page.locator(`button[aria-keyshortcuts="Control+${view === 'Netzplan' ? 2 : view === 'Gantt' ? 3 : 1}"]`)).click();
      await commit('Echo bravo');
      assert.equal((await events()).filter(e => e.type === 'TASK_RENAMED').length, 2);
      assert.deepEqual(errors, []);
      console.log(`PASS ${view}: inactive drag selection, stable DOM/layout, click/type/Enter, word double-click, Escape, focus/blur`);
    } catch (error) {
      failures.push(`${view}: ${error.stack || error}`); console.error(`FAIL ${view}:`, error);
    } finally { await context.close(); }
  }
  assert.equal(failures.length, 0, failures.join('\n\n'));
} finally { await browser?.close(); await server.close(); }
