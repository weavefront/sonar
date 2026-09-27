import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'swiftdrive:theme';

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

/**
 * Normalizes any CSS color string to `rgb(r, g, b)` via a 1x1 canvas. Needed because
 * `getComputedStyle` doesn't reliably return the legacy `rgb()` serialization any more — `--bg` is
 * declared with `color-mix(in oklch, ...)`, and current browsers can hand that back as a literal
 * `oklch(...)` string instead. `<meta name="theme-color">` support for that format isn't something
 * to gamble the whole browser-chrome-color feature on when a plain, universally-understood `rgb()`
 * is one canvas round-trip away.
 */
function toStandardRgb(cssColor: string): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}

/** Exported for direct unit testing — no React Testing Library in this project to render a hook. */
export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function persistThemePreference(pref: ThemePreference) {
  try {
    // 'system' just means "no override" — nothing to remember, and removing the key means a
    // future visit falls straight through to the OS preference again with no stale leftover.
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage may be unavailable; the choice just won't survive a reload */
  }
}

/**
 * Stamps (or clears) `data-theme` on `<html>` — `styles.css`'s `:root[data-theme="light"]` /
 * `:root[data-theme="dark"]` blocks use attribute-selector specificity to override the
 * `prefers-color-scheme` media query in either direction. `index.html` has a small inline script
 * that does this same thing synchronously before first paint, so a saved override doesn't flash
 * the system theme first — this call is what keeps it in sync after that.
 */
export function applyThemePreference(pref: ThemePreference) {
  if (pref === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}

/**
 * A single toggle button (no separate "system" option in the UI) still needs to know what
 * "system" currently resolves to, both for its very first render — a fresh visitor with no saved
 * preference should see the button reflect their actual OS setting, not a hardcoded guess — and to
 * stay correct if the OS setting changes while the page is open.
 */
export function useThemePreference(): {
  theme: ThemePreference;
  effective: EffectiveTheme;
  toggle: () => void;
} {
  const [theme, setThemeState] = useState<ThemePreference>(readThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const effective: EffectiveTheme = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  // `index.html` has static light/dark `<meta name="theme-color">` tags for the common
  // system-preference case (zero JS needed, correct even before this module has loaded) — but an
  // *explicit* override (this toggle) can disagree with the OS setting, which a plain
  // `media="(prefers-color-scheme: ...)"` tag has no way to express. A third, unqualified tag with
  // its `content` kept in sync here is what makes an explicit choice win in the browser chrome too
  // (installed-PWA title bar, mobile status bar), not just in the page's own CSS. Reads the real
  // computed `background-color` off `<body>` rather than duplicating the color literal here —
  // `styles.css`'s `--bg` is itself a `color-mix()`, and a hand-copied hex would drift from it the
  // next time that palette changes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let meta = document.querySelector('meta[data-dynamic-theme-color]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('data-dynamic-theme-color', '');
      document.head.appendChild(meta);
    }
    const bg = toStandardRgb(getComputedStyle(document.body).backgroundColor);
    if (bg) meta.setAttribute('content', bg);
  }, [effective]);

  // Toggling always lands on an explicit choice, never back on 'system' — there's no UI for that
  // anymore. A fresh visitor still gets the system theme by default (nothing stored yet); once
  // they've toggled once, it stays exactly where they left it, same as any other saved preference.
  const toggle = () => {
    const next: ThemePreference = effective === 'dark' ? 'light' : 'dark';
    persistThemePreference(next);
    applyThemePreference(next);
    setThemeState(next);
  };

  return { theme, effective, toggle };
}
