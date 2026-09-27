import { useT } from '../i18n';
import { MoonIcon, SunIcon } from './icons';
import { useThemePreference } from './themePreference';

/** A single button that flips between light and dark — shows the *current* theme's icon, defaults
    to following the system on a first visit, and stays exactly where a visitor leaves it once
    they've clicked it (see themePreference.ts's `toggle`). */
export function ThemeToggle() {
  const { effective, toggle } = useThemePreference();
  const { t } = useT();
  const isDark = effective === 'dark';
  const label = isDark ? t('theme.switchToLight') : t('theme.switchToDark');

  return (
    <button
      onClick={toggle}
      aria-label={label}
      title={label}
      className="grid place-items-center w-8 h-8 rounded-lg border border-app surface-2 hover:opacity-80 transition-opacity shrink-0"
    >
      {isDark ? <MoonIcon className="w-3.5 h-3.5" /> : <SunIcon className="w-3.5 h-3.5" />}
    </button>
  );
}
