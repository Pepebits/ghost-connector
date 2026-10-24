import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // dist/ contains compiled (and possibly stale) copies of the tests.
    exclude: ['**/node_modules/**', 'dist/**'],
  },
});
