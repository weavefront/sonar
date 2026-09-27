/**
 * Display helpers: sizes, dates, and file-kind classification for preview + icons.
 *
 * Everything locale-sensitive here reads the *app's* active language rather than the browser's,
 * and every `Intl` object is built per-locale on demand instead of once at module scope. That
 * distinction is the whole point: a module-scope `new Intl.RelativeTimeFormat(undefined, …)`
 * captures the system locale at first import and then silently ignores an in-app language change
 * forever, which is exactly the bug this file used to have.
 *
 * Read through `.getState()` rather than a hook because these are plain functions called from
 * dozens of render paths — the components calling them already re-render on a language change via
 * `useT()`, so the value is always read fresh.
 */

import { useLocaleStore } from '../i18n/store';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

function activeLocale(): string {
  return useLocaleStore.getState().locale;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(maximumFractionDigits: number): Intl.NumberFormat {
  const locale = activeLocale();
  const cacheKey = `${locale}:${maximumFractionDigits}`;
  let format = numberFormats.get(cacheKey);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits });
    numberFormats.set(cacheKey, format);
  }
  return format;
}

/**
 * Byte units stay as the SI symbols (`KB`, `MB`) — they aren't localized in practice, and a
 * translated "МБ"/"Mo" would be less recognizable than the symbol in most software. The *number*
 * is localized, so a French or German user sees `1,5 MB` rather than `1.5 MB`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 ? 0 : value < 10 ? 1 : 0;
  return `${numberFormat(digits).format(value)} ${UNITS[exponent]}`;
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function rtf(): Intl.RelativeTimeFormat {
  const locale = activeLocale();
  let format = relativeFormats.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeFormats.set(locale, format);
  }
  return format;
}
const STEPS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, 'second'],
  [3600, 'minute'],
  [86_400, 'hour'],
  [604_800, 'day'],
  [2_629_800, 'week'],
  [31_557_600, 'month'],
];

/** "3 days ago" for recent items, falling back to an absolute date for older ones. */
export function formatRelative(ms: number): string {
  if (!ms) return '—';
  const deltaSeconds = (ms - Date.now()) / 1000;
  const magnitude = Math.abs(deltaSeconds);

  if (magnitude > 31_557_600) return formatDate(ms);
  let divisor = 1;
  for (const [limit, unit] of STEPS) {
    if (magnitude < limit) return rtf().format(Math.round(deltaSeconds / divisor), unit);
    divisor = limit;
  }
  return rtf().format(Math.round(deltaSeconds / 31_557_600), 'year');
}

export function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(activeLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(activeLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'code' | 'archive' | 'other';

const EXT_KINDS: Record<string, FileKind> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  csv: 'text',
  json: 'code',
  js: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  sh: 'code',
  html: 'code',
  css: 'code',
  yml: 'code',
  yaml: 'code',
  toml: 'code',
  xml: 'code',
  zip: 'archive',
  gz: 'archive',
  tar: 'archive',
  rar: 'archive',
  '7z': 'archive',
};

/** Classify by MIME type first, falling back to extension when the type is generic. */
export function fileKind(contentType: string, name: string): FileKind {
  const type = (contentType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const byExt = EXT_KINDS[ext];
  if (byExt) return byExt;

  if (type.startsWith('text/')) return 'text';
  if (type.includes('json') || type.includes('javascript') || type.includes('xml')) return 'code';
  if (type.includes('zip') || type.includes('compressed') || type.includes('tar')) return 'archive';
  return 'other';
}

/** Kinds we can render inline without downloading the whole file first. */
export function isPreviewable(kind: FileKind): boolean {
  return kind !== 'other' && kind !== 'archive';
}

export const KIND_ICONS: Record<FileKind, string> = {
  image: '🖼',
  video: '🎬',
  audio: '🎵',
  pdf: '📕',
  markdown: '📝',
  text: '📄',
  code: '⌨',
  archive: '🗜',
  other: '📦',
};

/** Public URL for a data transaction on a gateway. */
export function dataUrl(gateway: string, dataTxId: string): string {
  return `${gateway}/${dataTxId}`;
}

/** 1 AR = 10^12 Winston — fixed by the Arweave protocol itself, not a fluctuating price. */
const WINSTON_PER_AR = 1e12;

/**
 * Format a Winston Credits amount ("winc" — Turbo's native pricing unit) as a human AR figure.
 * Used everywhere winc is shown: the balance display and every cost preview before a signed
 * write. Rounding to AR loses no real precision — the AR/winc ratio is a fixed protocol constant,
 * not a guessed price — so it's safe even at the spend-decision moment; what this deliberately
 * never does is guess at an AR→USD conversion, which *would* need live, unverified price data.
 */
export function formatBalance(winc: string): string {
  const n = Number(winc);
  if (!Number.isFinite(n)) return `${winc} winc`;
  const ar = n / WINSTON_PER_AR;
  if (ar === 0) return '0 AR';
  if (ar < 0.0001) return '< 0.0001 AR';
  return `${numberFormat(4).format(ar)} AR`;
}
