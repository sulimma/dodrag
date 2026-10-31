// Optional linguistic audit. Run npm run test:language; never part of the commit/build gate.
import { describe, expect, it } from 'vitest';
import glossaryData from './glossary.json';

const languages = ['de', 'en', 'fr', 'es', 'zh-CN', 'uk', 'pt-BR', 'ja', 'zh-TW', 'ko', 'it', 'pl', 'tr', 'eo', 'tok'];
const catalogs = import.meta.glob<Record<string, string>>('./locales/*.json', { eager: true, import: 'default' });
const readCatalog = (name: string): Record<string, string> =>
  catalogs[`./locales/${name}.json`];
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

describe('optional language audit', () => {
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
});
