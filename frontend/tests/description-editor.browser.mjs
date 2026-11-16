// Targeted Chromium checks for preview geometry and native text entry.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5196, strictPort: true, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.DODRAG_SMILES_CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const html = await server.transformIndexHtml('/__smiles', '<div id="fixture"></div><script type="module" src="/tests/description-editor.fixture.tsx"></script>');
  await page.route(url => url.pathname === '/__smiles', route => route.fulfill({ contentType: 'text/html', body: html }));
  const load = async (description) => {
    await page.goto('http://127.0.0.1:5196/__smiles' + (description ? '?description=' + encodeURIComponent(description) : ''));
    const diagram = page.locator('[data-diagram-block]');
    await diagram.locator('svg text').first().waitFor();
    return diagram;
  };
  for (const where of ['after button', 'below diagram', 'right of diagram', 'ArrowDown', 'ArrowRight']) {
    const diagram = await load();
    const editor = await page.locator('.tiptap').boundingBox();
    const body = await diagram.locator('.diagram-body').boundingBox();
    const block = await diagram.boundingBox();
    const atomSizes = await diagram.locator('svg text').first().evaluate(atom => ({
      atom: parseFloat(getComputedStyle(atom).fontSize) * atom.getScreenCTM().a,
      text: parseFloat(getComputedStyle(atom.closest('.tiptap')).fontSize),
    }));
    assert.ok(Math.abs(atomSizes.atom - atomSizes.text) < 2, 'Atom labels should have the editor text size');
    assert.ok(body.width < editor.width - 40, 'A short formula should leave room beside the preview');
    if (where === 'after button') {
      await diagram.locator('[data-diagram-insert=after]').click();
    } else if (where === 'below diagram') {
      await page.mouse.click(editor.x + 5, block.y + block.height + 6);
    } else if (where === 'right of diagram') {
      await page.mouse.click(body.x + body.width + 6, body.y + body.height / 2);
    } else {
      await diagram.locator('svg').click();
      await page.keyboard.press(where);
    }
    await page.keyboard.type('abc');
    const typed = await page.locator('.tiptap').evaluate(dom => {
      const { doc, selection } = dom.editor.state;
      const native = document.getSelection();
      return {
        source: doc.firstChild?.textContent,
        after: doc.lastChild?.textContent,
        caret: selection.$head.parentOffset,
        nativeCaret: native.anchorOffset,
        inParagraph: native.anchorNode?.parentElement?.closest('p') === dom.lastElementChild,
      };
    });
    assert.deepEqual(typed, { source: 'CC(=O)O', after: 'abc', caret: 3, nativeCaret: 3, inParagraph: true }, where);
  }
  await page.setViewportSize({ width: 360, height: 700 });
  const wide = await load('```smiles\nO' + 'C'.repeat(45) + 'O\n```');
  const scrollable = await wide.locator('[role=img]').evaluate(preview => preview.scrollWidth > preview.clientWidth);
  assert.equal(scrollable, true, 'A wide molecule should scroll inside its preview');
  // Press Backspace immediately after End, while the native caret may still
  // be ahead of the editor's model selection.
  for (const [source, replacement, destination] of [
    ['12345678', '9', 'tel:12345679'],
    ['https://example.org/alt', 'p', 'https://example.org/alp'],
  ]) {
    await page.goto('http://127.0.0.1:5196/__smiles?description=' + encodeURIComponent(source));
    const target = page.locator('.dodrag-editor-target');
    const expectText = text => page.waitForFunction(value => document.querySelector('.tiptap').editor.state.doc.textContent === value, text);
    await target.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    const shortened = source.slice(0, -1);
    await expectText(shortened);
    if (destination.startsWith('tel:')) assert.equal(await target.count(), 0);
    await page.keyboard.type(replacement);
    await expectText(shortened + replacement);
    assert.equal(await target.getAttribute('data-target-value'), destination);
  }

  for (const pos of [1, 6]) {
    const openLabel = async () => {
      await page.goto('http://127.0.0.1:5196/__smiles?description=' + encodeURIComponent('[Label](https://example.org)'));
      await page.locator('.tiptap a').waitFor();
      await page.locator('.tiptap').evaluate((dom, position) => {
        dom.editor.commands.setTextSelection(position);
        dom.editor.view.focus();
      }, pos);
    };
    await openLabel();
    await page.keyboard.type('X  prose');
    assert.equal(await page.locator('.tiptap').evaluate(dom => dom.editor.getMarkdown()),
      pos === 1 ? '[X](https://example.org) prose[Label](https://example.org)' : '[LabelX](https://example.org) prose');
    await openLabel();
    await page.keyboard.press(pos === 1 ? 'ArrowLeft' : 'ArrowRight');
    await page.keyboard.type('outside');
    assert.equal(await page.locator('.tiptap').evaluate(dom => dom.editor.getMarkdown()),
      pos === 1 ? 'outside[Label](https://example.org)' : '[Label](https://example.org)outside');
  }
  await page.goto('http://127.0.0.1:5196/__smiles?description=Before');
  await page.getByRole('button', { name: 'Diagramme', exact: true }).click();
  await page.getByRole('button', { name: 'SMILES-Strukturformeln', exact: true }).click();
  await page.locator('[data-diagram-editing] code').waitFor();
  await page.keyboard.type('C');
  assert.equal(await page.locator('[data-diagram-editing] code').textContent(), 'CCC(=O)O');
  assert.equal(await page.locator('[data-diagram-title]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: SMILES sizing, caret movement after a diagram, and in-place link editing');
} finally {
  await browser?.close();
  await server.close();
}
