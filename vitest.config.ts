import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Live tests hit mainnet gateways and are slow by nature.
    testTimeout: 120_000,
  },
});
