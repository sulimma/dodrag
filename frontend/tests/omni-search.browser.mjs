// Targeted interaction/paint check: CSS Highlight and native textarea mirrors
// require a layout engine. This does not establish native WebView2 integration.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 700 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const html = await server.transformIndexHtml('/__omni_test', '<div id="fixture"></div><script type="module" src="/tests/omni-search.fixture.tsx"></script>');
  await page.route('**/__omni_test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://127.0.0.1:5197/__omni_test');
  const query = page.locator('header input'), note = page.getByRole('textbox', { name: 'note' });
  await query.waitFor();
  const toolbarBefore = await page.locator('header').boundingBox();
  await query.fill('alpha beta');
  await page.waitForFunction(() => CSS.highlights.get('omni-search')?.size === 3);
  assert.equal(await page.locator('[data-search-ignore][aria-hidden] mark').count(), 3);
  assert.deepEqual(await page.locator('header').boundingBox(), toolbarBefore);
  // The mirror cannot intercept editing, text selection, links or scrolling.
  await note.click(); await note.press('End'); await note.press('!');
  assert.ok((await note.inputValue()).includes('!'));
  await note.evaluate(field => { field.scrollTop = field.scrollHeight; field.dispatchEvent(new Event('scroll')); });
  if (process.env.OMNI_SCREENSHOT) {
    await page.screenshot({ path: process.env.OMNI_SCREENSHOT.replace('.png', '.fields.png'), clip: { x: 20, y: 230, width: 340, height: 100 } });
  }
  await page.locator('#link').click(); assert.ok(page.url().endsWith('#clicked'));
  await query.fill('26-101');
  await page.waitForFunction(() => CSS.highlights.get('omni-search')?.size === 2);
  const svgRanges = await page.evaluate(() => [...CSS.highlights.get('omni-search')].filter(range => range.startContainer.parentElement.closest('svg')).length);
  assert.equal(svgRanges, 1);
  if (process.env.OMNI_SCREENSHOT) await page.screenshot({ path: process.env.OMNI_SCREENSHOT });
  await query.fill(' '); // synthetic block whitespace must never throw a Range error
  await query.fill('');
  await page.waitForFunction(() => !CSS.highlights.has('omni-search'));
  assert.equal(await page.locator('[data-search-ignore][aria-hidden]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: literal/multiline DOM ranges, SVG IDs, textarea painting/editing/scrolling, stable toolbar geometry and reset');
} finally { await browser?.close(); await server.close(); }
