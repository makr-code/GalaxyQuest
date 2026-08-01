/**
 * Vite Configuration
 * ES6 Module bundler for GalaxyQuest
 */

export default {
  server: {
    port: 8080,
    host: '127.0.0.1',
    watch: {
      usePolling: true,  // Windows file watching
      interval: 100,
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: false,  // Disable minify due to lightningcss CSS parsing issues
    
    rollupOptions: {
      output: {
        // Code splitting strategy (Function-based for Vite 5+)
        manualChunks: (id) => {
          // Vendor libraries
          if (id.includes('node_modules')) {
            if (id.includes('three')) return 'vendor-three';
            if (id.includes('tone')) return 'vendor-tone';
            if (id.includes('dexie')) return 'vendor-dexie';
            return 'vendor'; // Other node_modules
          }
          
          // Core game logic
          if (id.includes('/js/api.js') || id.includes('/js/main.js')) {
            return 'core';
          }
          
          // Domains can be split here if needed
          if (id.includes('/domains/')) {
            const match = id.match(/\/domains\/([^/]+)/);
            if (match) return `domain-${match[1]}`;
          }
          
          return undefined; // Default chunk
        },
      },
    },
  },

  resolve: {
    alias: {
      '@': '/src/js',  // Shorter imports: import X from '@/api.js'
    },
  },
};
