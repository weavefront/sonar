import { describe, expect, it } from 'vitest';
import { formatBalance } from './format';

describe('formatBalance', () => {
  it('converts winc to AR using the fixed 10^12 protocol ratio', () => {
    expect(formatBalance('1000000000000')).toBe('1 AR');
    expect(formatBalance('1712816730268')).toBe('1.7128 AR');
  });

  it('shows exactly zero as a plain zero, not a rounding artifact', () => {
    expect(formatBalance('0')).toBe('0 AR');
  });

  it('floors a nonzero dust amount rather than rounding it down to a misleading zero', () => {
    expect(formatBalance('1')).toBe('< 0.0001 AR');
  });
});
