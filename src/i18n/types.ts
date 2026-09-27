/**
 * Types derived from the English locale, which is the single source of truth.
 *
 * Deliberately one-directional: `en.ts` imports nothing, this file imports `en.ts`, and every
 * other locale imports this file. No cycles, and no locale can drift from the key set without
 * failing `tsc`.
 */

import { en, enPlurals } from './locales/en';

export type MessageKey = keyof typeof en;

/** Every locale must supply exactly these keys — no more, no fewer. */
export type Messages = Record<MessageKey, string>;

/**
 * `other` is the only category CLDR guarantees exists for every language, so it's the only one
 * required here; the rest are per-language (English uses `one`/`other`, Russian adds `few`/`many`,
 * Japanese uses `other` alone). `Intl.PluralRules.select()` never returns a category a language
 * doesn't use, and `tPlural` falls back to `other` regardless, so an absent category is safe.
 */
export type PluralForms = { other: string } & Partial<
  Record<Exclude<Intl.LDMLPluralRule, 'other'>, string>
>;

export type PluralKey = keyof typeof enPlurals;
export type PluralMessages = Record<PluralKey, PluralForms>;

/** One locale's complete contribution: flat strings + count-driven strings + its own name. */
export interface Locale {
  messages: Messages;
  plurals: PluralMessages;
  /**
   * The language's name *in that language* ("Español", not "Spanish") — someone who can't read the
   * currently-active UI language still needs to be able to find their own in the picker.
   */
  nativeName: string;
}

export const LOCALE_CODES = [
  'en',
  'zh-Hans',
  'es',
  'ru',
  'pt-BR',
  'ja',
  'ko',
  'de',
  'fr',
  'tr',
  'vi',
  'id',
] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];

export const DEFAULT_LOCALE: LocaleCode = 'en';
