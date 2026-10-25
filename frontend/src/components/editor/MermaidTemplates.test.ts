// @vitest-environment jsdom
import mermaid from 'mermaid';
import { expect, it } from 'vitest';
import { MERMAID_TEMPLATES } from './MermaidTemplates';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });

it('exports one small source template per bundled normal diagram family, without aliases', () => {
  expect(MERMAID_TEMPLATES).toHaveLength(30);
  expect(new Set(MERMAID_TEMPLATES.map(template => template.labelKey)).size).toBe(30);
  expect(new Set(MERMAID_TEMPLATES.map(template => template.source.split('\n')[0])).size).toBe(30);
  for (const { source } of MERMAID_TEMPLATES) {
    expect(source.length).toBeLessThan(180);
    expect(source).not.toContain('```');
  }
});

// Parsing guards syntax in the standard DOM suite. Real SVG layout is checked
// separately by tests/mermaid-templates.browser.mjs, without jsdom bbox shims.
it.each(MERMAID_TEMPLATES)('parses $labelKey with the actual installed Mermaid', async ({ source }) => {
  await expect(mermaid.parse(source)).resolves.toEqual(expect.objectContaining({ diagramType: expect.any(String) }));
});
