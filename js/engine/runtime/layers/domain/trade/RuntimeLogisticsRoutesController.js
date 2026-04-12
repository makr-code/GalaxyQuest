'use strict';
/**
 * RuntimeLogisticsRoutesController.js
 *
 * Colony Goods Flow & Logistics Routes Dashboard (Sprint 2.5).
 *
 * Tabs:
 *   • Flows       — per-colony surplus/deficit heatmap per resource
 *   • Routes      — existing trade routes with efficiency metrics
 *   • Recommend   — AI-style route recommendations to balance goods flow
 */
(function () {
  const RESOURCE_ICONS = {
    metal: '⛏',
    crystal: '💎',
    deuterium: '⚗',
    rare_earth: '🪨',
    food: '🌾',
    steel_alloy: '⚙',
    focus_crystals: '🔷',
    reactor_fuel: '🔋',
    consumer_goods: '🛒',
    luxury_goods: '✨',
    military_hardware: '🔫',
    advanced_components: '🔬',
    research_kits: '🧪',
    colony_supplies: '📦',
    biocompost: '🌿',
  };

  const TONE_CLASS = {
    surplus: 'is-good',
    deficit: 'is-critical',
    balanced: 'is-warning',
  };

  const PRIORITY_CLASS = {
    critical: 'is-critical',
    high: 'is-warning',
    normal: '',
  };

  function createLogisticsRoutesController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || (typeof document !== 'undefined' ? document : null);
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading...</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const esc = opts.esc || ((v) => String(v ?? ''));
    const fmt = opts.fmt || ((v) => String(v ?? 0));
    const fmtName = opts.fmtName || ((v) => String(v ?? ''));
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});

    class LogisticsRoutesController {
      constructor() {
        this.tab = 'flows';
        this.data = null;
        this.intervalHours = 24;
      }

      // ── Rendering ─────────────────────────────────────────────────────────

      async render() {
        const root = wm ? wm.body('logistics-routes') : null;
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();

        let data;
        try {
          data = await api.goodsFlowAnalysis({ limit: 10, interval_hours: this.intervalHours });
        } catch (err) {
          gameLog('warn', 'Logistics routes laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to load logistics data.</p>';
          return;
        }

        this.data = data;
        root.innerHTML = this._buildHtml(data);
        this._bindEvents(root);
      }

      _buildHtml(data) {
        if (!data) return '<p class="text-muted">No data.</p>';

        const tabFlows = this.tab === 'flows' ? ' logistics-tab--active' : '';
        const tabRoutes = this.tab === 'routes' ? ' logistics-tab--active' : '';
        const tabRecommend = this.tab === 'recommend' ? ' logistics-tab--active' : '';

        const summary = data.summary || {};
        const colonies = Array.isArray(data.colonies) ? data.colonies : [];
        const routes = Array.isArray(data.routes) ? data.routes : [];
        const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];

        let bodyHtml = '';
        if (this.tab === 'flows') {
          bodyHtml = this._buildFlowsTab(colonies, data.heatmap || {});
        } else if (this.tab === 'routes') {
          bodyHtml = this._buildRoutesTab(routes);
        } else {
          bodyHtml = this._buildRecommendTab(recommendations);
        }

        return `
<div class="logistics-routes-panel">
  <div class="logistics-summary-bar">
    <span class="logistics-stat"><strong>${esc(String(summary.total_colonies || 0))}</strong> Colonies</span>
    <span class="logistics-stat"><strong>${esc(String(summary.active_routes || 0))}</strong> Active Routes</span>
    <span class="logistics-interval">
      Interval:
      <select class="logistics-interval-select" data-logistics-interval>
        ${[6, 12, 24, 48, 72].map((h) => `<option value="${h}"${h === this.intervalHours ? ' selected' : ''}>${h}h</option>`).join('')}
      </select>
    </span>
  </div>
  <div class="logistics-tabs">
    <button class="logistics-tab${tabFlows}" data-logistics-tab="flows">📊 Flows</button>
    <button class="logistics-tab${tabRoutes}" data-logistics-tab="routes">🗺 Routes</button>
    <button class="logistics-tab${tabRecommend}" data-logistics-tab="recommend">💡 Recommendations</button>
  </div>
  <div class="logistics-tab-content">${bodyHtml}</div>
</div>`;
      }

      // ── Flows tab: per-resource heatmap grid ───────────────────────────────

      _buildFlowsTab(colonies, heatmap) {
        if (colonies.length === 0) {
          return uiKitEmptyStateHTML('No colonies', 'Found no colony data for goods flow analysis.');
        }

        // Collect all resources that have any flow data
        const resources = new Set();
        colonies.forEach((c) => {
          if (c.goods) Object.keys(c.goods).forEach((r) => resources.add(r));
        });

        if (resources.size === 0) {
          return '<p class="text-muted">No resource data available.</p>';
        }

        let html = '<div class="logistics-flows-grid">';

        for (const resource of resources) {
          const icon = RESOURCE_ICONS[resource] || '▣';
          const label = fmtName(resource);

          // Per-colony flow rows
          const rows = colonies
            .map((c) => {
              const g = c.goods?.[resource];
              if (!g) return null;
              return { colony: c, g };
            })
            .filter(Boolean)
            .sort((a, b) => b.g.surplus - a.g.surplus || a.g.deficit - b.g.deficit);

          const maxSurplus = Math.max(...rows.map((r) => r.g.surplus), 1);
          const maxDeficit = Math.max(...rows.map((r) => r.g.deficit), 1);

          // Route heatmap links for this resource
          const links = Array.isArray(heatmap[resource]) ? heatmap[resource] : [];

          html += `
<div class="logistics-resource-block">
  <div class="logistics-resource-header">
    <span class="logistics-resource-icon">${esc(icon)}</span>
    <span class="logistics-resource-name">${esc(label)}</span>
    ${links.length > 0 ? `<span class="logistics-route-badge">${links.length} route${links.length !== 1 ? 's' : ''}</span>` : ''}
  </div>
  <div class="logistics-colony-rows">`;

          rows.forEach(({ colony, g }) => {
            const surplusBar = Math.round((g.surplus / maxSurplus) * 100);
            const deficitBar = Math.round((g.deficit / maxDeficit) * 100);
            const tone = TONE_CLASS[g.tone] || '';
            html += `
  <div class="logistics-colony-row ${esc(tone)}" data-colony-id="${esc(String(colony.colony_id))}">
    <span class="logistics-colony-name">${esc(colony.name)}</span>
    <span class="logistics-qty">${esc(fmt(g.qty))}</span>
    <div class="logistics-bars">
      <div class="logistics-bar-surplus" style="width:${surplusBar}%" title="Surplus ${g.surplus}"></div>
      <div class="logistics-bar-deficit" style="width:${deficitBar}%" title="Deficit ${g.deficit}"></div>
    </div>
    <span class="logistics-balance ${esc(tone)}">
      ${g.surplus > 0 ? `+${esc(fmt(g.surplus))}` : g.deficit > 0 ? `-${esc(fmt(g.deficit))}` : '≈'}
    </span>
  </div>`;
          });

          html += '</div>';

          // Active route links
          if (links.length > 0) {
            html += '<div class="logistics-route-links">';
            links.forEach((link) => {
              const activeClass = link.is_active ? 'is-good' : 'is-muted';
              html += `<span class="logistics-route-link ${esc(activeClass)}">${esc(link.from_name)} → ${esc(link.to_name)}: ${esc(fmt(link.qty))}</span>`;
            });
            html += '</div>';
          }

          html += '</div>';
        }

        html += '</div>';
        return html;
      }

      // ── Routes tab: existing routes + efficiency ───────────────────────────

      _buildRoutesTab(routes) {
        if (routes.length === 0) {
          return uiKitEmptyStateHTML('No trade routes', 'Set up trade routes to see logistics efficiency metrics here.');
        }

        let html = '<div class="logistics-routes-list">';
        routes.forEach((route) => {
          const statusClass = route.is_active ? 'is-good' : 'is-muted';
          const statusLabel = route.is_active ? 'Active' : 'Paused';
          const effClass = route.efficiency_score >= 50 ? 'is-good' : route.efficiency_score >= 10 ? 'is-warning' : 'is-critical';

          // Build cargo summary
          const cargoParts = [];
          if (route.cargo_payload) {
            Object.entries(route.cargo_payload).forEach(([res, qty]) => {
              if (qty > 0) {
                const icon = RESOURCE_ICONS[res] || '▣';
                cargoParts.push(`${icon} ${esc(fmt(qty))} ${esc(fmtName(res))}`);
              }
            });
          }

          html += `
<div class="logistics-route-card">
  <div class="logistics-route-header">
    <span class="logistics-route-path">${esc(route.origin_name)} → ${esc(route.target_name)}</span>
    <span class="logistics-route-status ${esc(statusClass)}">${esc(statusLabel)}</span>
  </div>
  <div class="logistics-route-details">
    <div class="logistics-route-stat">
      <span class="logistics-stat-label">Distance</span>
      <span class="logistics-stat-value">${esc(fmt(route.distance_ly))} ly</span>
    </div>
    <div class="logistics-route-stat">
      <span class="logistics-stat-label">Fuel Cost</span>
      <span class="logistics-stat-value">${esc(fmt(route.fuel_cost_deuterium))} D</span>
    </div>
    <div class="logistics-route-stat">
      <span class="logistics-stat-label">Interval</span>
      <span class="logistics-stat-value">${esc(String(route.interval_hours))}h</span>
    </div>
    <div class="logistics-route-stat">
      <span class="logistics-stat-label">Efficiency</span>
      <span class="logistics-stat-value ${esc(effClass)}">${esc(fmt(route.efficiency_score))}</span>
    </div>
  </div>
  ${cargoParts.length > 0 ? `<div class="logistics-route-cargo">${cargoParts.join(', ')}</div>` : ''}
</div>`;
        });

        html += '</div>';
        return html;
      }

      // ── Recommendations tab: AI suggestions ────────────────────────────────

      _buildRecommendTab(recommendations) {
        if (recommendations.length === 0) {
          return uiKitEmptyStateHTML('All balanced', 'No rebalancing routes recommended — your empire\'s goods flow looks healthy.');
        }

        let html = '<div class="logistics-recommend-list">';
        html += '<p class="logistics-recommend-intro">Recommended routes based on surplus/deficit analysis:</p>';

        recommendations.forEach((rec) => {
          const prioClass = PRIORITY_CLASS[rec.priority] || '';
          const icon = RESOURCE_ICONS[rec.resource_type] || '▣';
          const cargoParts = Object.entries(rec.cargo || {})
            .filter(([, qty]) => qty > 0)
            .map(([res, qty]) => `${RESOURCE_ICONS[res] || '▣'} ${esc(fmt(qty))} ${esc(fmtName(res))}`);

          const detailsHtml = rec.reason_details
            ? `<div class="logistics-rec-details">
                <span>Source: ${esc(fmt(rec.reason_details.source_qty))} (reserve ${esc(fmt(rec.reason_details.source_reserve))})</span>
                <span>Target: ${esc(fmt(rec.reason_details.target_qty))} (needs ${esc(fmt(rec.reason_details.target_reserve))})</span>
              </div>`
            : '';

          html += `
<div class="logistics-rec-card ${esc(prioClass)}" data-rec-origin="${esc(String(rec.origin_colony_id || 0))}" data-rec-target="${esc(String(rec.target_colony_id || 0))}">
  <div class="logistics-rec-header">
    <span class="logistics-rec-resource">${esc(icon)} ${esc(fmtName(rec.resource_type))}</span>
    <span class="logistics-rec-priority ${esc(prioClass)}">${esc(rec.priority || 'normal')}</span>
  </div>
  <div class="logistics-rec-path">${esc(rec.origin_name)} → ${esc(rec.target_name)}</div>
  <div class="logistics-rec-cargo">${cargoParts.join(', ')}</div>
  ${detailsHtml}
  <div class="logistics-rec-meta">
    <span>Distance: ${esc(fmt(rec.estimated_distance_ly))} ly</span>
    <span>Fuel: ${esc(fmt(rec.estimated_fuel_cost_deuterium))} D</span>
    <span>Interval: ${esc(String(rec.interval_hours || 24))}h</span>
    <span>Reason: ${esc(rec.reason || '')}</span>
  </div>
  <div class="logistics-rec-actions">
    ${rec.existing_route_id
      ? `<button class="btn btn-sm logistics-btn-apply" data-apply-rec>Update Existing Route</button>`
      : `<button class="btn btn-sm logistics-btn-apply" data-apply-rec>Create Route</button>`}
  </div>
</div>`;
        });

        html += '</div>';
        return html;
      }

      // ── Event binding ──────────────────────────────────────────────────────

      _bindEvents(root) {
        // Tab switching
        root.querySelectorAll('[data-logistics-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.tab = btn.dataset.logisticsTab;
            this.render();
          });
        });

        // Interval selector
        const intervalSelect = root.querySelector('[data-logistics-interval]');
        if (intervalSelect) {
          intervalSelect.addEventListener('change', () => {
            this.intervalHours = Number(intervalSelect.value) || 24;
            this.data = null;
            this.render();
          });
        }

        // Apply recommendation
        root.querySelectorAll('[data-apply-rec]').forEach((btn) => {
          const card = btn.closest('[data-rec-origin]');
          if (!card) return;
          btn.addEventListener('click', async () => {
            const originId = Number(card.dataset.recOrigin || 0);
            const targetId = Number(card.dataset.recTarget || 0);
            if (!originId || !targetId) return;

            const recs = Array.isArray(this.data?.recommendations) ? this.data.recommendations : [];
            const rec = recs.find(
              (r) => Number(r.origin_colony_id) === originId && Number(r.target_colony_id) === targetId,
            );
            if (!rec) return;

            btn.disabled = true;
            btn.textContent = 'Applying…';
            try {
              await api.applyTradeSuggestion({
                origin_colony_id: originId,
                target_colony_id: targetId,
                interval_hours: rec.interval_hours || this.intervalHours,
                cargo: rec.cargo,
              });
              invalidateGetCache('api/trade.php?action=list');
              showToast('Route applied!', 'success');
              this.data = null;
              await this.render();
            } catch (err) {
              gameLog('warn', 'Apply logistics recommendation fehlgeschlagen', err);
              showToast('Failed to apply route.', 'error');
              btn.disabled = false;
              btn.textContent = rec.existing_route_id ? 'Update Existing Route' : 'Create Route';
            }
          });
        });
      }
    }

    return new LogisticsRoutesController();
  }

  const api = { createLogisticsRoutesController };

  if (typeof window !== 'undefined') {
    window.GQRuntimeLogisticsRoutesController = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
