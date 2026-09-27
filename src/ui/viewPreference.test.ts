import { beforeEach, describe, expect, it } from 'vitest';
import { persistViewPreference, readViewPreference } from './viewPreference';

const STORAGE_KEY = 'swiftdrive:view';

// The vitest environment here is plain Node (see vitest.config.ts — no jsdom dependency in this
// project), which has no `localStorage` global. A minimal in-memory stand-in is enough to test
// the read/write/fallback logic; the module under test only ever calls getItem/setItem.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  clear() {
    this.store.clear();
  }
}
globalThis.localStorage = new MemoryStorage();

beforeEach(() => {
  localStorage.clear();
});

describe('readViewPreference', () => {
  it('defaults to list view at medium size when nothing is stored', () => {
    expect(readViewPreference()).toEqual({ viewMode: 'list', tileSize: 'md' });
  });

  it('round-trips a value written by persistViewPreference', () => {
    persistViewPreference({ viewMode: 'icon', tileSize: 'lg' });
    expect(readViewPreference()).toEqual({ viewMode: 'icon', tileSize: 'lg' });
  });

  it('falls back to defaults for corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(readViewPreference()).toEqual({ viewMode: 'list', tileSize: 'md' });
  });

  it('falls back per-field for an unrecognized value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewMode: 'bogus', tileSize: 'sm' }));
    expect(readViewPreference()).toEqual({ viewMode: 'list', tileSize: 'sm' });
  });
});
