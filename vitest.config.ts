import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // dist/ contains compiled (and possibly stale) copies of the tests.
    exclude: ['**/node_modules/**', 'dist/**'],
    // Login tests hash passwords with scrypt, slow on purpose: with every file
    // running in parallel (and on CI runners) 5 s can fall short.
    testTimeout: 20_000,
  },
});
