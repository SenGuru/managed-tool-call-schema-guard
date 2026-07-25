import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Several security and operator tests intentionally execute the real TS
    // CLI in child processes. Leaving Vitest at the host CPU count can start
    // dozens of compilers at once, making an otherwise healthy subprocess miss
    // its assertion timeout on both developer workstations and small CI
    // runners. Four workers preserves file-level parallel coverage without
    // turning the release gate into a machine-size race.
    maxWorkers: 4,
    coverage: {
      reporter: ['text', 'json-summary'],
      thresholds: { statements: 78, branches: 70, functions: 75, lines: 80 },
    },
  },
});
