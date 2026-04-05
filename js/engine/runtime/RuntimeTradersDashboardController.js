'use strict';

(function () {
  function createTradersDashboardController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || document;
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading...</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const esc = opts.esc || ((value) => String(value ?? ''));
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});

    class TradersDashboardController {
      constructor() {
        this.state = {
          status: null,
          traders: [],
          routes: [],
          opportunities: [],
        };
        this.isBusy = false;
      }

      async loadData() {
        const [statusRes, tradersRes, routesRes, oppRes] = await Promise.all([
          api.tradersStatus(),
          api.tradersList(),
          api.tradersRoutes(),
          api.traderOpportunities(15),
        ]);

        this.state.status = statusRes && statusRes.success ? statusRes : null;
        this.state.traders = (tradersRes && tradersRes.success && Array.isArray(tradersRes.traders)) ? tradersRes.traders : [];
        this.state.routes = (routesRes && routesRes.success && Array.isArray(routesRes.routes)) ? routesRes.routes : [];
        this.state.opportunities = (oppRes && oppRes.success && Array.isArray(oppRes.alerts)) ? oppRes.alerts : [];
      }

      async render() {
        const root = wm.body('traders');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();

        try {
          await this.loadData();
          root.innerHTML = this.renderDashboardHtml();
          this.attachEventListeners(root);
        } catch (err) {
          gameLog('warn', 'Trader dashboard laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Trader dashboard failed to load.</p>';
        }
      }

      renderDashboardHtml() {
        const status = this.state.status || {};
        const traders = this.state.traders;
        const routes = this.state.routes;
        const opportunities = this.state.opportunities;

        const summaryCards = [
          { label: 'Traders', value: Number(status.traders || traders.length || 0).toLocaleString('de-DE') },
          { label: 'Aktive Routen', value: Number(status.routes?.active || 0).toLocaleString('de-DE') },
          { label: 'Opportunities', value: Number(status.opportunities || opportunities.length || 0).toLocaleString('de-DE') },
          { label: 'Gesamtprofit', value: Number(status.total_profit || 0).toLocaleString('de-DE') + ' Cr' },
        ];

        const tradersRows = traders.slice(0, 8).map((trader) => {
          return `
            <tr>
              <td>${esc(trader.name || '-')}</td>
              <td>${esc(trader.faction_name || '-')}</td>
              <td>${Number(trader.capital_credits || 0).toLocaleString('de-DE')}</td>
              <td>${Number(trader.total_profit || 0).toLocaleString('de-DE')}</td>
              <td>${Number(trader.active_routes || 0).toLocaleString('de-DE')}/${Number(trader.max_fleets || 0).toLocaleString('de-DE')}</td>
              <td>${esc(trader.strategy || '-')}</td>
            </tr>
          `;
        }).join('');

        const routesRows = routes.slice(0, 10).map((route) => {
          return `
            <tr>
              <td>#${Number(route.id || 0)}</td>
              <td>${esc(route.trader_name || '-')}</td>
              <td>${esc(route.resource_type || '-')}</td>
              <td>${Number(route.quantity_acquired || route.quantity_planned || 0).toLocaleString('de-DE')}</td>
              <td>${esc(route.status || '-')}</td>
              <td>${Number(route.expected_profit || route.actual_profit || 0).toLocaleString('de-DE')}</td>
            </tr>
          `;
        }).join('');

        const opportunitiesRows = opportunities.slice(0, 10).map((opp) => {
          return `
            <tr>
              <td>${esc(opp.resource_type || '-')}</td>
              <td>S${Number(opp.source_system || 0)} -> S${Number(opp.target_system || 0)}</td>
              <td>${Number(opp.profit_margin || 0).toFixed(1)}%</td>
              <td>${Number(opp.actual_qty || 0).toLocaleString('de-DE')}</td>
              <td>${Math.round(Number(opp.confidence || 0) * 100)}%</td>
            </tr>
          `;
        }).join('');

        return `
          <div class="trader-dashboard" style="display:grid;gap:10px;">
            <section style="display:flex;gap:8px;flex-wrap:wrap;">
              ${summaryCards.map((card) => `
                <div style="flex:1 1 110px;min-width:110px;background:#1f2533;border:1px solid #3a4762;border-radius:8px;padding:10px;">
                  <div style="font-size:11px;color:#9fb0ce;">${esc(card.label)}</div>
                  <div style="font-size:18px;font-weight:700;color:#e3efff;">${esc(card.value)}</div>
                </div>
              `).join('')}
            </section>

            <section style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" data-traders-event="market_update">Market Update</button>
              <button class="btn" data-traders-event="opportunity_scan">Opportunity Scan</button>
              <button class="btn" data-traders-event="trader_decisions">Trader Decisions</button>
              <button class="btn" data-traders-event="route_process">Route Process</button>
              <button class="btn" data-traders-event="game_tick">Full Tick</button>
              <button class="btn" data-traders-refresh="1">Refresh</button>
            </section>

            <section style="display:grid;gap:10px;grid-template-columns:1fr;">
              <div style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;overflow:auto;">
                <div style="font-weight:700;margin-bottom:6px;">Trader</div>
                ${traders.length === 0
                  ? uiKitEmptyStateHTML('Keine Trader', 'Noch keine Traderdaten vorhanden.')
                  : `
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                      <thead>
                        <tr>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Name</th>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Fraktion</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Kapital</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Profit</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Flotten</th>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Strategie</th>
                        </tr>
                      </thead>
                      <tbody>${tradersRows}</tbody>
                    </table>
                  `}
              </div>

              <div style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;overflow:auto;">
                <div style="font-weight:700;margin-bottom:6px;">Routen</div>
                ${routes.length === 0
                  ? uiKitEmptyStateHTML('Keine Routen', 'Aktuell sind keine Trader-Routen vorhanden.')
                  : `
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                      <thead>
                        <tr>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">ID</th>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Trader</th>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Ressource</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Menge</th>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Status</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Profit</th>
                        </tr>
                      </thead>
                      <tbody>${routesRows}</tbody>
                    </table>
                  `}
              </div>

              <div style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;overflow:auto;">
                <div style="font-weight:700;margin-bottom:6px;">Top Opportunities</div>
                ${opportunities.length === 0
                  ? uiKitEmptyStateHTML('Keine Opportunities', 'Noch keine profitablen Routen gefunden.')
                  : `
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                      <thead>
                        <tr>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Ressource</th>
                          <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Route</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Marge</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Menge</th>
                          <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Konfidenz</th>
                        </tr>
                      </thead>
                      <tbody>${opportunitiesRows}</tbody>
                    </table>
                  `}
              </div>
            </section>
          </div>
        `;
      }

      attachEventListeners(root) {
        root.querySelector('[data-traders-refresh="1"]')?.addEventListener('click', async () => {
          await this.render();
        });

        root.querySelectorAll('[data-traders-event]').forEach((btn) => {
          btn.addEventListener('click', async (event) => {
            const actionBtn = event.currentTarget;
            const eventName = String(actionBtn?.dataset?.tradersEvent || '');
            if (!eventName || this.isBusy) return;

            this.isBusy = true;
            try {
              const response = await api.tradersEvent(eventName);
              invalidateGetCache([/api\/traders(\.php|_events\.php|_dashboard\.php)/i]);
              if (response && response.success) {
                showToast(`Trader-Event erfolgreich: ${eventName}`, 'success');
              } else {
                showToast(`Trader-Event fehlgeschlagen: ${eventName}`, 'warning');
              }
            } catch (err) {
              gameLog('warn', `Trader-Event fehlgeschlagen (${eventName})`, err);
              showToast(`Trader-Event fehlgeschlagen: ${eventName}`, 'error');
            } finally {
              this.isBusy = false;
              await this.render();
            }
          });
        });
      }
    }

    return new TradersDashboardController();
  }

  const api = { createTradersDashboardController };
  if (typeof window !== 'undefined') {
    window.GQRuntimeTradersDashboardController = api;
  }
})();
