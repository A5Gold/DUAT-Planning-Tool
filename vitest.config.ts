import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'out/**', 'tests/ui/**', '**/*.spec.ts'],
  },
});
