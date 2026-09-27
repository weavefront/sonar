/**
 * Active-locale state + persistence.
 *
 * A zustand store rather than a plain module variable, matching `wallet/store.ts`,
 * `state/arfs.ts` and `state/privateDrives.ts`. That choice is load-bearing here: `ui/format.ts`
 * needs the active locale from *non-React* code and reads it via `.getState()` — the same pattern
 * `state/arfs.ts` already uses for `usePrivateDrives.getState()` — while components subscribing
 * through `useT()` still re-render when the language changes.
 *
 * `readLocalePreference` / `persistLocalePreference` / `matchLocale` are exported as pure
 * functions for the same reason `themePreference.ts` exports its equivalents: there's no React
 * Testing Library in this project, so the pure functions are what's actually unit-testable.
 */

import { create } from 'zustand';
import { DEFAULT_LOCALE, LOCALE_CODES, type LocaleCode } from './types';

const STORAGE_KEY = 'swiftdrive:locale';

function isLocaleCode(v: unknown): v is LocaleCode {
  return typeof v === 'string' && (LOCALE_CODES as readonly string[]).includes(v);
}

/**
 * Best-match a list of BCP-47 tags (typically `navigator.languages`) against what we ship.
 *
 * Two passes per tag: exact, then base language — so `pt-PT` lands on `pt-BR` and `en-GB` on `en`
 * rather than falling through to the default. Known imperfection: any `zh-*` (including
 * Traditional `zh-Hant` / `zh-TW`) resolves to `zh-Hans`, because Simplified is the only Chinese
 * script shipped; that's a closer match than English, but it is a real substitution, not a
 * translation of Traditional.
 */
export function matchLocale(preferred: readonly string[]): LocaleCode {
  for (const raw of preferred) {
    const tag = raw.toLowerCase();
    const exact = LOCALE_CODES.find((code) => code.toLowerCase() === tag);
    if (exact) return exact;

    const base = tag.split('-')[0];
    if (!base) continue;
    const byBase = LOCALE_CODES.find((code) => code.toLowerCase().split('-')[0] === base);
    if (byBase) return byBase;
  }
  return DEFAULT_LOCALE;
}

/** A previously-saved explicit choice, or `null` when the user has never picked one. */
export function readLocalePreference(): LocaleCode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLocaleCode(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function persistLocalePreference(locale: LocaleCode) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage may be unavailable; the choice just won't survive a reload */
  }
}

/** Saved choice first, then the browser's language list, then English. */
export function detectLocale(): LocaleCode {
  const saved = readLocalePreference();
  if (saved) return saved;
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  return matchLocale(navigator.languages ?? [navigator.language]);
}

/**
 * Keeps `<html lang>` truthful. It drives screen-reader pronunciation, browser translation
 * prompts, and font/line-breaking selection (notably for CJK), so it has to follow the in-app
 * choice rather than the OS. `index.html` sets this pre-paint from the same storage key.
 */
function applyDocumentLang(locale: LocaleCode) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

interface LocaleState {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
}

export const useLocaleStore = create<LocaleState>((set) => {
  const initial = typeof window === 'undefined' ? DEFAULT_LOCALE : detectLocale();
  applyDocumentLang(initial);

  return {
    locale: initial,
    setLocale(locale: LocaleCode) {
      persistLocalePreference(locale);
      applyDocumentLang(locale);
      set({ locale });
    },
  };
});
