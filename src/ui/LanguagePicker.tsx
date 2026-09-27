import { LOCALES, LOCALE_CODES, useLocaleStore, useT, type LocaleCode } from '../i18n';

/**
 * Language selector.
 *
 * A native `<select>` rather than the segmented-button pattern `ThemeToggle`/`ViewModeSwitcher`
 * use: twelve options is well past what a row of buttons can carry, and a native select gets the
 * platform's own picker (the iOS wheel, Android's dialog) for free — which is exactly the control
 * someone struggling with the current UI language most needs to be able to operate.
 *
 * Options are labelled with each language's *endonym* ("Español", not "Spanish") for the same
 * reason: a user who can't read the currently-active language still has to be able to find theirs.
 */
export function LanguagePicker() {
  const { t, locale } = useT();
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as LocaleCode)}
      aria-label={t('language.label')}
      title={t('language.label')}
      className="h-8 max-w-32 px-1.5 rounded-lg border border-app surface-2 text-xs shrink-0 hover:opacity-80 transition-opacity"
    >
      {LOCALE_CODES.map((code) => (
        <option key={code} value={code}>
          {LOCALES[code].nativeName}
        </option>
      ))}
    </select>
  );
}
