// Bounded Chromium font/layout check, not native frame/DPI/WebView2 verification.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const taskId = '26-101';
const title = 'Eine ausreichend lange Aufgabenbeschreibung zum Layouttest';
const viewportWidth = Number(process.env.DODRAG_LAYOUT_VIEWPORT ?? 1424);
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const titleFailures = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  // Wails outer width 1440 minus the assumed 16px Windows frame.
  for (const language of ['de', 'en']) {
    const page = await browser.newPage({ viewport: { width: viewportWidth, height: 820 }, locale: language === 'de' ? 'de-DE' : 'en-US' });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ language, taskId, title }) => {
      const date = '2026-10-25T09:00:00.000Z';
      const settings = { activeDatabasePath: 'layout.db', databaseReady: true, autostart: false, uiLanguage: language,
        knownDatabases: [{ name: 'Layout fixture', path: 'layout.db', exists: true, isDemo: false }] };
      const events = [{ seq: 1, id: 'layout-created', timestamp: date, undone: false, type: 'TASK_CREATED',
        payload: { taskId, title, configuredStart: date, createdAt: date } }];
      const unchanged = async () => events;
      const unchangedSettings = async () => settings;
      window.go = { main: { App: {
        GetSettings: unchangedSettings, GetEvents: unchanged, AppendBatch: unchanged, AppendEvent: unchanged,
        Undo: unchanged, Redo: unchanged, SwitchDatabase: unchangedSettings, DeleteDatabase: unchangedSettings,
        CreateDatabase: unchangedSettings, OpenExistingDatabaseDialog: unchangedSettings, SetAutostart: unchangedSettings,
        SetUILanguage: unchangedSettings, SelectFolderDialog: async () => '', EnterMiniMode: async () => '',
        ExitMiniMode: async () => {}, ShowTaskContextMenu: async () => '', UpdateMiniModeHeight: async () => {},
        SnapMiniWindowToNearestCorner: async () => '',
      } } };
    }, { language, taskId, title });
    await page.goto(server.resolvedUrls.local[0]);
    const row = page.locator(`main [data-task-drag="${taskId}"]`);
    await row.locator('[data-task-title-area] span').waitFor();
    await row.locator('[data-task-title-area] span').click();
    await page.locator('[data-detail-toggle]').click();
    await page.locator('aside [contenteditable="true"]').waitFor();
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-detail-toggle]').parentElement;
      return Math.abs(panel.getBoundingClientRect().width - 560) < 0.1
        && panel.querySelector('[data-detail-dates] [data-editor-history] button');
    });
    const metrics = await page.evaluate(async ({ taskId, title }) => {
      await document.fonts.ready;
      const rect = node => {
        const { x, y, width, height, right, bottom } = node.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      const panel = document.querySelector('[data-detail-toggle]').parentElement;
      const dates = panel.querySelector('[data-detail-dates]');
      const toolbar = panel.querySelector('[role="group"]');
      const headings = [...toolbar.querySelectorAll(':scope > div > button[aria-expanded]')].map(button => {
        const span = button.querySelector('span');
        const range = document.createRange(); range.selectNodeContents(span);
        return { text: span.textContent, fontSize: getComputedStyle(span).fontSize,
          box: rect(button), lines: range.getClientRects().length, label: rect(span) };
      });
      const row = document.querySelector(`main [data-task-drag="${taskId}"]`);
      const taskTitle = row.querySelector('[data-task-title-area] span');
      const style = getComputedStyle(taskTitle);
      const canvas = document.createElement('canvas').getContext('2d');
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const first20 = Array.from(title).slice(0, 20).join('');
      const letterSpacing = parseFloat(style.letterSpacing) || 0;
      return { viewport: innerWidth, panel: rect(panel), main: rect(document.querySelector('main')),
        toolbar: rect(toolbar), headings, dates: rect(dates),
        history: [...dates.querySelectorAll('[data-editor-history] button')].map(button => ({ label: button.getAttribute('aria-label'), box: rect(button) })),
        toolbarHistory: toolbar.querySelectorAll('[data-editor-history]').length,
        row: rect(row), title: rect(taskTitle), first20, font: canvas.font,
        first20Width: canvas.measureText(first20).width + letterSpacing * 19,
        ellipsisWidth: canvas.measureText('\u2026').width,
        idPresent: [...row.querySelectorAll('span')].some(span => span.textContent === taskId),
        datePresent: row.textContent.includes('2026-10-25'),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    }, { taskId, title });
    console.log(`${language} layout: ${JSON.stringify(metrics)}`);
    assert.deepEqual(errors, [], `${language}: browser runtime errors`);
    assert.equal(metrics.viewport, viewportWidth);
    assert.ok(Math.abs(metrics.panel.width - 560) < 0.1, `${language}: default detail width`);
    assert.equal(metrics.headings.length, 6, `${language}: all six menus mounted`);
    for (const heading of metrics.headings) {
      assert.equal(heading.fontSize, '11px', `${language}: ${heading.text} font size`);
      assert.equal(heading.lines, 1, `${language}: ${heading.text} text must not wrap`);
      assert.ok(Math.abs(heading.box.y - metrics.headings[0].box.y) < 0.1, `${language}: menus must share one row`);
      assert.ok(heading.label.right <= heading.box.right && heading.box.right <= metrics.toolbar.right, `${language}: heading must fit`);
    }
    assert.equal(metrics.history.length, 2, `${language}: Undo/Redo must live under data-detail-dates`);
    assert.equal(metrics.toolbarHistory, 0, `${language}: no history controls in menu row`);
    for (const control of metrics.history) {
      assert.ok(control.box.y >= metrics.dates.y && control.box.bottom <= metrics.dates.bottom + 0.1, `${language}: history must fit dates row`);
      assert.ok(control.box.right <= metrics.dates.right + 0.1, `${language}: history must not overflow dates row`);
    }
    assert.ok(metrics.idPresent && metrics.datePresent, `${language}: real task row must retain ID/date controls`);
    const requiredTitleWidth = metrics.first20Width + metrics.ellipsisWidth;
    if (metrics.title.width < requiredTitleWidth) titleFailures.push(`${language}: title width ${metrics.title.width} < measured first20 plus ellipsis ${requiredTitleWidth}`);
    assert.equal(metrics.horizontalOverflow, false, `${language}: no horizontal page overflow`);
    console.log(`${metrics.title.width >= requiredTitleWidth ? 'PASS' : 'FAIL'} ${language}: six 11px menus in one row; history in dates; title ${metrics.title.width.toFixed(2)}px / first20 plus ellipsis ${requiredTitleWidth.toFixed(2)}px`);
    await page.close();
  }
  assert.deepEqual(titleFailures, [], 'Both languages must have space for the measured first 20 title characters');
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
