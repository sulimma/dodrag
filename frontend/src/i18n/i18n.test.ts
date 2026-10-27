import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, getLanguage, resolveLanguage, setLanguage, t } from './index';
import glossaryData from './glossary.json';

const languages = ['de', 'en', 'fr', 'es', 'zh-CN', 'uk', 'pt-BR', 'ja', 'zh-TW', 'ko', 'it', 'pl', 'tr', 'eo', 'tok'];
const catalogs = import.meta.glob<Record<string, string>>('./locales/*.json', { eager: true, import: 'default' });
const sourceFiles = import.meta.glob<string>(['../**/*.ts', '../**/*.tsx', '!../**/*.test.*', '!../i18n/**'], { eager: true, query: '?raw', import: 'default' });
const readCatalog = (name: string): Record<string, string> =>
  catalogs[`./locales/${name}.json`];
const placeholders = (text: string) => [...text.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort();
type GlossaryTerm = {
  id: string; context: string; sourceTerms: string[];
  translations: Record<string, string[]>; keys?: string[]; excludeKeys?: string[];
};
const glossary: GlossaryTerm[] = glossaryData;
const withoutParameters = (text: string) => text.replace(/\{\w+\}/g, '');
const normalize = (text: string) => withoutParameters(text).normalize('NFC').toLowerCase();
const appliesTo = (term: GlossaryTerm, key: string) => !term.excludeKeys?.includes(key) &&
  (term.keys ? term.keys.includes(key) : term.sourceTerms.some(source => normalize(key).includes(normalize(source))));
const containsTerm = (text: string, forms: string[], language: string) => forms.some(form => {
  const escaped = normalize(form).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ponytail: explicit forms, not a morphological parser. Add reviewed inflections to the glossary;
  // CJK has no whitespace word boundaries. Semantic correctness still needs native-speaker review.
  return new RegExp(['zh-CN', 'zh-TW', 'ja', 'ko'].includes(language) ? escaped :
    `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])`, 'u').test(normalize(text));
});
const prose = (text: string) => withoutParameters(text)
  .replace(/https?:\/\/\S+|(?:[A-Z]:\\|%[A-Z]+%\\)\S+/gi, '');
const longSentences = (text: string) => prose(text).split(/[.:;?!]/)
  .filter(sentence => sentence.trim().split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length > 18);
const nameHeads: Record<string, string> = {
  DoDrag: 'ilo', 'VS Code': 'ilo', 'Visual Studio Code': 'ilo', Windows: '(?:ilo|poki lawa|open)',
  Mermaid: 'sitelen', Gantt: 'sitelen(?: tenpo)?', Markdown: '(?:nasin(?: sitelen)?|sitelen)',
  URL: 'linja', 'Google Drive': 'poki', GitHub: '(?:lipu|poki sona)', JSON: 'lipu', SQLite: 'poki sona',
  Kanban: 'sitelen', Unicode: 'sitelen', LaTeX: 'sitelen',
};
const bareNames = (text: string) => Object.entries(nameHeads).flatMap(([name, head]) => {
  const source = prose(text);
  return [...source.matchAll(new RegExp(`\\b${name}\\b`, 'g'))]
    .filter(match => !new RegExp(`${head}\\s+$`).test(source.slice(0, match.index)))
    .map(() => name);
});

describe('translation coverage', () => {
  it('flags Toki Pona complexity and unclassified names for review', () => {
    // ponytail: linguistic heuristics cannot prove grammar. Known Phase-1 findings remain
    // visible warnings rather than rewriting the reference to satisfy a mechanical lint.
    const warnings: string[] = [];
    for (const prefix of ['', 'backend-']) {
      for (const [key, text] of Object.entries(readCatalog(`${prefix}tok`))) {
        if (longSentences(text).length) warnings.push(`${prefix}tok: long sentence: ${key}`);
        const names = bareNames(text);
        if (names.length) warnings.push(`${prefix}tok: missing name head (${names.join(', ')}): ${key}`);
      }
    }
    if (warnings.length) console.warn(`Toki Pona review (not a native-speaker validation):\n${warnings.join('\n')}`);
    expect(longSentences('pali '.repeat(19))).toHaveLength(1);
    expect(longSentences(`${'pali '.repeat(12)}. ${'pali '.repeat(12)}`)).toHaveLength(0);
    expect(bareNames('ilo DoDrag li pana e sitelen Mermaid. nasin Markdown li pona.')).toEqual([]);
    expect(bareNames('Mermaid li pona. ilo li pana e DoDrag.')).toEqual(['DoDrag', 'Mermaid']);
    expect(bareNames('%APPDATA%\\DoDrag {Mermaid}')).toEqual([]);
  });

  it('keeps action-failure wording consistent in languages with invariant prefixes', () => {
    // ponytail: these languages have a stable prefix. Suffix/inflection languages and
    // technical diagnostics require sentence-level review, not a universal grammar regex.
    const prefixes: Record<string, RegExp> = {
      en: /^Could not /, fr: /^Impossible (?:de |d['’])/, es: /^No se (?:pudo|pudieron) /,
      'zh-CN': /^无法/, uk: /^Не вдалося /, 'pt-BR': /^Não foi possível /,
      'zh-TW': /^無法/, it: /^Impossibile /, pl: /^Nie udało się /,
      eo: /^Ne eblis /, tok: /^ilo li ken ala /,
    };
    const failures: string[] = [];
    for (const prefix of ['', 'backend-']) {
      // Partial-success diagnostics lead with the saved change, not with a failure prefix.
      for (const key of Object.keys(readCatalog(`${prefix}de`)).filter(key =>
        /konnte[n]? nicht|konnten nicht/.test(key) && key !== 'Aenderung gespeichert, Vorschau-Cache konnte nicht bereinigt werden')) {
        for (const [language, pattern] of Object.entries(prefixes)) {
          // Unknown locations are a knowledge failure (sona), not an ability failure (ken).
          if (language === 'tok' && /konnte nicht ermittelt werden/.test(key)) {
            if (!/^ilo li sona ala /.test(readCatalog(`${prefix}tok`)[key])) failures.push(`${prefix}tok: ${key}`);
            continue;
          }
          const text = readCatalog(`${prefix}${language}`)[key];
          if (!pattern.test(text)) failures.push(`${prefix}${language}: ${key} => ${text}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('defines complete, contextual terminology for every supported language', () => {
    expect(new Set(glossary.map(term => term.id)).size).toBe(glossary.length);
    const allKeys = new Set([...Object.keys(readCatalog('de')), ...Object.keys(readCatalog('backend-de'))]);
    for (const term of glossary) {
      expect(term.id).toMatch(/^term\.[a-zA-Z]+$/);
      expect(term.context.trim(), term.id).not.toBe('');
      expect(term.sourceTerms.length, term.id).toBeGreaterThan(0);
      expect(term.sourceTerms.every(source => source.trim().length > 0), term.id).toBe(true);
      expect(Object.keys(term.translations).sort(), term.id).toEqual([...languages].sort());
      for (const language of languages) {
        const forms = term.translations[language];
        expect(forms.length, `${term.id}: ${language}`).toBeGreaterThan(0);
        expect(forms.every(form => form.trim() === form && form.length > 0), term.id).toBe(true);
      }
      for (const key of [...(term.keys ?? []), ...(term.excludeKeys ?? [])]) {
        expect(allKeys.has(key), `${term.id}: stale context key ${key}`).toBe(true);
      }
      expect([...allKeys].some(key => appliesTo(term, key)), `${term.id}: unused concept`).toBe(true);
    }
  });

  it('uses glossary terminology across frontend and native catalogs', () => {
    const failures: string[] = [];
    for (const prefix of ['', 'backend-']) {
      for (const key of Object.keys(readCatalog(`${prefix}de`))) {
        for (const term of glossary.filter(term => appliesTo(term, key))) {
          for (const language of languages) {
            const text = readCatalog(`${prefix}${language}`)[key];
            if (!containsTerm(text, term.translations[language], language)) {
              failures.push(`${prefix}${language}: ${term.id}: ${key} => ${text} (expected ${term.translations[language].join(' / ')})`);
            }
          }
        }
      }
    }
    expect(failures, 'Terminology audit; correct sentences or add reviewed inflections, never append unused terms').toEqual([]);
  });

  it('checks whole terms, inflection, CJK text and contextual exclusions', () => {
    expect(containsTerm('deactivate', ['activate'], 'en')).toBe(false);
    expect(containsTerm('{task}', ['task'], 'en')).toBe(false);
    expect(containsTerm('usuń zadania', ['zadanie', 'zadania'], 'pl')).toBe(true);
    expect(containsTerm('任務已完成', ['任務'], 'zh-TW')).toBe(true);
    expect(containsTerm('DE\u0301TAILS', ['détails'], 'fr')).toBe(true);
    expect(appliesTo(glossary.find(term => term.id === 'term.description')!, 'Bildbeschreibung')).toBe(false);
    expect(appliesTo(glossary.find(term => term.id === 'term.log')!, 'Markdown für Beschreibung und Log. Syntaxzeichen bleiben in jeder Sprache gleich.')).toBe(false);
    expect(appliesTo(glossary.find(term => term.id === 'term.settings')!, 'Settings lesen ({path})')).toBe(true);
  });

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
        const isKeyCode = /^(?:Ctrl\+\+|F2|O|T|Ctrl\+M|Del \/ D|Ctrl\+Z \/ Ctrl\+Y \/ Ctrl\+Shift\+Z|↑ \/ ↓ \/ Esc)$/.test(text.trim());
        if (isKeyCode && (ts.isJsxText(node) && ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(source) === 'kbd' ||
          ts.isStringLiteral(node) && ts.isJsxExpression(node.parent) && ts.isJsxElement(node.parent.parent) && node.parent.parent.openingElement.tagName.getText(source) === 'kbd')) return;
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
