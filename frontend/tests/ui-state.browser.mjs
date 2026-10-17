import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
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
  await alpha.click();
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

  for (const overlay of ['help', 'context']) {
    for (const focus of ['button', 'input']) {
      if (overlay === 'help') await page.getByTitle('Tastenkürzel & Bedienung (?)', { exact: true }).click();
      else await alpha.click({ button: 'right' });
      const overlayText = overlay === 'help' ? 'Tastenkürzel & Drag-and-Drop Steuerung' : 'Als erledigt markieren';
      await page.getByText(overlayText, { exact: true }).waitFor();
      if (focus === 'button') {
        const heading = page.getByText(overlay === 'help' ? overlayText : 'Task 26-101', { exact: true });
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
} finally {
  await browser?.close();
  await server.close();
}
