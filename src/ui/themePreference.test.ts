import { beforeEach, describe, expect, it } from 'vitest';
import { persistThemePreference, readThemePreference } from './themePreference';

const STORAGE_KEY = 'swiftdrive:theme';

// Plain Node vitest environment (see viewPreference.test.ts for why) — no real localStorage.
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

describe('readThemePreference', () => {
  it('defaults to system when nothing is stored', () => {
    expect(readThemePreference()).toBe('system');
  });

  it('round-trips a value written by persistThemePreference', () => {
    persistThemePreference('dark');
    expect(readThemePreference()).toBe('dark');
    persistThemePreference('light');
    expect(readThemePreference()).toBe('light');
  });

  it('removes the stored key when set back to system, rather than leaving it stale', () => {
    persistThemePreference('dark');
    persistThemePreference('system');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readThemePreference()).toBe('system');
  });

  it('falls back to system for an unrecognized stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
  });
});
