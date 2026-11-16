import { t } from '../../i18n';
import { ALERT_TYPES } from './MarkdownFeatures';
import { SMILES_EXAMPLE } from './diagramRendering';

// Share supported syntax examples with human help; agent guidance omits shortcut tables.
export function markdownSyntaxExamples(): string[][] {
  const text = t('Text');
  const examples = [
    [t('Überschrift'), [1, 2, 3, 4, 5, 6].map(level => `${'#'.repeat(level)} ${text}`).join('\n')],
    [t('Absatz'), `${text}\n\n${text}`],
    [t('Fett'), `**${text}**`],
    [t('Kursiv'), `*${text}*`],
    [t('Durchgestrichen'), `~~${text}~~`],
    [t('Code'), `\`${text}\``],
    [t('Listen'), `- ${text}\n- ${text}\n\n1. ${text}\n2. ${text}\n\n- [ ] ${text}\n- [x] ${text}`],
    [t('Zitat'), `> ${text}`],
    [t('Codeblock'), `\`\`\`text\n${text}\n\`\`\``],
    [t('GitHub Alerts'), ALERT_TYPES.map(({ type, labelKey }) => `> [!${type}]\n> ${t(labelKey)}`).join('\n\n')],
    [t('SMILES-Strukturformeln'), `\`\`\`smiles\n${SMILES_EXAMPLE}\n\`\`\``],
    [t('Mermaid-Diagramm'), `\`\`\`mermaid\ngraph LR\n  A[${t('Start')}] --> B[${t('Ende')}]\n\`\`\``],
    [t('Formel'), '$E = mc^2$'],
    [t('Formelblock'), '$$\n\\frac{a}{b} = c\n$$'],
    [t('Link'), `[${text}](https://example.com)`],
    [t('Bild'), `![${t('Bildbeschreibung')}](https://example.com/image.png)`],
  ];
  return examples;
}

export function markdownAgentInstructions(): string {
  return [
    '# DoDrag Markdown for AI agents',
    'Write Markdown source with the content described by the user.. Do not wrap the whole document in a code fence or indent the whole document as code. Use fenced blocks only for code, Mermaid diagrams and SMILES molecular structures.\nPresent the text in a way that allows the user to copy it as a whole and paste it into a markdown editor. If you harness does not provide such a copy feature, present the markdown source to the user as plain text such that it can be marked and copied using strg+c. ',
    'Use Unicode directly. Symbols such as ✅ ❌ ℹ️ ❓ ⛔ are encouraged to structure the content.',
    'Supported syntax (examples):',
    ...markdownSyntaxExamples().map(([label, example]) => `${label}:\n${example}`),
    'Tables: use a Markdown header row, a separator row (| --- | --- |), and data rows. Horizontal rules: --- on a separate line.',
    'Mermaid: use fenced blocks with the language mermaid. LaTeX: $inline$ or $$ on separate lines around a block.',
    'Local Windows paths: use absolute paths, quoted when they contain spaces. Local images: ![alt](<C:\\Pictures\\image.png>).',
  ].join('\n\n');
}
