import { defineConfig } from 'vite';

// Separate build: no evaluation imports or Babylon chunks in the normal game entry.
export default defineConfig({
  build: {
    outDir: 'dist-evaluation',
    rollupOptions: { input: 'tools/babylon-colony-evaluation.html' },
  },
});
