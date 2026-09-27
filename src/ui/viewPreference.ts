import { useState } from 'react';

export type ViewMode = 'list' | 'icon' | 'dense';
export type TileSize = 'sm' | 'md' | 'lg';

export const TILE_PX: Record<TileSize, number> = { sm: 96, md: 144, lg: 208 };

const STORAGE_KEY = 'swiftdrive:view';

interface Persisted {
  viewMode: ViewMode;
  tileSize: TileSize;
}

const DEFAULTS: Persisted = { viewMode: 'list', tileSize: 'md' };

function isViewMode(v: unknown): v is ViewMode {
  return v === 'list' || v === 'icon' || v === 'dense';
}

function isTileSize(v: unknown): v is TileSize {
  return v === 'sm' || v === 'md' || v === 'lg';
}

/** Exported for direct unit testing — no React Testing Library in this project to render a hook. */
export function readViewPreference(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      viewMode: isViewMode(parsed.viewMode) ? parsed.viewMode : DEFAULTS.viewMode,
      tileSize: isTileSize(parsed.tileSize) ? parsed.tileSize : DEFAULTS.tileSize,
    };
  } catch {
    return DEFAULTS;
  }
}

export function persistViewPreference(value: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage may be unavailable; the preference just won't survive a reload */
  }
}

/**
 * How the file list is laid out — List (today's default), Icon (large image tiles), or Dense
 * (compact text-only rows) — plus Icon view's tile size. Persisted across reloads the same way
 * `wallet/store.ts` persists the connected address: a single colon-namespaced localStorage key,
 * read once at mount and written through on every change, silently no-op'ing if storage throws.
 */
export function useViewPreference(): {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  tileSize: TileSize;
  setTileSize: (s: TileSize) => void;
} {
  const [state, setState] = useState<Persisted>(readViewPreference);

  const setViewMode = (viewMode: ViewMode) =>
    setState((prev) => {
      const next = { ...prev, viewMode };
      persistViewPreference(next);
      return next;
    });

  const setTileSize = (tileSize: TileSize) =>
    setState((prev) => {
      const next = { ...prev, tileSize };
      persistViewPreference(next);
      return next;
    });

  return { viewMode: state.viewMode, setViewMode, tileSize: state.tileSize, setTileSize };
}
