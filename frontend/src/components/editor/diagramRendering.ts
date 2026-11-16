// Diagram languages roundtrip as ordinary fenced Markdown code blocks.
export const SMILES_EXAMPLE = 'CC(=O)O';

export function isDiagramLanguage(language: unknown): language is 'mermaid' | 'smiles' {
  return language === 'mermaid' || language === 'smiles';
}

let mermaidModule: Promise<typeof import('mermaid')['default']> | undefined;
let diagramSequence = 0;

export async function renderDiagram(language: 'mermaid' | 'smiles', source: string): Promise<string | SVGSVGElement> {
  if (language === 'smiles') {
    const { default: drawer } = await import('smiles-drawer');
    return new Promise((resolve, reject) => {
      drawer.parse(source.trim(), graph => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        // One SVG unit per CSS pixel keeps the 11 pt atom labels close to the editor's 14 px text.
        resolve(new drawer.SvgDrawer({ scale: 1, compactDrawing: false }).draw(graph, svg));
      }, reject);
    });
  }
  mermaidModule ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
    return mermaid;
  });
  const mermaid = await mermaidModule;
  const host = document.createElement('div');
  host.style.position = 'absolute'; host.style.left = '-100000px';
  document.body.append(host);
  try {
    const { svg } = await mermaid.render(`dodrag-mermaid-${++diagramSequence}`, source, host);
    return svg;
  } finally { host.remove(); }
}
