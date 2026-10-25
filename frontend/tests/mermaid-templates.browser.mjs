// Bounded renderer check only: Chromium SVG metrics, not native WebView2/Windows.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('http://127.0.0.1:5198');
  const results = await page.evaluate(async () => {
    const { MERMAID_TEMPLATES } = await import('/src/components/editor/MermaidTemplates.ts');
    const { default: mermaid } = await import('/node_modules/mermaid/dist/mermaid.esm.min.mjs');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
    const results = [];
    for (const [index, { labelKey, source }] of MERMAID_TEMPLATES.entries()) {
      const host = document.createElement('div');
      host.style.width = '1000px';
      document.body.append(host);
      try {
        const { svg } = await mermaid.render(`template-${index}`, source, host);
        host.innerHTML = svg;
        const element = host.querySelector('svg');
        const bbox = element?.getBBox();
        const viewBox = element?.viewBox.baseVal;
        const invalidGeometry = Array.from(host.querySelectorAll('svg,svg *')).flatMap(node =>
          Array.from(node.attributes).filter(attribute => /\b(?:NaN|Infinity)\b/.test(attribute.value))
            .map(attribute => `${node.tagName} ${attribute.name}=${attribute.value}`));
        results.push({ labelKey, source, svg, width: bbox?.width, height: bbox?.height,
          viewWidth: viewBox?.width, viewHeight: viewBox?.height, invalidGeometry,
          shapes: host.querySelectorAll('path,rect,circle,ellipse,polygon,line').length });
      } catch (error) {
        results.push({ labelKey, error: String(error) });
      } finally {
        host.remove();
      }
    }
    return results;
  });
  assert.equal(results.length, 30);
  for (const result of results) {
    assert.equal(result.error, undefined, `${result.labelKey}: ${result.error}`);
    assert.ok(result.width > 0 && result.height > 0, `${result.labelKey}: empty SVG bounds`);
    assert.ok(result.viewWidth > 0 && result.viewHeight > 0, `${result.labelKey}: empty viewBox`);
    assert.ok(result.shapes > 0, `${result.labelKey}: no rendered geometry`);
    assert.deepEqual(result.invalidGeometry, [], `${result.labelKey}: non-finite SVG geometry`);
    console.log(`PASS ${result.labelKey}: ${result.width} x ${result.height}`);
  }
  const zoom = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = '<div style="width:200px;height:100px"></div>';
    document.body.append(host);
    const before = host.getBoundingClientRect().height;
    host.style.zoom = '0.75';
    const after = host.getBoundingClientRect().height;
    host.remove();
    return after / before;
  });
  assert.equal(zoom, 0.75, 'CSS zoom must shrink layout as well as painted content');
} finally {
  await browser?.close();
  await server.close();
}
