import { describe, expect, it, afterEach } from 'vitest';
import { matchLocale, useLocaleStore } from './store';
import { t, tPlural } from './translate';
import { LOCALES } from './locales';
import { en, enPlurals } from './locales/en';
import { LOCALE_CODES, DEFAULT_LOCALE, type LocaleCode } from './types';

/** Set the active locale without touching localStorage/document — neither exists in the node env. */
function withLocale(locale: LocaleCode) {
  useLocaleStore.setState({ locale });
}

afterEach(() => withLocale(DEFAULT_LOCALE));

describe('locale matching', () => {
  it('prefers an exact tag match', () => {
    expect(matchLocale(['pt-BR'])).toBe('pt-BR');
    expect(matchLocale(['ja'])).toBe('ja');
  });

  it('falls back to the base language for a region we do not ship', () => {
    // European Portuguese gets Brazilian rather than English — a much closer match.
    expect(matchLocale(['pt-PT'])).toBe('pt-BR');
    expect(matchLocale(['en-GB'])).toBe('en');
    expect(matchLocale(['de-AT'])).toBe('de');
  });

  it('routes any Chinese variant to Simplified, the only script shipped', () => {
    expect(matchLocale(['zh-CN'])).toBe('zh-Hans');
    expect(matchLocale(['zh-TW'])).toBe('zh-Hans');
    expect(matchLocale(['zh'])).toBe('zh-Hans');
  });

  it('is case-insensitive, as BCP-47 tags are', () => {
    expect(matchLocale(['PT-br'])).toBe('pt-BR');
    expect(matchLocale(['ZH-Hans'])).toBe('zh-Hans');
  });

  it('walks the preference list in order and skips unsupported entries', () => {
    expect(matchLocale(['sw', 'is', 'ko', 'fr'])).toBe('ko');
  });

  it('falls back to English for anything unrecognised', () => {
    expect(matchLocale(['sw', 'xx-YY'])).toBe('en');
    expect(matchLocale([])).toBe('en');
  });
});

describe('t()', () => {
  it('returns the active locale’s string', () => {
    withLocale('fr');
    expect(t('common.cancel')).toBe('Annuler');
    withLocale('ja');
    expect(t('common.cancel')).toBe('キャンセル');
  });

  it('interpolates named parameters', () => {
    withLocale('en');
    expect(t('move.title', { name: 'report.pdf' })).toBe('Move report.pdf');
    expect(t('driveList.createdWithVersion', { date: '3 days ago', version: '0.15' })).toBe(
      'Created 3 days ago · ArFS 0.15',
    );
  });

  it('leaves an unsupplied placeholder visible rather than blanking it', () => {
    // A stray `{name}` on screen is a reportable bug; a silently empty string just looks like
    // missing data, which is far harder to notice or diagnose.
    withLocale('en');
    expect(t('move.title')).toBe('Move {name}');
  });
});

describe('tPlural()', () => {
  it('selects Russian one/few/many correctly', () => {
    withLocale('ru');
    // The reason PluralForms allows more than one/other at all.
    expect(tPlural('items', 1)).toBe('1 элемент');
    expect(tPlural('items', 2)).toBe('2 элемента');
    expect(tPlural('items', 5)).toBe('5 элементов');
    expect(tPlural('items', 21)).toBe('21 элемент');
    expect(tPlural('items', 22)).toBe('22 элемента');
    expect(tPlural('items', 11)).toBe('11 элементов');
  });

  it('uses the single form for languages with no plural inflection', () => {
    withLocale('ja');
    expect(tPlural('items', 1)).toBe('1 件');
    expect(tPlural('items', 7)).toBe('7 件');
  });

  it('handles English one/other', () => {
    withLocale('en');
    expect(tPlural('items', 1)).toBe('1 item');
    expect(tPlural('items', 0)).toBe('0 items');
    expect(tPlural('matches', 1)).toBe('1 match');
    expect(tPlural('matches', 3)).toBe('3 matches');
  });

  it('keeps Turkish nouns singular after a numeral', () => {
    withLocale('tr');
    expect(tPlural('items', 1)).toBe('1 öge');
    expect(tPlural('items', 5)).toBe('5 öge');
  });
});

/**
 * The highest-value check in this file. A translation that drops a `{count}` or `{name}` still
 * type-checks and still renders — it just silently loses the data, which is the classic i18n bug
 * and is very easy to miss by eye across 12 languages.
 */
describe('translation integrity', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const code of LOCALE_CODES) {
    describe(code, () => {
      const { messages, plurals } = LOCALES[code];

      it('has exactly the English key set', () => {
        expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
        expect(Object.keys(plurals).sort()).toEqual(Object.keys(enPlurals).sort());
      });

      it('uses the same placeholders as English in every message', () => {
        for (const [key, englishValue] of Object.entries(en)) {
          const translated = messages[key as keyof typeof en];
          expect(placeholders(translated), `${code} → ${key}`).toEqual(placeholders(englishValue));
        }
      });

      it('includes {count} in every plural form', () => {
        for (const [key, forms] of Object.entries(plurals)) {
          for (const [category, form] of Object.entries(forms)) {
            expect(form, `${code} → ${key}.${category}`).toContain('{count}');
          }
        }
      });

      it('has no empty or whitespace-only values', () => {
        for (const [key, value] of Object.entries(messages)) {
          expect(value.trim(), `${code} → ${key}`).not.toBe('');
        }
      });

      it('always provides the `other` plural category', () => {
        // CLDR guarantees `other` exists for every language, and tPlural falls back to it.
        for (const [key, forms] of Object.entries(plurals)) {
          expect(forms.other, `${code} → ${key}`).toBeTruthy();
        }
      });
    });
  }

  it('translates away from English for every non-English locale', () => {
    // Guards against a locale file accidentally being wired to the English messages object —
    // exactly the placeholder state the registry started in while translations were being written.
    for (const code of LOCALE_CODES.filter((c) => c !== 'en')) {
      expect(LOCALES[code].messages['driveList.title'], code).not.toBe(en['driveList.title']);
    }
  });
});
