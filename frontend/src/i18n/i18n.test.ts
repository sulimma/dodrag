import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, getLanguage, resolveLanguage, setLanguage, t } from './index';

const languages = ['de', 'en', 'fr', 'es', 'zh-CN', 'uk', 'pt-BR', 'ja', 'zh-TW', 'ko', 'it', 'pl', 'tr', 'eo', 'tok'];
const catalogs = import.meta.glob<Record<string, string>>('./locales/*.json', { eager: true, import: 'default' });
const sourceFiles = import.meta.glob<string>(['../**/*.ts', '../**/*.tsx', '!../**/*.test.*', '!../i18n/**'], { eager: true, query: '?raw', import: 'default' });
const readCatalog = (name: string): Record<string, string> =>
  catalogs[`./locales/${name}.json`];
const placeholders = (text: string) => [...text.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort();

describe('translation coverage', () => {
  it('resolves OS language variants and safely interpolates user data', () => {
    expect(resolveLanguage('zh-Hant-HK')).toBe('zh-TW');
    expect(resolveLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(resolveLanguage('pt-PT')).toBe('pt-BR');
    expect(resolveLanguage(['nl-NL', 'fr-CA'])).toBe('fr');
    expect(resolveLanguage('nl-NL')).toBe('en');
    expect(resolveLanguage('it-CH')).toBe('it');
    expect(resolveLanguage('pl-PL')).toBe('pl');
    expect(resolveLanguage('tr-TR')).toBe('tr');
    expect(resolveLanguage('eo-001')).toBe('eo');
    expect(resolveLanguage('epo')).toBe('eo');
    expect(resolveLanguage('tok')).toBe('tok');
    const previous = getLanguage();
    try {
      setLanguage('de');
      expect(t('Titel {id}', { id: '$& {id}' })).toBe('Titel $& {id}');
      expect(() => setLanguage('xx')).toThrow();
      for (const language of languages) {
        setLanguage(language);
        expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat(language).format(1234.5));
        expect(formatDate(new Date(2026, 9, 18))).toBe('2026-10-18');
        expect(formatDate(new Date(2026, 9, 18, 14, 30), { hour: '2-digit', minute: '2-digit' })).toBe('2026-10-18 14:30');
      }
    } finally { setLanguage(previous); }
  });

  it('contains every text and the same interpolation parameters in all languages', () => {
    for (const prefix of ['', 'backend-']) {
      const base = readCatalog(`${prefix}de`);
      expect(Object.keys(base).length).toBeGreaterThan(0);
      for (const language of languages) {
        const translated = readCatalog(`${prefix}${language}`);
        expect(Object.keys(translated).sort(), `${prefix}${language}: keys`).toEqual(Object.keys(base).sort());
        for (const [key, text] of Object.entries(base)) {
          expect(typeof translated[key], `${prefix}${language}: ${key}`).toBe('string');
          expect(translated[key].trim(), `${prefix}${language}: ${key}`).not.toBe('');
          expect(placeholders(translated[key]), `${prefix}${language}: ${key}`).toEqual(placeholders(text));
        }
      }
    }
  });

  it('does not introduce untranslated UI literals or unknown translation keys', () => {
    const catalog = readCatalog('de');
    const failures: string[] = [];
    const visibleAttributes = new Set(['title', 'placeholder', 'aria-label', 'aria-description', 'alt', 'label']);
    // ponytail: AST checks app-owned text, not user data or OS/library diagnostics.
    // New rendering helpers must be added here or covered by a runtime UI test.
    for (const [path, text] of Object.entries(sourceFiles)) {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const report = (node: ts.Node, text: string) => {
        const decoded = text.replace(/&(?:lt|gt|amp|quot|apos|nbsp);/g, '');
        if (!/[\p{L}]/u.test(decoded) || text.trim() === 'DoDrag') return;
        if (ts.isJsxText(node) && ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(source) === 'kbd' &&
          /^(?:F2|O|T|Ctrl\+M|Del \/ D|Ctrl\+Z \/ Ctrl\+Y \/ Ctrl\+Shift\+Z|↑ \/ ↓ \/ Esc)$/.test(text.trim())) return;
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        failures.push(`${path}:${position.line + 1}: ${text.trim()}`);
      };
      const checkExpression = (node: ts.Node) => {
        if (ts.isCallExpression(node)) return; // Translation calls and user-data formatters are checked separately.
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
        if (ts.isConditionalExpression(node)) { checkExpression(node.whenTrue); checkExpression(node.whenFalse); return; }
        if (ts.isBinaryExpression(node)) {
          if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) checkExpression(node.right);
          return; // Comparison operands and view-mode codes are not rendered text.
        }
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) report(node, node.text);
        else if (ts.isTemplateExpression(node)) {
          report(node.head, node.head.text);
          for (const span of node.templateSpans) report(span.literal, span.literal.text);
        } else ts.forEachChild(node, checkExpression);
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) report(node, node.text);
        // Sidebar quick-resubmit labels are catalog keys translated at render time.
        if (path.endsWith('TaskSidebar.tsx') && ts.isPropertyAssignment(node) &&
          ['label', 'sublabel'].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer) &&
          !(node.initializer.text in catalog)) failures.push(`${path}: missing key ${node.initializer.text}`);
        if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.getText(source)) && node.initializer) {
          if (ts.isStringLiteral(node.initializer)) report(node.initializer, node.initializer.text);
          else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) checkExpression(node.initializer.expression);
        }
        if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) checkExpression(node.expression);
        if (ts.isCallExpression(node)) {
          const name = node.expression.getText(source);
          if (name === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            if (!(node.arguments[0].text in catalog)) failures.push(`${path}: missing key ${node.arguments[0].text}`);
          }
          if (['alert', 'confirm', 'prompt', 'pushToast', 'window.alert', 'window.confirm', 'window.prompt'].includes(name) && node.arguments[0]) {
            checkExpression(node.arguments[0]);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(failures).toEqual([]);
  });
});
