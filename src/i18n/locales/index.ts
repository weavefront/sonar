/**
 * The locale registry.
 *
 * All locales are imported statically rather than lazily. Two reasons, both specific to this app:
 * `vite-plugin-singlefile` inlines every chunk into one `index.html`, so a dynamic `import()` here
 * would defer *evaluation* but save exactly zero download; and evaluating a locale is just an
 * object literal, so there is nothing meaningful to defer. Static also avoids a flash of English
 * on first paint, which matters more for an offline-capable PWA than ~3KB gzipped per language.
 */

import type { Locale, LocaleCode } from '../types';
import { en, enPlurals } from './en';
import { zhHans, zhHansPlurals } from './zh-Hans';
import { es, esPlurals } from './es';
import { ru, ruPlurals } from './ru';
import { ptBR, ptBRPlurals } from './pt-BR';
import { ja, jaPlurals } from './ja';
import { ko, koPlurals } from './ko';
import { de, dePlurals } from './de';
import { fr, frPlurals } from './fr';
import { tr, trPlurals } from './tr';
import { vi, viPlurals } from './vi';
import { id, idPlurals } from './id';

export const LOCALES: Record<LocaleCode, Locale> = {
  en: { messages: en, plurals: enPlurals, nativeName: 'English' },
  'zh-Hans': { messages: zhHans, plurals: zhHansPlurals, nativeName: '简体中文' },
  es: { messages: es, plurals: esPlurals, nativeName: 'Español' },
  ru: { messages: ru, plurals: ruPlurals, nativeName: 'Русский' },
  'pt-BR': { messages: ptBR, plurals: ptBRPlurals, nativeName: 'Português (Brasil)' },
  ja: { messages: ja, plurals: jaPlurals, nativeName: '日本語' },
  ko: { messages: ko, plurals: koPlurals, nativeName: '한국어' },
  de: { messages: de, plurals: dePlurals, nativeName: 'Deutsch' },
  fr: { messages: fr, plurals: frPlurals, nativeName: 'Français' },
  tr: { messages: tr, plurals: trPlurals, nativeName: 'Türkçe' },
  vi: { messages: vi, plurals: viPlurals, nativeName: 'Tiếng Việt' },
  id: { messages: id, plurals: idPlurals, nativeName: 'Bahasa Indonesia' },
};
