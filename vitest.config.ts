import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json-summary'],
      thresholds: { statements: 78, branches: 70, functions: 75, lines: 80 },
    },
  },
});
