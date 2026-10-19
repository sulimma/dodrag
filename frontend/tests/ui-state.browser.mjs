import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'de-DE' });
  await page.addInitScript(() => {
    const iso = new Date().toISOString();
    const events = ['Alpha', 'Beta'].map((title, index) => ({
      seq: index + 1, id: `e${index}`, timestamp: iso, undone: false, type: 'TASK_CREATED',
      payload: { taskId: `26-${101 + index}`, title, configuredStart: iso, createdAt: iso },
    }));
    localStorage.setItem('dodrag_sqlite_fallback_events_v1', JSON.stringify(events));
    localStorage.setItem('dodrag_settings_fallback_v1', JSON.stringify({
      knownDatabases: [{ name: 'test', path: 'test.db', exists: true, isDemo: false }],
      activeDatabasePath: 'test.db', autostart: false,
    }));
  });
  await page.goto('http://127.0.0.1:5197');
  const alpha = page.locator('span[title="Alpha"]');
  await alpha.waitFor();
  const sidebarLayout = () => page.locator('aside').evaluate(aside => [...aside.children].map(child => {
    const { x, y, width, height } = child.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const unselectedLayout = await sidebarLayout();
  await alpha.click();
  assert.deepEqual(await sidebarLayout(), unselectedLayout, 'single selection must not move sidebar targets');
  await page.locator('span[title="Beta"]').click({ modifiers: ['Control'] });
  assert.deepEqual(await sidebarLayout(), unselectedLayout, 'multiple selection must not move sidebar targets');
  assert.equal(await page.locator('aside').getByText('Als erledigt markieren', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await alpha.click();
  console.log('PASS sidebar: no extra completion control or layout shift on single/multiple selection');
  const before = await page.evaluate(() => localStorage.getItem('dodrag_sqlite_fallback_events_v1'));
  await page.getByTitle('Minimieren (Kompaktansicht in Bildschirmecke)', { exact: true }).click();
  await page.locator('button[title="Fenster wiederherstellen"]').waitFor();
  await page.evaluate(() => document.activeElement?.blur());
  for (const key of ['Delete', 'd', 'a', 'Space', 'F2', 'e', 'Enter', 'n', '?', 'Control+z', 'Control+y', 'Control+Shift+z']) {
    await page.keyboard.press(key);
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('dodrag_sqlite_fallback_events_v1')), before);
  assert.equal(await page.locator('input').count(), 0);
  await page.getByTitle('Fenster wiederherstellen', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await alpha.waitFor();
  assert.equal(await page.getByText('Tastenkürzel & Drag-and-Drop Steuerung', { exact: true }).count(), 0);

  await page.getByTitle('Minimieren (Kompaktansicht in Bildschirmecke)', { exact: true }).click();
  await page.locator('button[title="Alpha"]').focus();
  await page.keyboard.press('Space');
  await alpha.waitFor();
  assert.equal(await page.locator('input[aria-label^="Titel "]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('dodrag_sqlite_fallback_events_v1')), before);
  console.log('PASS mini: hidden shortcuts blocked; native Enter restore and Space task-button activation');

  for (const close of ['button', 'backdrop', 'Escape']) {
    const frames = await page.evaluate(async close => {
      const heading = () => [...document.querySelectorAll('h3')].find(node => node.textContent === 'Tastenkürzel & Drag-and-Drop Steuerung');
      const sample = async () => {
        const frames = [];
        // Observe the first paint and the former exit-animation window, without locator auto-waiting.
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const dialog = heading()?.parentElement.parentElement;
          frames.push(dialog ? [dialog, dialog.parentElement].map(node => {
            const style = getComputedStyle(node);
            return { opacity: style.opacity, transform: style.transform, animations: node.getAnimations().length };
          }) : null);
        }
        return frames;
      };
      document.querySelector('button[title="Tastenkürzel & Bedienung (?)"]').click();
      const opened = await sample();
      const dialog = heading().parentElement.parentElement;
      dialog.click();
      const stayedOpen = Boolean(heading());
      if (close === 'button') dialog.querySelector('button[aria-label="Schließen"]').click();
      else if (close === 'backdrop') dialog.parentElement.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { opened, stayedOpen, closed: await sample() };
    }, close);
    assert.equal(frames.stayedOpen, true, 'clicking help content must not close it');
    assert.ok(frames.opened.every(frame => frame?.every(style => style.opacity === '1' && style.transform === 'none' && style.animations === 0)), 'help must be fully visible from the first frame without fade/zoom');
    assert.ok(frames.closed.every(frame => frame === null), `${close}: help must disappear on the first frame and never flash back`);
  }
  console.log('PASS help: no fade/zoom or retained exit layer; button/backdrop/Escape stay closed across 30 frames');

  for (const overlay of ['help', 'context']) {
    for (const focus of ['button', 'input']) {
      if (overlay === 'help') await page.getByTitle('Tastenkürzel & Bedienung (?)', { exact: true }).click();
      else await alpha.click({ button: 'right' });
      const overlayText = overlay === 'help' ? 'Tastenkürzel & Drag-and-Drop Steuerung' : 'Task 26-101';
      await page.getByText(overlayText, { exact: true }).waitFor();
      if (focus === 'button') {
        const heading = page.getByText(overlayText, { exact: true });
        await heading.locator('xpath=../..').locator('button').first().focus();
      } else {
        await page.locator('input').first().focus();
      }
      await page.keyboard.press('Escape');
      await page.getByText(overlayText, { exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => localStorage.getItem('dodrag_sqlite_fallback_events_v1')), before);
    }
  }
  console.log('PASS help/context: Escape with button and input focus, no underlying mutation');

  const ganttPage = await browser.newPage({ viewport: { width: 1400, height: 700 }, locale: 'de-DE' });
  await ganttPage.addInitScript(() => {
    const iso = new Date().toISOString();
    const events = Array.from({ length: 40 }, (_, index) => ({
      seq: index + 1, id: `g${index}`, timestamp: iso, undone: false, type: 'TASK_CREATED',
      payload: {
        taskId: `26-${101 + index}`, title: `Gantt ${index + 1}`,
        configuredStart: index === 1 ? new Date(Date.now() + 3 * 86400000).toISOString() : iso,
        createdAt: iso,
      },
    }));
    events.push({ seq: 41, id: 'dependency', timestamp: iso, undone: false, type: 'DEPENDENCY_ADDED',
      payload: { taskId: '26-102', predecessorId: '26-101' } });
    localStorage.setItem('dodrag_sqlite_fallback_events_v1', JSON.stringify(events));
    localStorage.setItem('dodrag_settings_fallback_v1', JSON.stringify({
      knownDatabases: [{ name: 'test', path: 'test.db', exists: true, isDemo: false }],
      activeDatabasePath: 'test.db', autostart: false,
    }));
  });
  await ganttPage.goto('http://127.0.0.1:5197');
  await ganttPage.getByRole('button', { name: 'Gantt', exact: true }).click();
  const list = ganttPage.locator('[data-gantt-list]');
  const firstDay = ganttPage.locator('[data-gantt-date] > div').first();
  await list.waitFor();
  await ganttPage.locator('[data-gantt-node="26-102"]').click();
  const predecessor = ganttPage.locator('[data-gantt-node="26-101"][data-dependency-highlight="predecessor"]');
  await predecessor.waitFor();
  const initialGeometry = await ganttPage.evaluate(() => {
    const main = document.querySelector('main');
    const list = document.querySelector('[data-gantt-list]');
    const day = document.querySelector('[data-gantt-date] > div');
    return { listLeft: list.getBoundingClientRect().left, listRight: list.getBoundingClientRect().right, dayLeft: day.getBoundingClientRect().left, mainLeft: main.getBoundingClientRect().left };
  });
  assert.ok(initialGeometry.listLeft <= initialGeometry.mainLeft + 1, 'frozen list must start at the scrollport left edge');
  await ganttPage.evaluate(() => { document.querySelector('main').scrollLeft = 100; });
  await predecessor.waitFor({ state: 'visible' });
  await ganttPage.locator('[data-dependency-indicator="predecessor"]').waitFor();
  const indicatorBox = await ganttPage.locator('[data-dependency-indicator="predecessor"]').boundingBox();
  const predecessorCovered = await ganttPage.evaluate(() => {
    const rect = document.querySelector('[data-gantt-node="26-101"]').getBoundingClientRect();
    const list = document.querySelector('[data-gantt-list]').getBoundingClientRect();
    const overlapX = Math.max(0, Math.min(rect.right, list.right) - Math.max(rect.left, list.left));
    const overlapY = Math.max(0, Math.min(rect.bottom, list.bottom) - Math.max(rect.top, list.top));
    return overlapX > 0 && overlapY > 0;
  });
  assert.ok(predecessorCovered, 'predecessor must be behind the frozen list');
  assert.ok(indicatorBox && Math.abs(indicatorBox.x - initialGeometry.listRight - 8) <= 2, 'predecessor indicator must sit beside the frozen list, not at the window edge');
  await ganttPage.evaluate(() => { document.querySelector('main').scrollLeft = 500; });
  await ganttPage.waitForTimeout(50);
  const after = await ganttPage.evaluate(() => ({
    listLeft: document.querySelector('[data-gantt-list]').getBoundingClientRect().left,
    dayLeft: document.querySelector('[data-gantt-date] > div').getBoundingClientRect().left,
    scrollLeft: document.querySelector('main').scrollLeft,
  }));
  assert.ok(after.scrollLeft > 0, 'Gantt timeline must scroll horizontally');
  assert.ok(Math.abs(after.listLeft - initialGeometry.listLeft) <= 1, 'left task list must stay fixed during horizontal scrolling');
  assert.ok(after.dayLeft < initialGeometry.dayLeft - 400, 'date columns must still scroll horizontally');
  assert.ok(await list.isVisible() && await firstDay.isVisible());
  console.log('PASS Gantt: frozen left list, covered predecessor count, and indicator at timeline edge');
  await ganttPage.close();
} finally {
  await browser?.close();
  await server.close();
}
