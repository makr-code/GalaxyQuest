/**
 * GQTextureAdminUI - Admin panel for AI texture management
 * Manages cache, testing, batch operations, and statistics
 */

(function() {
  'use strict';

  class GQTextureAdminUI {
    constructor(containerSelector = '#admin-textures') {
      this.container = document.querySelector(containerSelector);
      if (!this.container) return;
      this.init();
    }

    init() {
      this.renderUI();
      this.setupEventListeners();
      GQTextureAdminUI.instance = this;
      this.loadCacheList();
    }

    renderUI() {
      this.container.innerHTML = `
        <div class="gq-texture-admin">
          <h2>AI Texture Management</h2>
          <div class="tabs">
            <button class="tab-btn active" data-tab="cache-list">Cache List</button>
            <button class="tab-btn" data-tab="test-prompt">Test Prompt</button>
            <button class="tab-btn" data-tab="batch-ops">Batch Ops</button>
            <button class="tab-btn" data-tab="stats">Statistics</button>
          </div>
          <div id="cache-list" class="tab-content active">
            <button class="btn" onclick="GQTextureAdminUI.instance.loadCacheList()">Refresh</button>
            <button class="btn btn-danger" onclick="GQTextureAdminUI.instance.showClearDialog()">Clear Cache</button>
            <div id="cache-list-container" class="texture-list"></div>
          </div>
          <div id="test-prompt" class="tab-content">
            <form onsubmit="return GQTextureAdminUI.instance.handleTestPrompt(event)">
              <textarea id="positive-prompt" placeholder="Positive prompt..." required></textarea>
              <textarea id="negative-prompt" placeholder="Negative prompt..."></textarea>
              <select id="test-size"><option value="256">256</option><option value="512" selected>512</option><option value="1024">1024</option></select>
              <button type="submit" class="btn">Generate</button>
            </form>
            <div id="test-result"></div>
          </div>
          <div id="batch-ops" class="tab-content">
            <select id="batch-faction"><option value="">All</option><option value="iron_fleet">Iron Fleet</option><option value="merchants">Merchants</option></select>
            <select id="batch-type"><option value="">All</option><option value="albedo">Albedo</option><option value="normal">Normal</option></select>
            <button class="btn" onclick="GQTextureAdminUI.instance.dryRunBatch()">Dry Run</button>
            <button class="btn btn-danger" onclick="GQTextureAdminUI.instance.executeBatch()">Execute</button>
            <div id="batch-result"></div>
          </div>
          <div id="stats" class="tab-content">
            <button class="btn" onclick="GQTextureAdminUI.instance.loadStats()">Refresh Stats</button>
            <div id="stats-container"></div>
          </div>
        </div>
      `;
    }

    setupEventListeners() {
      this.container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
      });
    }

    switchTab(tab) {
      this.container.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      this.container.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      this.container.querySelector(`#${tab}`).classList.add('active');
      this.container.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    }

    async loadCacheList() {
      const container = this.container.querySelector('#cache-list-container');
      container.innerHTML = '<p>Loading...</p>';
      try {
        const res = await fetch('api/textures-admin.php?action=list');
        const data = await res.json();
        if (data.success && data.textures.length > 0) {
          let html = '<table><tr><th>Type</th><th>Cache Key</th><th>Size</th><th>Actions</th></tr>';
          data.textures.forEach(t => {
            html += `<tr><td>${t.type}</td><td><code>${t.cache_key.substring(0, 16)}</code></td><td>${(t.size_bytes / 1024).toFixed(1)} KB</td><td><button onclick="GQTextureAdminUI.instance.regenTexture('${t.cache_key}')">Regenerate</button></td></tr>`;
          });
          container.innerHTML = html + '</table>';
        } else {
          container.innerHTML = '<p>No textures cached.</p>';
        }
      } catch (e) {
        container.innerHTML = `<p>Error: ${e.message}</p>`;
      }
    }

    async regenTexture(key) {
      if (!confirm('Regenerate?')) return;
      try {
        const res = await fetch(`api/textures-admin.php?action=regenerate&cache_key=${encodeURIComponent(key)}&force=1`);
        const data = await res.json();
        alert(data.success ? 'Queued' : data.error);
        this.loadCacheList();
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async handleTestPrompt(e) {
      e.preventDefault();
      const res = this.container.querySelector('#test-result');
      res.innerHTML = '<p>Generating...</p>';
      const form = new FormData();
      form.append('prompt', this.container.querySelector('#positive-prompt').value);
      form.append('negative_prompt', this.container.querySelector('#negative-prompt').value);
      form.append('size', this.container.querySelector('#test-size').value);
      form.append('steps', '30');
      try {
        const r = await fetch('api/textures-admin.php?action=test_prompt', {method: 'POST', body: form});
        const d = await r.json();
        res.innerHTML = d.success ? `<p>Submitted! ID: ${d.prompt_id}</p>` : `<p>Error: ${d.error}</p>`;
      } catch (err) {
        res.innerHTML = `<p>Error: ${err.message}</p>`;
      }
      return false;
    }

    async dryRunBatch() {
      const res = this.container.querySelector('#batch-result');
      res.innerHTML = '<p>Analyzing...</p>';
      const faction = this.container.querySelector('#batch-faction').value;
      const type = this.container.querySelector('#batch-type').value;
      try {
        const url = new URL('api/textures-admin.php', location.href);
        url.searchParams.set('action', 'batch_regenerate');
        url.searchParams.set('faction', faction);
        url.searchParams.set('texture_type', type);
        url.searchParams.set('dry_run', '1');
        const r = await fetch(url);
        const d = await r.json();
        res.innerHTML = d.success ? `<p>Would affect ${d.count} texture(s)</p>` : `<p>Error: ${d.error}</p>`;
      } catch (e) {
        res.innerHTML = `<p>Error: ${e.message}</p>`;
      }
    }

    async executeBatch() {
      if (!confirm('Delete and regenerate?')) return;
      const res = this.container.querySelector('#batch-result');
      res.innerHTML = '<p>Executing...</p>';
      const faction = this.container.querySelector('#batch-faction').value;
      const type = this.container.querySelector('#batch-type').value;
      try {
        const url = new URL('api/textures-admin.php', location.href);
        url.searchParams.set('action', 'batch_regenerate');
        url.searchParams.set('faction', faction);
        url.searchParams.set('texture_type', type);
        url.searchParams.set('dry_run', '0');
        const r = await fetch(url);
        const d = await r.json();
        res.innerHTML = d.success ? `<p>Deleted ${d.deleted} texture(s)</p>` : `<p>Error: ${d.error}</p>`;
      } catch (e) {
        res.innerHTML = `<p>Error: ${e.message}</p>`;
      }
    }

    showClearDialog() {
      if (!confirm('Clear ALL cache?')) return;
      const pwd = prompt('Type "yes_clear_all":');
      if (pwd === 'yes_clear_all') this.clearCache();
    }

    async clearCache() {
      try {
        const r = await fetch('api/textures-admin.php?action=clear_cache&confirm=yes_clear_all');
        const d = await r.json();
        alert(d.success ? `Deleted ${d.deleted} files` : d.error);
        this.loadCacheList();
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async loadStats() {
      const c = this.container.querySelector('#stats-container');
      c.innerHTML = '<p>Loading...</p>';
      try {
        const r = await fetch('api/textures-admin.php?action=cache_stats');
        const d = await r.json();
        if (d.success) {
          let h = `<p>Total: ${d.stats.total_textures} textures, ${d.stats.total_size_mb} MB</p><table><tr><th>Type</th><th>Count</th><th>Size MB</th></tr>`;
          for (const [t, i] of Object.entries(d.stats.by_type)) {
            h += `<tr><td>${t}</td><td>${i.count}</td><td>${(i.size / 1024 / 1024).toFixed(2)}</td></tr>`;
          }
          c.innerHTML = h + '</table>';
        } else {
          c.innerHTML = `<p>Error: ${d.error}</p>`;
        }
      } catch (e) {
        c.innerHTML = `<p>Error: ${e.message}</p>`;
      }
    }
  }

  window.GQTextureAdminUI = GQTextureAdminUI;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new GQTextureAdminUI());
  } else {
    new GQTextureAdminUI();
  }
})();
