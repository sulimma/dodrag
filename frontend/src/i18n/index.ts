import { useSyncExternalStore } from 'react';

export const supportedLanguages = ['de', 'en', 'fr', 'es', 'zh-CN', 'uk', 'pt-BR', 'ja', 'zh-TW', 'ko', 'it', 'pl', 'tr', 'eo', 'tok'] as const;
export type Language = typeof supportedLanguages[number];
export const languageNames: Record<Language, string> = {
  de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', 'zh-CN': '简体中文',
  uk: 'Українська', 'pt-BR': 'Português (Brasil)', ja: '日本語', 'zh-TW': '繁體中文', ko: '한국어',
  it: 'Italiano', pl: 'Polski', tr: 'Türkçe', eo: 'Esperanto', tok: 'toki pona',
};
const catalogs = import.meta.glob<Record<string, string>>(['./locales/*.json', '!./locales/backend-*.json'], { eager: true, import: 'default' });
let language: Language = 'de';
export let locale: string = 'de-DE';
const locales: Record<Language, string> = {
  de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES', 'zh-CN': 'zh-CN',
  uk: 'uk-UA', 'pt-BR': 'pt-BR', ja: 'ja-JP', 'zh-TW': 'zh-TW', ko: 'ko-KR',
  it: 'it-IT', pl: 'pl-PL', tr: 'tr-TR', eo: 'eo', tok: 'tok',
};
const listeners = new Set<() => void>();

export function resolveLanguage(preferred: string | readonly string[] | null | undefined): Language {
  for (const candidate of typeof preferred === 'string' ? [preferred] : preferred ?? []) {
    const code = candidate.trim().replace(/_/g, '-').toLowerCase();
    if (code === 'zh' || code.startsWith('zh-')) {
      return /(?:^|-)(?:tw|hk|mo|hant)(?:-|$)/.test(code) ? 'zh-TW' : 'zh-CN';
    }
    const base = code.split('-')[0];
    if (base === 'pt') return 'pt-BR';
    if (base === 'epo') return 'eo';
    const match = supportedLanguages.find(item => item.toLowerCase() === base);
    if (match) return match;
  }
  return 'en';
}

export function getLanguage(): Language { return language; }
export function setLanguage(next: string): void {
  if (!supportedLanguages.includes(next as Language)) throw new Error(t('Nicht unterstützte Sprache: {language}', { language: next }));
  const changed = language !== next;
  language = next as Language;
  locale = locales[language];
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  if (changed) listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLanguage(): Language { return useSyncExternalStore(subscribe, getLanguage, getLanguage); }

// Replacement callbacks treat dollar signs literally and never recursively interpolate user data.
export function t(key: string, params?: Record<string, string | number>): string {
  const lookup = (code: string) => {
    const catalog = catalogs[`./locales/${code}.json`];
    return catalog && Object.prototype.hasOwnProperty.call(catalog, key) && typeof catalog[key] === 'string' ? catalog[key] : undefined;
  };
  const text = lookup(language) ?? lookup('en') ?? lookup('de') ?? key;
  return text.replace(/\{([\w]+)\}/g, (placeholder, name: string) =>
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}

export function formatNumber(value: number): string { return new Intl.NumberFormat(locale).format(value); }
export function formatDate(value: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  if (!options || (!options.hour && !options.minute && !options.second)) return dateStr;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = options.second ? `:${String(date.getSeconds()).padStart(2, '0')}` : '';
  return `${dateStr} ${hh}:${mm}${ss}`;
}
export function errorText(context: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return t('{context}: {detail}', { context, detail });
}
