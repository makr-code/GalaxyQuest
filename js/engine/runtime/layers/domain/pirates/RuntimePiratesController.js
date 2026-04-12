'use strict';

(function () {
  function createPiratesController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
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
          contracts: [],
          lastTickResult: null,
        };
        this.isBusy = false;
      }

      async loadData() {
        const [statusRes, raidsRes, forecastRes, contractsRes] = await Promise.all([
          api.piratesStatus(),
          api.piratesRecentRaids(20),
          api.piratesForecast(),
          api.piratesContracts ? api.piratesContracts() : Promise.resolve({ success: true, contracts: [] }),
        ]);

        this.state.status = statusRes && statusRes.success ? statusRes : null;
        this.state.raids = (raidsRes && raidsRes.success && Array.isArray(raidsRes.raids)) ? raidsRes.raids : [];
        this.state.forecast = forecastRes && forecastRes.success ? forecastRes.forecast : null;
        this.state.contracts = (contractsRes && contractsRes.success && Array.isArray(contractsRes.contracts)) ? contractsRes.contracts : [];
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
        const contracts = this.state.contracts || [];
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

        const contractRows = contracts.map((c) => `
          <tr>
            <td>${esc(c.faction_icon || '')} ${esc(c.faction_name || '?')}</td>
            <td>${esc(c.contract_type || '-')}</td>
            <td style="text-align:right;">${Number(c.credit_payment || 0).toLocaleString('de-DE')}</td>
            <td>${esc((c.expires_at || '').slice(0, 10))}</td>
          </tr>
        `).join('');

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

            <section style="background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:10px;overflow:auto;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div style="font-weight:700;">Active Contracts</div>
                <button style="background:#2e374e;border:1px solid #4a5878;color:#d7e4ff;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;" data-pirates-propose-contract="1">+ Propose</button>
              </div>
              ${contracts.length === 0
                ? '<p style="color:#9fb0ce;font-size:12px;">No active contracts. Use + Propose to set up a tributary or non-aggression pact.</p>'
                : `<table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr>
                      <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Faction</th>
                      <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Type</th>
                      <th style="text-align:right;padding:4px;border-bottom:1px solid #3a4762;">Credits</th>
                      <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Expires</th>
                    </tr></thead>
                    <tbody>${contractRows}</tbody>
                  </table>`}
              <div data-contract-form-host style="display:none;margin-top:10px;"></div>
            </section>
          </div>
        `;
      }

      attachEventListeners(root) {
        root.querySelector('[data-pirates-refresh="1"]')?.addEventListener('click', async () => {
          await this.render();
        });

        root.querySelector('[data-pirates-propose-contract="1"]')?.addEventListener('click', () => {
          const formHost = root.querySelector('[data-contract-form-host]');
          if (!formHost) return;
          formHost.innerHTML = `
            <form data-contract-form style="display:grid;gap:8px;background:#1a2035;padding:10px;border-radius:6px;border:1px solid #3a4762;">
              <div style="font-weight:700;font-size:12px;margin-bottom:2px;">Propose Contract</div>
              <label style="font-size:11px;color:#9fb0ce;">Faction
                <select data-cf-faction style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:3px;">
                  ${(this.state.status?.factions || []).map(f => `<option value="${esc(String(f.id))}">${esc(f.icon || '')} ${esc(f.name || String(f.id))}</option>`).join('')}
                </select>
              </label>
              <label style="font-size:11px;color:#9fb0ce;">Type
                <select data-cf-type style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:3px;">
                  <option value="tributary">Tributary</option>
                  <option value="non_aggression">Non-Aggression</option>
                  <option value="mercenary">Mercenary</option>
                </select>
              </label>
              <label style="font-size:11px;color:#9fb0ce;">Credit Offer
                <input data-cf-credits type="number" min="0" step="500" value="5000" style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:3px;">
              </label>
              <label style="font-size:11px;color:#9fb0ce;">Duration (days)
                <input data-cf-days type="number" min="1" max="90" value="30" style="width:100%;margin-top:3px;background:#111827;color:#d7e4ff;border:1px solid #3a4762;border-radius:4px;padding:3px;">
              </label>
              <div style="display:flex;gap:6px;">
                <button type="button" data-cf-submit style="background:#2e5a2e;border:1px solid #4a8a4a;color:#ccffcc;border-radius:5px;padding:4px 12px;cursor:pointer;font-size:12px;">Send Offer</button>
                <button type="button" data-cf-cancel style="background:#2e374e;border:1px solid #4a5878;color:#d7e4ff;border-radius:5px;padding:4px 12px;cursor:pointer;font-size:12px;">Cancel</button>
              </div>
            </form>`;
          formHost.style.display = '';

          formHost.querySelector('[data-cf-cancel]')?.addEventListener('click', () => {
            formHost.style.display = 'none';
            formHost.innerHTML = '';
          });

          formHost.querySelector('[data-cf-submit]')?.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            const factionId = Number(formHost.querySelector('[data-cf-faction]')?.value || 0);
            const contractType = formHost.querySelector('[data-cf-type]')?.value || 'tributary';
            const creditOffer = Number(formHost.querySelector('[data-cf-credits]')?.value || 0);
            const durationDays = Number(formHost.querySelector('[data-cf-days]')?.value || 30);
            try {
              const resp = await api.piratesProposeContract({
                faction_id: factionId,
                contract_type: contractType,
                credit_offer: creditOffer,
                duration_days: durationDays,
              });
              if (resp?.accepted) {
                showToast('Contract accepted.', 'success');
              } else {
                showToast('Contract rejected. Try offering more credits.', 'warning');
              }
              invalidateGetCache([/api\/pirates\.php\?action=/i]);
              formHost.style.display = 'none';
              formHost.innerHTML = '';
              await this.render();
            } catch (err) {
              gameLog('warn', 'propose_contract failed', err);
              showToast('Failed to send contract offer.', 'error');
            } finally {
              this.isBusy = false;
            }
          });
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
