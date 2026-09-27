/**
 * Translation entry point for components.
 *
 * Hand-rolled rather than `react-i18next` — the surface actually needed here is lookup,
 * `{param}` interpolation and plurals, and the browser already ships the genuinely hard part
 * (`Intl.PluralRules`). This matches how the rest of the codebase treats small primitives:
 * native WebCrypto instead of a crypto library, hand-rolled `localStorage` wrappers in
 * `ui/viewPreference.ts` and `ui/themePreference.ts` instead of zustand's `persist` middleware.
 *
 * Two entry points, deliberately:
 *   - `useT()` in components — subscribes to the locale, so a language change re-renders.
 *   - bare `t()` from `./translate` in non-React code (thrown error messages in `turbo/`,
 *     `wallet/`, `state/`) — reads the current locale at throw time, which is when the string is
 *     actually built.
 */

import { createElement, Fragment, type ReactNode } from 'react';
import { useLocaleStore } from './store';
import { lookup, t, tPlural, PLACEHOLDER } from './translate';
import type { MessageKey } from './types';

export type { LocaleCode, MessageKey, PluralKey } from './types';
export type { Params } from './translate';
export { LOCALE_CODES, DEFAULT_LOCALE } from './types';
export { LOCALES } from './locales';
export { useLocaleStore } from './store';
export { t, tPlural } from './translate';

/**
 * Like `t()`, but substitutes React nodes instead of strings — for the two sentences that wrap a
 * value in markup ("No extension detected. **Install Wander**, or …", "Enter the password for
 * **{name}**."). Keeping those as one key rather than three JSX fragments is what lets a
 * translation move the link or the name to wherever that language's sentence actually needs it.
 */
export function tParts(key: MessageKey, params: Record<string, ReactNode>): ReactNode[] {
  const template = lookup(key);
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of template.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    const name = match[1] ?? '';
    if (index > cursor) parts.push(template.slice(cursor, index));
    // Wrapped with a key so React doesn't warn about an array of children.
    parts.push(
      Object.hasOwn(params, name)
        ? createElement(Fragment, { key: `${name}-${index}` }, params[name])
        : match[0],
    );
    cursor = index + match[0].length;
  }
  if (cursor < template.length) parts.push(template.slice(cursor));
  return parts;
}

/** Component-facing entry point — subscribing to `locale` is what re-renders on a language change. */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return { t, tPlural, tParts, locale };
}
