/**
 * Vite Configuration (ESM)
 * ES6 Module bundler for GalaxyQuest
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from 'vite';

export default ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = process.env.GQ_PHP_BACKEND_URL || env.GQ_PHP_BACKEND_URL || 'http://127.0.0.1:8081';
  return {
  plugins: [{
    name: 'local-audio-catalog',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!['/api/audio.php', '/api/v1/audio.php'].includes(url.pathname)) return next();
        const send = (code, payload) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        };
        if (req.method !== 'GET') return send(405, { success: false, error: 'Method not allowed' });
        const action = url.searchParams.get('action') || 'list';
        if (!['list', 'list_sfx'].includes(action)) return send(400, { success: false, error: 'Unknown action' });
        const folder = action === 'list' ? 'music' : 'sfx';
        const extensions = new Set(['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac', 'webm']);
        try {
          const directory = path.join(server.config.root, folder);
          const entries = await readdir(directory, { withFileTypes: true });
          const tracks = await Promise.all(entries
            .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).slice(1).toLowerCase()))
            .map(async (entry) => {
              const info = await stat(path.join(directory, entry.name));
              const ext = path.extname(entry.name);
              return {
                value: `${folder}/${encodeURIComponent(entry.name)}`,
                label: entry.name.slice(0, -ext.length).replace(/[_-]+/g, ' ').trim() || entry.name,
                file: entry.name, ext: ext.slice(1).toLowerCase(),
                size: info.size, modified_at: info.mtime.toISOString(),
              };
            }));
          tracks.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
          send(200, { success: true, tracks });
        } catch (error) {
          server.config.logger.error(`Audio catalog failed: ${error.message}`);
          send(500, { success: false, error: 'Audio catalog could not be read.' });
        }
      });
    },
  }],
  server: {
    port: 8080,
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '^/.*\\.php(?:\\?|$)': {
        target: backend,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (error, req, res) => {
            console.error(`[PHP backend] ${req.url}: ${error.message}`);
            if (!res.headersSent && !res.writableEnded) {
              res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({
                success: false,
                error: `PHP backend unavailable at ${backend}. Start the PHP server or configure GQ_PHP_BACKEND_URL.`,
              }));
            }
          });
        },
      },
    },
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
};
