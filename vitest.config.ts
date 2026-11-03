import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Each test builds its own app with fresh in-memory repositories, so files
    // can run in parallel without sharing state.
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/server.ts', 'src/scripts/**', '**/*.d.ts'],
      reporter: ['text', 'html'],
    },
  },
});
