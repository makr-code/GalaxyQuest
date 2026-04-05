'use strict';

(function () {
  function createPiratesController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || document;
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading...</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const esc = opts.esc || ((value) => String(value ?? ''));
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const invalidateGetCache = typeof opts.invalidateGetCache === 'function' ? opts.invalidateGetCache : (() => {});

    class PiratesController {
      constructor() {
        this.state = {
          status: null,
          raids: [],
          forecast: null,
          lastTickResult: null,
        };
        this.isBusy = false;
      }

      async loadData() {
        const [statusRes, raidsRes, forecastRes] = await Promise.all([
          api.piratesStatus(),
          api.piratesRecentRaids(20),
          api.piratesForecast(),
        ]);

        this.state.status = statusRes && statusRes.success ? statusRes : null;
        this.state.raids = (raidsRes && raidsRes.success && Array.isArray(raidsRes.raids)) ? raidsRes.raids : [];
        this.state.forecast = forecastRes && forecastRes.success ? forecastRes.forecast : null;
      }

      async render() {
        const root = wm.body('pirates');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();

        try {
          await this.loadData();
          root.innerHTML = this.renderHtml();
          this.attachEventListeners(root);
        } catch (err) {
          gameLog('warn', 'Pirates window load failed', err);
          root.innerHTML = '<p class="text-red">Failed to load pirate intel.</p>';
        }
      }

      renderHtml() {
        const status = this.state.status || { summary: {}, factions: [] };
        const summary = status.summary || {};
        const factions = Array.isArray(status.factions) ? status.factions : [];
        const raids = this.state.raids || [];
        const forecast = this.state.forecast || null;
        const lastTick = this.state.lastTickResult;

        const cards = [
          { label: 'Pirate Factions', value: Number(summary.pirate_factions || 0).toLocaleString('de-DE') },
          { label: 'High Threat', value: Number(summary.high_threat_factions || 0).toLocaleString('de-DE') },
          { label: 'Max Threat', value: Number(summary.max_threat_score || 0).toLocaleString('de-DE') },
          { label: 'Raids 24h', value: Number(summary.raids_last_24h || 0).toLocaleString('de-DE') },
        ];

        const factionRows = factions.map((faction) => `
          <tr>
            <td>${esc(faction.icon || '')} ${esc(faction.name || '-')}</td>
            <td>${Number(faction.standing || 0).toLocaleString('de-DE')}</td>
            <td>${Number(faction.aggression || 0).toLocaleString('de-DE')}</td>
            <td>${Number(faction.power_level || 0).toLocaleString('de-DE')}</td>
            <td>${Number(faction.threat_score || 0).toLocaleString('de-DE')}</td>
            <td>${esc(faction.threat_level || '-')}</td>
          </tr>
        `).join('');

        const raidRows = raids.slice(0, 12).map((raid) => {
          const body = String(raid.body || '');
          const preview = body.length > 120 ? `${body.slice(0, 120)}...` : body;
          return `
            <tr>
              <td>#${Number(raid.id || 0)}</td>
              <td>${esc(raid.sent_at || '-')}</td>
              <td>${esc(preview)}</td>
              <td>${Number(raid.is_read || 0) ? 'read' : 'new'}</td>
            </tr>
          `;
        }).join('');

        const forecastHtml = forecast
          ? `
            <div style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;">
              <div style="font-weight:700;margin-bottom:6px;">Risk Forecast</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
                <div><div style="font-size:11px;color:#9fb0ce;">Risk Index</div><div style="font-size:18px;font-weight:700;">${Number(forecast.risk_index || 0).toLocaleString('de-DE')}</div></div>
                <div><div style="font-size:11px;color:#9fb0ce;">Risk Level</div><div style="font-size:18px;font-weight:700;">${esc(forecast.risk_level || '-')}</div></div>
                <div><div style="font-size:11px;color:#9fb0ce;">Raids 24h</div><div style="font-size:18px;font-weight:700;">${Number(forecast.raids_last_24h || 0).toLocaleString('de-DE')}</div></div>
              </div>
              <p style="margin:8px 0 0;color:#d7e4ff;">${esc(forecast.recommended_action || '')}</p>
            </div>
          `
          : uiKitEmptyStateHTML('No forecast data', 'Forecast endpoint returned no data.');

        const tickResultHtml = lastTick
          ? `
            <div style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;">
              <div style="font-weight:700;margin-bottom:6px;">Last Tick Result</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
                <div><div style="font-size:11px;color:#9fb0ce;">Processed</div><div style="font-size:16px;font-weight:700;">${Number(lastTick.factionsProcessed || 0).toLocaleString('de-DE')}</div></div>
                <div><div style="font-size:11px;color:#9fb0ce;">New Raids (24h)</div><div style="font-size:16px;font-weight:700;">${Number(lastTick.newRaidsDelta || 0).toLocaleString('de-DE')}</div></div>
                <div><div style="font-size:11px;color:#9fb0ce;">Duration</div><div style="font-size:16px;font-weight:700;">${Number(lastTick.durationMs || 0).toLocaleString('de-DE')} ms</div></div>
                <div><div style="font-size:11px;color:#9fb0ce;">At</div><div style="font-size:16px;font-weight:700;">${esc(lastTick.at || '-')}</div></div>
              </div>
            </div>
          `
          : '';

        return `
          <div class="pirates-dashboard" style="display:grid;gap:10px;">
            <section style="display:flex;gap:8px;flex-wrap:wrap;">
              ${cards.map((card) => `
                <div style="flex:1 1 110px;min-width:110px;background:#1f2533;border:1px solid #3a4762;border-radius:8px;padding:10px;">
                  <div style="font-size:11px;color:#9fb0ce;">${esc(card.label)}</div>
                  <div style="font-size:18px;font-weight:700;color:#e3efff;">${esc(card.value)}</div>
                </div>
              `).join('')}
            </section>

            <section style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" data-pirates-run="1">Run Pirate Tick</button>
              <button class="btn" data-pirates-refresh="1">Refresh</button>
            </section>

            ${tickResultHtml}

            ${forecastHtml}

            <section style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;overflow:auto;">
              <div style="font-weight:700;margin-bottom:6px;">Pirate Factions</div>
              ${factions.length === 0
                ? uiKitEmptyStateHTML('No pirate factions', 'No pirate factions found in npc_factions.')
                : `
                  <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead>
                      <tr>
                        <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Faction</th>
                        <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Standing</th>
                        <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Aggression</th>
                        <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Power</th>
                        <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Threat</th>
                        <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Level</th>
                      </tr>
                    </thead>
                    <tbody>${factionRows}</tbody>
                  </table>
                `}
            </section>

            <section style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;overflow:auto;">
              <div style="font-weight:700;margin-bottom:6px;">Recent Pirate Raids</div>
              ${raids.length === 0
                ? uiKitEmptyStateHTML('No raids', 'No pirate raid messages for this commander.')
                : `
                  <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead>
                      <tr>
                        <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">ID</th>
                        <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Timestamp</th>
                        <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Message</th>
                        <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">State</th>
                      </tr>
                    </thead>
                    <tbody>${raidRows}</tbody>
                  </table>
                `}
            </section>
          </div>
        `;
      }

      attachEventListeners(root) {
        root.querySelector('[data-pirates-refresh="1"]')?.addEventListener('click', async () => {
          await this.render();
        });

        root.querySelector('[data-pirates-run="1"]')?.addEventListener('click', async () => {
          if (this.isBusy) return;
          this.isBusy = true;
          try {
            const startedAt = Date.now();
            const tickRes = await api.piratesRunTick();
            const finishedAt = Date.now();

            this.state.lastTickResult = {
              factionsProcessed: Number(tickRes?.factions_processed || 0),
              newRaidsDelta: Number(tickRes?.new_raids_last_24h_delta || 0),
              durationMs: Math.max(0, finishedAt - startedAt),
              at: new Date(finishedAt).toLocaleString('de-DE'),
            };

            invalidateGetCache([/api\/pirates\.php\?action=/i, /api\/npc_controller\.php\?action=/i]);
            showToast(`Pirate simulation tick executed (${this.state.lastTickResult.factionsProcessed} factions).`, 'success');
          } catch (err) {
            gameLog('warn', 'Pirate tick failed', err);
            showToast('Pirate simulation tick failed.', 'error');
          } finally {
            this.isBusy = false;
            await this.render();
          }
        });
      }
    }

    return new PiratesController();
  }

  const api = { createPiratesController };
  if (typeof window !== 'undefined') {
    window.GQRuntimePiratesController = api;
  }
})();
