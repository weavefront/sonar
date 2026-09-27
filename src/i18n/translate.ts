/**
 * The React-free half of the i18n layer: lookup, `{param}` interpolation, plurals.
 *
 * Split out from `index.ts` (which adds `useT`/`tParts` and therefore imports React) so that
 * non-UI modules — `arfs/crypto/*`, `turbo/*`, `wallet/*`, `state/*` — can translate a thrown
 * error message without dragging React into a pure crypto or network module.
 */

import { useLocaleStore } from './store';
import { LOCALES } from './locales';
import { en, enPlurals } from './locales/en';
import type { LocaleCode, MessageKey, PluralKey } from './types';

export type Params = Record<string, string | number>;

export const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  // An unmatched `{foo}` is left visible rather than blanked — a stray `{foo}` in the UI is an
  // obvious, reportable bug, whereas silently dropping it just looks like missing data.
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

export function lookup(key: MessageKey): string {
  const { locale } = useLocaleStore.getState();
  // The `?? en[key]` is unreachable per the types (every locale is a complete `Messages`) and
  // kept only because locale files are bulk-edited data — a hand-broken one should degrade to
  // English rather than render `undefined`.
  return LOCALES[locale].messages[key] ?? en[key];
}

export function t(key: MessageKey, params?: Params): string {
  return interpolate(lookup(key), params);
}

const pluralRulesCache = new Map<LocaleCode, Intl.PluralRules>();

function pluralRules(locale: LocaleCode): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/**
 * Count-driven lookup. `count` is always available to the template as `{count}`, so call sites
 * don't pass it twice. Category selection is `Intl.PluralRules`, so Russian's one/few/many and
 * Japanese's single form are both handled by the browser's own CLDR data rather than by hand.
 */
export function tPlural(key: PluralKey, count: number, params?: Params): string {
  const { locale } = useLocaleStore.getState();
  const forms = LOCALES[locale].plurals[key] ?? enPlurals[key];
  const category = pluralRules(locale).select(count);
  return interpolate(forms[category] ?? forms.other, { count, ...params });
}
