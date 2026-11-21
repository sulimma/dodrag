// Bounded regression: real pointer capture, CSS hit targets and visible insertion
// feedback. DOM tests separately cover persistence; no native app/user database.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5196, strictPort: true, hmr: false } });
await server.listen();
let browser;
try {
 browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
 const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
 page.setDefaultTimeout(8000);
 const errors = []; page.on('pageerror', error => errors.push(String(error)));
 const html = await server.transformIndexHtml('/__timeline_test', '<div id="fixture"></div><script type="module" src="/tests/timeline-drag.fixture.tsx"></script>');
 await page.route('**/__timeline_test*', route => route.fulfill({ contentType: 'text/html', body: html }));
 // Use the real app's pointer adapter and bar. This fixture has no native store.
 await page.addInitScript(() => {
   if (!['?project-order', '?detail-relations'].includes(location.search)) return;
   const date = '2026-11-21T10:00:00Z';
   const events = ['AA', 'BB', 'CC'].map((code, i) => ({
     type: 'PROJECT_SAVED', id: 'event-' + code, seq: i + 1, timestamp: date, undone: false,
     payload: { projectId: code, code, color: '#228877', summary: '', description: '' },
   }));
   if (location.search === '?detail-relations') {
     for (const taskId of ['A','B']) events.push({ type: 'TASK_CREATED', id: taskId, seq: events.length + 1, timestamp: date, undone: false,
       payload: { taskId, title: 'Task ' + taskId, configuredStart: date, createdAt: date } });
     events.push({ type: 'DEPENDENCY_ADDED', id: 'edge', seq: events.length + 1, timestamp: date, undone: false, payload: { taskId: 'B', predecessorId: 'A' } });
   }
   window.go = { main: { App: new Proxy({
     GetSettings: async () => ({ activeDatabasePath: 'fixture.db', databaseReady: true, knownDatabases: [] }),
     GetEvents: async () => events, GetWindowMode: async () => 'window', AppendBatch: async commands => {
       for (const command of commands) events.push({ ...command, seq: events.length + 1, timestamp: date, undone: false });
       return events;
     },
   }, { get: (obj, prop) => obj[prop] ?? (async () => undefined) }) } };
 });
 await page.goto('http://127.0.0.1:5196/?project-order');
 const bar = page.locator('[data-project-list]');
 const barChip = id => bar.locator('[data-project-drag="' + id + '"]');
 await barChip('CC').waitFor();
 const origin = await barChip('CC').boundingBox(), first = await barChip('AA').boundingBox();
 await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
 await page.mouse.down(); await page.mouse.move(first.x + 2, first.y + first.height / 2, { steps: 8 }); await page.mouse.up();
 const codes = () => bar.locator('[data-project-drag]').allTextContents();
 assert.deepEqual(await codes(), ['CC', 'AA', 'BB']);
 await page.reload(); await barChip('CC').waitFor();
 assert.deepEqual(await codes(), ['CC', 'AA', 'BB']);
 await barChip('CC').click(); await barChip('AA').click({ modifiers: ['Shift'] });
 assert.deepEqual(await bar.locator('[aria-pressed="true"]').allTextContents(), ['CC', 'AA']);
 console.log('PASS: project pointer reorder persists and defines Shift selection');
 await page.goto('http://127.0.0.1:5196/?detail-relations');
 const parent = page.locator('main [data-task-drag="A"]');
 await parent.dblclick({ position: { x: 4, y: 4 } });
 const successor = page.locator('[data-detail-relation][data-task-drag="B"]');
 await successor.waitFor();
 const start = await successor.boundingBox(), target = await barChip('BB').boundingBox();
 await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
 await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
 await page.mouse.up();
 await page.locator('main [data-task-drag="B"] [data-project-drag="BB"]').waitFor();
 assert.ok(await successor.isVisible(), 'drag keeps the original task details open');
 assert.equal(await parent.locator('[data-project-drag="BB"]').count(), 0);
 console.log('PASS: dragging a successor assigns the referenced task to a project');
 await page.goto('http://127.0.0.1:5196/__timeline_test?projectLabels');
 const row = page.locator('[data-task-drag="B"]');
 const title = row.locator('[data-task-title]'), badge = row.locator('[data-project-task]'), edge = row.locator('[data-edge-key]');
 await badge.waitFor();
 const wide = await title.boundingBox(), project = await badge.boundingBox();
 assert.ok(wide.x + wide.width <= project.x + 1 && Math.abs(wide.y - project.y) < 10, 'wide row places labels after the title');
 await page.locator('main').evaluate(el => { el.style.width = '400px'; });
 await page.waitForFunction(() => {
   const row = document.querySelector('[data-task-drag="B"]');
   return row.querySelector('[data-project-task]').getBoundingClientRect().top >= row.querySelector('[data-task-title]').getBoundingClientRect().bottom;
 });
 const lower = await badge.boundingBox(), dependency = await edge.boundingBox();
 assert.ok(lower.x + lower.width <= dependency.x && Math.abs(lower.y - dependency.y) < 10, 'second line separates project and dependency labels');
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
