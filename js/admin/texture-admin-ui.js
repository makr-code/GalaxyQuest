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

    renderMessage(container, text) {
      const message = document.createElement('p');
      message.textContent = text;
      container.replaceChildren(message);
    }

    switchTab(tab) {
      this.container.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      this.container.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      this.container.querySelector(`#${tab}`).classList.add('active');
      this.container.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    }

    async postWithCsrf(endpoint, body) {
      const csrfResponse = await fetch('api/auth.php?action=csrf', {
        credentials: 'same-origin',
      });
      if (!csrfResponse.ok) {
        throw new Error(`CSRF token request failed (${csrfResponse.status})`);
      }
      const csrfData = await csrfResponse.json();
      if (typeof csrfData.token !== 'string' || csrfData.token.length === 0) {
        throw new Error('CSRF token missing from response');
      }

      return fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfData.token,
        },
        body: JSON.stringify(body),
      });
    }

    postAdminAction(action, body) {
      return this.postWithCsrf(`api/textures-admin.php?action=${encodeURIComponent(action)}`, body);
    }

    async loadCacheList() {
      const container = this.container.querySelector('#cache-list-container');
      this.renderMessage(container, 'Loading...');
      try {
        const res = await fetch('api/textures-admin.php?action=list');
        const data = await res.json();
        if (data.success && data.textures.length > 0) {
          const table = document.createElement('table');
          const header = document.createElement('tr');
          for (const label of ['Type', 'Cache Key', 'Size', 'Actions']) {
            const cell = document.createElement('th');
            cell.textContent = label;
            header.appendChild(cell);
          }
          table.appendChild(header);
          data.textures.forEach((texture) => {
            const row = document.createElement('tr');
            const type = document.createElement('td');
            type.textContent = String(texture.type ?? '');
            const key = document.createElement('td');
            const code = document.createElement('code');
            code.textContent = String(texture.cache_key ?? '').substring(0, 16);
            key.appendChild(code);
            const size = document.createElement('td');
            size.textContent = `${(texture.size_bytes / 1024).toFixed(1)} KB`;
            const actions = document.createElement('td');
            const regenerate = document.createElement('button');
            regenerate.className = 'btn-regen';
            regenerate.dataset.cacheKey = String(texture.cache_key ?? '');
            regenerate.textContent = 'Regenerate';
            regenerate.addEventListener('click', () => this.regenTexture(regenerate.dataset.cacheKey));
            actions.appendChild(regenerate);
            row.append(type, key, size, actions);
            table.appendChild(row);
          });
          container.replaceChildren(table);
        } else {
          this.renderMessage(container, 'No textures cached.');
        }
      } catch (e) {
        this.renderMessage(container, `Error: ${e.message}`);
      }
    }

    async regenTexture(key) {
      if (!confirm('Regenerate?')) return;
      try {
        const res = await this.postAdminAction('regenerate', { cache_key: key, force: 1 });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Regeneration request failed (${res.status})`);
        }
        if (data.request?.method !== 'POST' || typeof data.request.url !== 'string') {
          throw new Error('Regeneration request is missing.');
        }
        const generationResponse = await this.postWithCsrf(data.request.url, data.request.body || {});
        const generation = await generationResponse.json();
        if (!generationResponse.ok || !generation.success) {
          throw new Error(generation.error || `Texture generation failed (${generationResponse.status})`);
        }
        alert('Regenerated');
        this.loadCacheList();
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async handleTestPrompt(e) {
      e.preventDefault();
      const res = this.container.querySelector('#test-result');
      this.renderMessage(res, 'Generating...');
      try {
        const r = await this.postAdminAction('test_prompt', {
          prompt: this.container.querySelector('#positive-prompt').value,
          negative_prompt: this.container.querySelector('#negative-prompt').value,
          size: this.container.querySelector('#test-size').value,
          steps: 30,
        });
        const d = await r.json();
        const message = document.createElement('p');
        message.textContent = d.success ? `Submitted! ID: ${d.prompt_id}` : `Error: ${d.error}`;
        res.replaceChildren(message);
      } catch (err) {
        this.renderMessage(res, `Error: ${err.message}`);
      }
      return false;
    }

    async dryRunBatch() {
      const res = this.container.querySelector('#batch-result');
      this.renderMessage(res, 'Analyzing...');
      const faction = this.container.querySelector('#batch-faction').value;
      const type = this.container.querySelector('#batch-type').value;
      try {
        const r = await this.postAdminAction('batch_regenerate', {
          faction,
          texture_type: type,
          dry_run: 1,
        });
        const d = await r.json();
        const message = document.createElement('p');
        message.textContent = d.success ? `Would affect ${d.count} texture(s)` : `Error: ${d.error}`;
        res.replaceChildren(message);
      } catch (e) {
        this.renderMessage(res, `Error: ${e.message}`);
      }
    }

    async executeBatch() {
      if (!confirm('Delete and regenerate?')) return;
      const res = this.container.querySelector('#batch-result');
      this.renderMessage(res, 'Executing...');
      const faction = this.container.querySelector('#batch-faction').value;
      const type = this.container.querySelector('#batch-type').value;
      try {
        const r = await this.postAdminAction('batch_regenerate', {
          faction,
          texture_type: type,
          dry_run: 0,
        });
        const d = await r.json();
        const message = document.createElement('p');
        message.textContent = d.success ? `Deleted ${d.deleted} texture(s)` : `Error: ${d.error}`;
        res.replaceChildren(message);
      } catch (e) {
        this.renderMessage(res, `Error: ${e.message}`);
      }
    }

    showClearDialog() {
      if (!confirm('Clear ALL cache?')) return;
      const pwd = prompt('Type "yes_clear_all":');
      if (pwd === 'yes_clear_all') this.clearCache();
    }

    async clearCache() {
      try {
        const r = await this.postAdminAction('clear_cache', { confirm: 'yes_clear_all' });
        const d = await r.json();
        alert(d.success ? `Deleted ${d.deleted} files` : d.error);
        this.loadCacheList();
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async loadStats() {
      const c = this.container.querySelector('#stats-container');
      this.renderMessage(c, 'Loading...');
      try {
        const r = await fetch('api/textures-admin.php?action=cache_stats');
        const d = await r.json();
        if (d.success) {
          const summary = document.createElement('p');
          summary.textContent = `Total: ${d.stats.total_textures} textures, ${d.stats.total_size_mb} MB`;
          const table = document.createElement('table');
          const header = document.createElement('tr');
          for (const label of ['Type', 'Count', 'Size MB']) {
            const cell = document.createElement('th');
            cell.textContent = label;
            header.appendChild(cell);
          }
          table.appendChild(header);
          for (const [t, i] of Object.entries(d.stats.by_type)) {
            const row = document.createElement('tr');
            const type = document.createElement('td');
            type.textContent = t;
            const count = document.createElement('td');
            count.textContent = String(i.count);
            const size = document.createElement('td');
            size.textContent = (i.size / 1024 / 1024).toFixed(2);
            row.append(type, count, size);
            table.appendChild(row);
          }
          c.replaceChildren(summary, table);
        } else {
          const message = document.createElement('p');
          message.textContent = `Error: ${d.error}`;
          c.replaceChildren(message);
        }
      } catch (e) {
        this.renderMessage(c, `Error: ${e.message}`);
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
