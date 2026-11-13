'use strict';

(function () {
  const RESOURCE_KEYS = new Set([
    'metal', 'crystal', 'deuterium', 'food', 'rare_earth',
    'population', 'happiness', 'energy', 'dark_matter',
  ]);
  const FOCUS_BUILDINGS = new Set([
    'metal_mine', 'crystal_mine', 'deuterium_synth', 'hydroponic_farm',
    'rare_earth_drill', 'habitat_dome', 'hospital', 'solar_plant',
  ]);

  function createElement(documentRef, tagName, className = '', text = '') {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text !== null && text !== undefined) element.textContent = String(text);
    return element;
  }

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  function createOverviewInsights(opts = {}) {
    const {
      documentRef = document,
      fmt = (value) => String(value ?? 0),
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
      const parsed = Number(value || 0);
      const n = Number.isFinite(parsed) ? parsed : 0;
      const fixed = digits > 0 ? n.toFixed(digits) : Math.round(n).toString();
      return `${n >= 0 ? '+' : ''}${fixed}`;
    }

    function riskLabel(status) {
      const code = String(status || 'stable');
      if (code === 'strain') return { className: 'text-red', text: 'Kritisch' };
      if (code === 'watch') return { className: 'text-yellow', text: 'Beobachten' };
      return { className: 'text-cyan', text: 'Stabil' };
    }

    function buildOfflineSummaryNode(offline) {
      const economy = offline?.economy || null;
      const netRates = economy?.net_rates_per_hour || offline?.rates_per_hour || null;
      const hadOfflineTime = !!offline?.had_offline_time;
      const statusCounts = economy?.status_counts || { stable: 0, watch: 0, strain: 0 };
      const topRisks = Array.isArray(economy?.top_risks) ? economy.top_risks : [];
      const card = createElement(documentRef, 'div', 'system-card');
      card.style.margin = '0.75rem 0 0.6rem';

      const heading = createElement(documentRef, 'div', 'system-row');
      heading.append(createElement(documentRef, 'strong', '', 'Oekonomie-Snapshot'));
      if (hadOfflineTime) {
        const elapsedMinutes = Math.max(1, Math.round(Number(offline?.max_elapsed_seconds || 0) / 60));
        heading.append(documentRef.createTextNode(` | Offline-Zeit: ${elapsedMinutes} min`));
      }
      card.append(heading);

      const rates = createElement(documentRef, 'div', 'system-row');
      rates.style.fontSize = '0.8rem';
      rates.style.color = 'var(--text-secondary)';
      rates.textContent = `Metal ${signed(netRates?.metal, 1)}/h | Crystal ${signed(netRates?.crystal, 1)}/h | Deuterium ${signed(netRates?.deuterium, 1)}/h | Food ${signed(netRates?.food, 1)}/h | Population ${signed(netRates?.population, 2)}/h`;
      card.append(rates);

      const counts = createElement(documentRef, 'div', 'system-row');
      counts.style.fontSize = '0.8rem';
      counts.style.color = 'var(--text-secondary)';
      counts.textContent = `Stabil: ${String(statusCounts.stable || 0)} | Beobachten: ${String(statusCounts.watch || 0)} | Kritisch: ${String(statusCounts.strain || 0)}`;
      if (economy) {
        const welfare = Math.min(100, Math.max(0, Number(economy.avg_welfare) || 0)).toFixed(1);
        counts.append(documentRef.createTextNode(` | Wohlfahrt >= ${welfare}%`));
      }
      card.append(counts);

      if (!topRisks.length) {
        const noRisks = createElement(documentRef, 'div', 'system-row text-cyan', 'Keine akuten Wirtschaftsrisiken erkannt.');
        noRisks.style.fontSize = '0.8rem';
        card.append(noRisks);
        return card;
      }

      const riskList = createElement(documentRef, 'div', 'system-row');
      riskList.style.fontSize = '0.8rem';
      riskList.style.lineHeight = '1.45';
      riskList.style.marginTop = '0.25rem';
      topRisks.forEach((risk, index) => {
        if (index > 0) riskList.append(documentRef.createElement('br'));
        const flags = Array.isArray(risk.risk_flags) ? risk.risk_flags.join(', ') : '';
        const cid = numericId(risk.colony_id);
        const focus = riskFocusFromFlags(risk.risk_flags);
        riskList.append(documentRef.createTextNode(
          `Risk ${String(risk.colony_name || 'Colony')}: `
        ));
        const status = riskLabel(risk.status);
        riskList.append(createElement(documentRef, 'span', status.className, status.text));
        riskList.append(documentRef.createTextNode(
          ` | Score ${String(risk.risk_score || 0)} | Food ${String(risk.food_rate_per_hour || 0)}/h | Energy ${String(risk.energy || 0)}${flags ? ` | ${flags}` : ''} `
        ));
        if (cid) {
          const focusButton = createElement(documentRef, 'button', 'btn btn-secondary btn-sm', 'Fix');
          focusButton.type = 'button';
          focusButton.dataset.riskAction = 'focus';
          focusButton.dataset.riskCid = String(cid);
          focusButton.dataset.riskFocus = focus;
          Object.assign(focusButton.style, { marginLeft: '0.35rem', padding: '0.2rem 0.45rem', fontSize: '0.7rem' });

          const autoButton = createElement(documentRef, 'button', 'btn btn-primary btn-sm', 'Auto +1');
          autoButton.type = 'button';
          autoButton.dataset.riskAction = 'auto';
          autoButton.dataset.riskCid = String(cid);
          autoButton.dataset.riskFocus = focus;
          Object.assign(autoButton.style, { marginLeft: '0.25rem', padding: '0.2rem 0.45rem', fontSize: '0.7rem' });
          riskList.append(focusButton, autoButton);
        }
      });
      card.append(riskList);
      return card;
    }

    function buildResourceInsightNode(offline, meta) {
      const uiState = getUiState();
      const currentColony = getCurrentColony();
      const config = getResourceInsightConfig(uiState.resourceInsight);
      if (!config || !currentColony || !RESOURCE_KEYS.has(config.key)) return null;
      const netRates = offline?.economy?.net_rates_per_hour || offline?.rates_per_hour || {};
      const currentValue = getResourceInsightValue(config.key, currentColony, meta);
      const totalValue = getResourceInsightTotal(config.key, meta);
      const share = totalValue > 0 ? Math.min(100, Math.round((currentValue / totalValue) * 100)) : 0;
      const perHourValue = config.rateKey ? Number(netRates?.[config.rateKey] || 0) : null;
      const perHour = perHourValue !== null && Number.isFinite(perHourValue) ? perHourValue : null;

      const section = createElement(documentRef, 'section', 'resource-insight-card');
      const header = createElement(documentRef, 'div', 'resource-insight-head');
      const titleGroup = documentRef.createElement('div');
      titleGroup.append(createElement(
        documentRef,
        'div',
        'resource-insight-title',
        `${String(config.icon ?? '')} ${String(config.label ?? '')} | ${String(currentColony.name || 'Kolonie')}`
      ));
      titleGroup.append(createElement(documentRef, 'div', 'resource-insight-note', config.desc));
      header.append(titleGroup);
      header.append(createElement(
        documentRef,
        'span',
        'status-chip chip-neutral',
        `[${String(currentColony.galaxy || 0)}:${String(currentColony.system || 0)}:${String(currentColony.position || 0)}]`
      ));
      section.append(header);

      const metrics = createElement(documentRef, 'div', 'resource-insight-meta');
      const stats = [
        ['Aktueller Bestand', formatResourceInsightValue(config.key, currentValue, currentColony)],
        ['Anteil an deinem Imperium', `${String(share)}%`],
        ['Imperiumsbestand', formatResourceInsightValue(config.key, totalValue, currentColony)],
        ['Nettofluss', perHour === null ? 'Kontextwert' : `${perHour >= 0 ? '+' : ''}${fmt(Math.abs(perHour))}/h`],
      ];
      stats.forEach(([label, value]) => {
        const stat = createElement(documentRef, 'div', 'resource-insight-stat');
        stat.append(createElement(documentRef, 'div', 'resource-insight-stat-label', label));
        stat.append(createElement(documentRef, 'div', 'resource-insight-stat-value', value));
        metrics.append(stat);
      });
      section.append(metrics);

      const actions = createElement(documentRef, 'div', 'resource-insight-actions');
      function addAction(label, action, className, attribute, value) {
        const button = createElement(documentRef, 'button', className, label);
        button.type = 'button';
        button.dataset.resourceAction = action;
        if (attribute && value !== undefined) button.dataset[attribute] = String(value);
        actions.append(button);
      }
      if (FOCUS_BUILDINGS.has(config.focusBuilding)) {
        addAction('Produktionsfokus', 'focus-building', 'btn btn-secondary btn-sm', 'resourceFocus', config.focusBuilding);
      }
      if (config.transportable && ['metal', 'crystal', 'deuterium'].includes(config.key)) {
        addAction('Transport starten', 'transport', 'btn btn-secondary btn-sm', 'resource', config.key);
      }
      if (config.tradeable && ['metal', 'crystal', 'deuterium'].includes(config.key)) {
        addAction('Verkaufen', 'market-sell', 'btn btn-primary btn-sm', 'resource', config.key);
        addAction('Kaufen', 'market-buy', 'btn btn-primary btn-sm', 'resource', config.key);
      }
      addAction('Schliessen', 'close-insight', 'btn btn-secondary btn-sm');
      section.append(actions);
      section.append(createElement(
        documentRef,
        'div',
        'resource-insight-note',
        'Handelsangebote werden nach Annahme nicht mehr sofort verrechnet. Stattdessen starten Frachter von der bestversorgten Quelle, binden die Fracht an die Flugzeit und verbrauchen Deuterium fuer den Transport.'
      ));
      return section;
    }

    return {
      riskFocusFromFlags,
      evaluateRiskUpgradeBudget,
      signed,
      buildOfflineSummaryNode,
      buildResourceInsightNode,
    };
  }

  const api = { createOverviewInsights };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeOverviewInsights = api;
  }
})();
