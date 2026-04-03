'use strict';

(function () {
  function createOverviewInsights(opts = {}) {
    const {
      fmt = (value) => String(value ?? 0),
      fmtName = (value) => String(value || ''),
      esc = (value) => String(value || ''),
      getUiState = () => ({}),
      getCurrentColony = () => null,
      getResourceInsightConfig = () => null,
      getResourceInsightValue = () => 0,
      getResourceInsightTotal = () => 0,
      formatResourceInsightValue = () => '0',
    } = opts;

    function riskFocusFromFlags(flags) {
      const list = Array.isArray(flags) ? flags.map((f) => String(f || '')) : [];
      if (list.includes('food_decline') || list.includes('low_food_buffer')) return 'hydroponic_farm';
      if (list.includes('energy_deficit')) return 'solar_plant';
      if (list.includes('low_welfare')) return 'hospital';
      return 'colony_hq';
    }

    function evaluateRiskUpgradeBudget(colony, nextCost, share = 0.55) {
      const parseRes = (v) => Math.max(0, Number(v || 0));
      const resources = {
        metal: parseRes(colony?.metal),
        crystal: parseRes(colony?.crystal),
        deuterium: parseRes(colony?.deuterium),
      };
      const costs = {
        metal: parseRes(nextCost?.metal),
        crystal: parseRes(nextCost?.crystal),
        deuterium: parseRes(nextCost?.deuterium),
      };
      const over = [];
      ['metal', 'crystal', 'deuterium'].forEach((key) => {
        if (!costs[key]) return;
        const limit = resources[key] * share;
        if (costs[key] > limit) {
          over.push(`${key}:${Math.round(costs[key])}>${Math.round(limit)}`);
        }
      });
      return { ok: over.length === 0, details: over };
    }

    function signed(value, digits = 0) {
      const n = Number(value || 0);
      const fixed = digits > 0 ? n.toFixed(digits) : Math.round(n).toString();
      return `${n >= 0 ? '+' : ''}${fixed}`;
    }

    function riskLabel(status) {
      const code = String(status || 'stable');
      if (code === 'strain') return '<span class="text-red">Kritisch</span>';
      if (code === 'watch') return '<span class="text-yellow">Beobachten</span>';
      return '<span class="text-cyan">Stabil</span>';
    }

    function buildOfflineSummaryHtml(offline) {
      const economy = offline?.economy || null;
      const netRates = economy?.net_rates_per_hour || offline?.rates_per_hour || null;
      const hadOfflineTime = !!offline?.had_offline_time;
      const statusCounts = economy?.status_counts || { stable: 0, watch: 0, strain: 0 };
      const topRisks = Array.isArray(economy?.top_risks) ? economy.top_risks : [];
      const topRiskHtml = topRisks.length
        ? `<div class="system-row" style="font-size:0.8rem;line-height:1.45;margin-top:0.25rem">
            ${topRisks.map((risk) => {
              const flags = Array.isArray(risk.risk_flags) ? risk.risk_flags.join(', ') : '';
              const cid = Number(risk.colony_id || 0);
              const focus = riskFocusFromFlags(risk.risk_flags);
              return `Risk ${esc(String(risk.colony_name || 'Colony'))}: ${riskLabel(risk.status)} | Score ${esc(String(risk.risk_score || 0))} | Food ${esc(String(risk.food_rate_per_hour || 0))}/h | Energy ${esc(String(risk.energy || 0))}${flags ? ` | ${esc(flags)}` : ''} <button type="button" class="btn btn-secondary btn-sm" data-risk-action="focus" data-risk-cid="${cid}" data-risk-focus="${esc(focus)}" style="margin-left:0.35rem;padding:0.2rem 0.45rem;font-size:0.7rem">Fix</button><button type="button" class="btn btn-primary btn-sm" data-risk-action="auto" data-risk-cid="${cid}" data-risk-focus="${esc(focus)}" style="margin-left:0.25rem;padding:0.2rem 0.45rem;font-size:0.7rem">Auto +1</button>`;
            }).join('<br>')}
          </div>`
        : '<div class="system-row text-cyan" style="font-size:0.8rem">Keine akuten Wirtschaftsrisiken erkannt.</div>';

      return `
        <div class="system-card" style="margin:0.75rem 0 0.6rem">
          <div class="system-row"><strong>Oekonomie-Snapshot</strong>${hadOfflineTime ? ` | Offline-Zeit: ${Math.max(1, Math.round((Number(offline?.max_elapsed_seconds || 0) / 60)))} min` : ''}</div>
          <div class="system-row" style="font-size:0.8rem;color:var(--text-secondary)">
            Metal ${signed(netRates?.metal, 1)}/h | Crystal ${signed(netRates?.crystal, 1)}/h | Deuterium ${signed(netRates?.deuterium, 1)}/h | Food ${signed(netRates?.food, 1)}/h | Population ${signed(netRates?.population, 2)}/h
          </div>
          <div class="system-row" style="font-size:0.8rem;color:var(--text-secondary)">
            Stabil: ${statusCounts.stable || 0} | Beobachten: ${statusCounts.watch || 0} | Kritisch: ${statusCounts.strain || 0}
            ${economy ? ` | Wohlfahrt >= ${(Number(economy.avg_welfare || 0)).toFixed(1)}%` : ''}
          </div>
          ${topRiskHtml}
        </div>`;
    }

    function buildResourceInsightHtml(offline, meta) {
      const uiState = getUiState();
      const currentColony = getCurrentColony();
      const config = getResourceInsightConfig(uiState.resourceInsight);
      if (!config || !currentColony) return '';
      const netRates = offline?.economy?.net_rates_per_hour || offline?.rates_per_hour || {};
      const currentValue = getResourceInsightValue(config.key, currentColony, meta);
      const totalValue = getResourceInsightTotal(config.key, meta);
      const share = totalValue > 0 ? Math.min(100, Math.round((currentValue / totalValue) * 100)) : 0;
      const perHour = config.rateKey ? Number(netRates?.[config.rateKey] || 0) : null;
      const actions = [];
      if (config.focusBuilding) {
        actions.push(`<button type="button" class="btn btn-secondary btn-sm" data-resource-action="focus-building" data-resource-focus="${esc(config.focusBuilding)}">Produktionsfokus</button>`);
      }
      if (config.transportable) {
        actions.push(`<button type="button" class="btn btn-secondary btn-sm" data-resource-action="transport" data-resource="${esc(config.key)}">Transport starten</button>`);
      }
      if (config.tradeable) {
        actions.push(`<button type="button" class="btn btn-primary btn-sm" data-resource-action="market-sell" data-resource="${esc(config.key)}">Verkaufen</button>`);
        actions.push(`<button type="button" class="btn btn-primary btn-sm" data-resource-action="market-buy" data-resource="${esc(config.key)}">Kaufen</button>`);
      }
      actions.push('<button type="button" class="btn btn-secondary btn-sm" data-resource-action="close-insight">Schliessen</button>');

      return `
        <section class="resource-insight-card">
          <div class="resource-insight-head">
            <div>
              <div class="resource-insight-title">${esc(config.icon)} ${esc(config.label)} | ${esc(currentColony.name || 'Kolonie')}</div>
              <div class="resource-insight-note">${esc(config.desc)}</div>
            </div>
            <span class="status-chip chip-neutral">[${esc(String(currentColony.galaxy || 0))}:${esc(String(currentColony.system || 0))}:${esc(String(currentColony.position || 0))}]</span>
          </div>
          <div class="resource-insight-meta">
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Aktueller Bestand</div>
              <div class="resource-insight-stat-value">${esc(formatResourceInsightValue(config.key, currentValue, currentColony))}</div>
            </div>
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Anteil an deinem Imperium</div>
              <div class="resource-insight-stat-value">${esc(String(share))}%</div>
            </div>
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Imperiumsbestand</div>
              <div class="resource-insight-stat-value">${esc(formatResourceInsightValue(config.key, totalValue, currentColony))}</div>
            </div>
            <div class="resource-insight-stat">
              <div class="resource-insight-stat-label">Nettofluss</div>
              <div class="resource-insight-stat-value">${perHour === null ? 'Kontextwert' : `${perHour >= 0 ? '+' : ''}${fmt(Math.abs(perHour))}/h`}</div>
            </div>
          </div>
          <div class="resource-insight-actions">${actions.join('')}</div>
          <div class="resource-insight-note">Handelsangebote werden nach Annahme nicht mehr sofort verrechnet. Stattdessen starten Frachter von der bestversorgten Quelle, binden die Fracht an die Flugzeit und verbrauchen Deuterium fuer den Transport.</div>
        </section>`;
    }

    return {
      riskFocusFromFlags,
      evaluateRiskUpgradeBudget,
      signed,
      riskLabel,
      buildOfflineSummaryHtml,
      buildResourceInsightHtml,
    };
  }

  const api = { createOverviewInsights };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeOverviewInsights = api;
  }
})();