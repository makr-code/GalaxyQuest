import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/js/**/*.test.js', 'tests/webgpu/**/*.test.js'],
    setupFiles: ['tests/webgpu/setup.js'],
    restoreMocks: true,
    clearMocks: true,
  },
});
