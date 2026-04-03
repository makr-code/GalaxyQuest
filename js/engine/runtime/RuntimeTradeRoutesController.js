'use strict';
(function () {
  function createTradeRoutesController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || document;
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading...</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const esc = opts.esc || ((value) => String(value ?? ''));
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});
    const getResourceInsightConfig = typeof opts.getResourceInsightConfig === 'function' ? opts.getResourceInsightConfig : (() => null);
    const getSuggestedTradeAmount = typeof opts.getSuggestedTradeAmount === 'function' ? opts.getSuggestedTradeAmount : (() => 0);
    const getCurrentColony = typeof opts.getCurrentColony === 'function' ? opts.getCurrentColony : (() => null);

    class TradeRoutesController {
      constructor() {
        this.routes = [];
      }

      async render() {
        const root = wm.body('trade-routes');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();

        let data;
        try {
          data = await api.tradeRoutes();
        } catch (err) {
          gameLog('warn', 'Trade routes laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to load trade routes.</p>';
          return;
        }
        this.routes = data.trade_routes || [];

        let html = '<div class="trade-routes-list">';

        if (this.routes.length === 0) {
          html += uiKitEmptyStateHTML('No trade routes yet', 'Create your first automated route between two colonies.');
        } else {
          html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px;">';
          for (const route of this.routes) {
            html += this.renderRouteCard(route);
          }
          html += '</div>';
        }

        html += '<div style="margin-top: 12px; padding: 8px; border-top: 1px solid #555;">';
        html += '<button id="btn-create-route" class="btn" style="width: 100%;">New Trade Route</button>';
        html += '</div>';
        html += '</div>';

        root.innerHTML = html;
        this.attachEventListeners();
      }

      renderRouteCard(route) {
        const routeId = route.id;
        const intervalHours = Number(route.interval_hours || 24);
        const isDue = !!route.is_due;

        let nextExecProgressPct = isDue ? 100 : 0;
        let nextExecTone = 'is-good';
        let nextExecHtml = '';

        if (route.next_execution_at || route.last_execution_at) {
          const nextExecTime = route.next_execution_at ? new Date(route.next_execution_at).getTime() : null;
          const lastExecTime = route.last_execution_at ? new Date(route.last_execution_at).getTime() : null;
          const now = Date.now();

          if (nextExecTime) {
            const intervalMs = intervalHours * 3600000;
            const timeUntilNextMs = Math.max(0, nextExecTime - now);
            nextExecProgressPct = Math.min(100, Math.round((1 - (timeUntilNextMs / intervalMs)) * 100));
          } else if (lastExecTime) {
            const intervalMs = intervalHours * 3600000;
            const timeSinceLastMs = now - lastExecTime;
            nextExecProgressPct = Math.min(100, Math.round((timeSinceLastMs / intervalMs) * 100));
          }

          nextExecTone = nextExecProgressPct < 30 ? 'is-good' : (nextExecProgressPct < 70 ? 'is-warning' : 'is-critical');
          nextExecHtml = `<div class="entity-bars" style="margin-top:0.4rem;">
            <div class="entity-bar-row" title="Next execution in ${intervalHours - Math.floor(nextExecProgressPct / 100 * intervalHours)}h">
              <span class="entity-bar-label" style="font-size:0.75rem;">Next</span>
              <div class="bar-wrap"><div class="bar-fill bar-integrity ${nextExecTone}" style="width:${nextExecProgressPct}%"></div></div>
              <span class="entity-bar-value" style="font-size:0.75rem;">${nextExecProgressPct}%</span>
            </div>
          </div>`;
        }

        return `
          <div class="route-card" style="padding: 8px; border: 1px solid #777; border-radius: 4px; background: #1a1a1a;">
            <div style="font-weight: bold; margin-bottom: 4px;">
              ${esc(route.origin_name)} -> ${esc(route.target_name)}
            </div>
            <div style="font-size: 0.85em; color: #ccc; margin-bottom: 4px;">
              <span style="color: #ffa500;">${(route.cargo.metal || 0).toLocaleString()}</span> M
              <span style="color: #00ff00;">${(route.cargo.crystal || 0).toLocaleString()}</span> K
              <span style="color: #00ccff;">${(route.cargo.deuterium || 0).toLocaleString()}</span> D
            </div>
            <div style="font-size: 0.8em; color: #aaa; margin-bottom: 6px;">
              Interval: ${route.interval_hours}h
              ${route.is_due ? ' <span style="color: #f00;">[DUE NOW]</span>' : ''}
              ${!route.is_active ? ' <span style="color: #f80;">[PAUSED]</span>' : ''}
            </div>
            ${nextExecHtml}
            <div style="display: flex; gap: 4px; margin-top:6px;">
              <button data-toggle-route="${routeId}" class="btn" style="flex: 1; padding: 4px;">
                ${route.is_active ? 'Pause' : 'Resume'}
              </button>
              <button data-delete-route="${routeId}" class="btn" style="flex: 1; padding: 4px; color: #f55;">Delete</button>
            </div>
          </div>
        `;
      }

      attachEventListeners() {
        documentRef.getElementById('btn-create-route')?.addEventListener('click', () => this.showCreateDialog());

        documentRef.querySelectorAll('[data-toggle-route]').forEach((btn) => {
          btn.addEventListener('click', async (event) => {
            const routeId = parseInt(event.currentTarget?.dataset?.toggleRoute || '0', 10);
            if (!routeId) return;
            await api.toggleTradeRoute(routeId);
            invalidateGetCache([/api\/trade\.php/i]);
            await this.render();
          });
        });

        documentRef.querySelectorAll('[data-delete-route]').forEach((btn) => {
          btn.addEventListener('click', async (event) => {
            if (!confirm('Delete this trade route?')) return;
            const routeId = parseInt(event.currentTarget?.dataset?.deleteRoute || '0', 10);
            if (!routeId) return;
            await api.deleteTradeRoute(routeId);
            invalidateGetCache([/api\/trade\.php/i]);
            await this.render();
          });
        });
      }

      showCreateDialog(options = {}) {
        const config = getResourceInsightConfig(options.resourceKey);
        const focusedCargo = { metal: 0, crystal: 0, deuterium: 0 };
        if (config?.tradeable) {
          focusedCargo[config.key] = getSuggestedTradeAmount(config.key, 'offer');
        }
        const currentColony = getCurrentColony();
        const dialog = documentRef.createElement('div');
        dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #222; border: 2px solid #777; border-radius: 4px; padding: 16px; z-index: 10000; width: 90%; max-width: 400px;';
        dialog.innerHTML = `
          <h3 style="margin-top: 0;">Create Trade Route</h3>
          <p style="color: #aaa; font-size: 0.9em;">${config ? `${esc(config.icon)} ${esc(config.label)} fokussiert. ` : ''}Routen starten echte Frachter, binden Fracht an Flugzeit und verbrauchen Deuterium fuer den Transport.</p>
          <p style="color: #aaa; font-size: 0.85em;">This feature requires clicking on colonies to select. You can also use the command line API:</p>
          <code style="display: block; background: #1a1a1a; padding: 8px; border-radius: 2px; margin: 8px 0; font-size: 0.8em; word-break: break-all;">
            await API.createTradeRoute({ origin_colony_id: ${Number(currentColony?.id || 1)}, target_colony_id: 2, cargo_metal: ${Math.round(focusedCargo.metal || 1000)}, cargo_crystal: ${Math.round(focusedCargo.crystal || 500)}, cargo_deuterium: ${Math.round(focusedCargo.deuterium || 100)}, interval_hours: 24 })
          </code>
          <button class="btn" data-close-route-dialog="1" style="width: 100%;">Close</button>
        `;
        documentRef.body.appendChild(dialog);
        dialog.querySelector('[data-close-route-dialog="1"]')?.addEventListener('click', () => dialog.remove());
      }
    }

    return new TradeRoutesController();
  }

  const api = { createTradeRoutesController };
  if (typeof window !== 'undefined') {
    window.GQRuntimeTradeRoutesController = api;
  }
})();
