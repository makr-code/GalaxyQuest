'use strict';

(function () {
  function createEconomyFlowController(opts = {}) {
    const {
      wm = null,
      getColonies = () => [],
      resourceInsightConfig = {},
      fmtName = (value) => String(value || ''),
      esc = (value) => String(value || ''),
      fmt = (value) => String(value || 0),
      selectColonyById = () => {},
      gameLog = () => {},
    } = opts;

    return {
      selectedResource: 'metal',
      flowData: null,
      lastUpdateMs: 0,

      calculateColonyFlows(resource) {
        const key = String(resource || 'metal').toLowerCase();
        const flows = [];
        (Array.isArray(getColonies()) ? getColonies() : []).forEach((colony) => {
          const production = this.estimateColonyProduction(colony, key);
          const consumption = this.estimateColonyConsumption(colony, key);
          const balance = production - consumption;
          flows.push({
            colonyId: Number(colony.id || 0),
            colonyName: String(colony.name || 'Unknown'),
            production,
            consumption,
            balance,
            surplus: balance > 0 ? balance : 0,
            deficit: balance < 0 ? Math.abs(balance) : 0,
            storageCurrentLevel: Number(colony[key] || 0),
            tone: balance > 10 ? 'is-good' : (balance < -10 ? 'is-critical' : 'is-warning'),
          });
        });
        const totalProduction = flows.reduce((sum, f) => sum + f.production, 0);
        const totalConsumption = flows.reduce((sum, f) => sum + f.consumption, 0);
        const empireBalance = totalProduction - totalConsumption;
        return {
          resource: key,
          colonies: flows.sort((a, b) => b.production - a.production),
          totalProduction,
          totalConsumption,
          empireBalance,
          empireTone: empireBalance > 0 ? 'is-good' : (empireBalance < 0 ? 'is-critical' : 'is-warning'),
        };
      },

      estimateColonyProduction(colony, resource) {
        const key = String(resource || 'metal').toLowerCase();
        if (key === 'food') return Number(colony.food_production || 0.5);
        if (key === 'metal') return Number(colony.metal_production || 0);
        if (key === 'crystal') return Number(colony.crystal_production || 0);
        if (key === 'deuterium') return Number(colony.deuterium_production || 0);
        return 0;
      },

      estimateColonyConsumption(colony, resource) {
        const key = String(resource || 'metal').toLowerCase();
        const pop = Number(colony.population || 0);
        if (key === 'food') return Math.max(0.1, pop * 0.8);
        if (key === 'metal' || key === 'crystal' || key === 'deuterium') return 0.2;
        return 0;
      },

      buildFlowHtml(dataset) {
        if (!dataset) return '<p class="text-muted">Keine Flowdaten verfügbar.</p>';
        const resourceConfig = resourceInsightConfig[dataset.resource] || {};
        const resourceLabel = resourceConfig.label || fmtName(dataset.resource);
        const resourceIcon = resourceConfig.icon || '▣';
        const coloniesHtml = dataset.colonies.map((flow) => {
          const barWidthProduction = Math.min(100, Math.round((flow.production / Math.max(1, dataset.totalProduction)) * 100));
          const barWidthConsumption = Math.min(100, Math.round((flow.consumption / Math.max(1, dataset.totalConsumption)) * 100));
          return `<div class="flow-colony-row" data-colony-id="${flow.colonyId}"><div class="flow-colony-name">${esc(flow.colonyName)}</div><div class="flow-stats"><div class="flow-stat-group"><span class="flow-label">Production:</span><span class="flow-value ${flow.production > 0 ? 'is-good' : ''}">${fmt(flow.production)}/h</span></div><div class="flow-stat-group"><span class="flow-label">Consumption:</span><span class="flow-value ${flow.consumption > 0 ? '' : 'is-good'}">${fmt(flow.consumption)}/h</span></div><div class="flow-stat-group"><span class="flow-label">Balance:</span><span class="flow-value ${flow.tone}">${flow.balance > 0 ? '+' : ''}${fmt(flow.balance)}/h</span></div></div><div class="flow-bars"><div class="flow-bar-production" style="width:${barWidthProduction}%;"></div><div class="flow-bar-consumption" style="width:${barWidthConsumption}%;"></div></div><div class="flow-storage">Storage: ${fmt(flow.storageCurrentLevel)}</div></div>`;
        }).join('');
        return `<div class="economy-flow-panel"><div class="flow-header"><h3>${resourceIcon} ${esc(resourceLabel)} - Empire Flows</h3><div class="flow-header-stats"><div class="stat-box is-good"><span class="stat-label">Total Production</span><span class="stat-value">${fmt(dataset.totalProduction)}/h</span></div><div class="stat-box is-critical"><span class="stat-label">Total Consumption</span><span class="stat-value">${fmt(dataset.totalConsumption)}/h</span></div><div class="stat-box ${dataset.empireTone}"><span class="stat-label">Empire Balance</span><span class="stat-value">${dataset.empireBalance > 0 ? '+' : ''}${fmt(dataset.empireBalance)}/h</span></div></div></div><div class="flow-legend"><span class="flow-legend-item"><span class="flow-bar-production"></span> Production</span><span class="flow-legend-item"><span class="flow-bar-consumption"></span> Consumption</span></div><div class="flow-colonies">${coloniesHtml}</div></div>`;
      },

      bindActions(root) {
        root.querySelectorAll('[data-colony-id]').forEach((row) => {
          row.addEventListener('click', () => {
            const cid = Number(row.getAttribute('data-colony-id') || 0);
            if (cid > 0) selectColonyById(cid, { openWindows: true });
          });
        });
      },

      async render() {
        const root = wm.body('economy-flow');
        if (!root) return;
        root.innerHTML = '<p class="text-muted">Analyzing empire economy...</p>';
        try {
          this.flowData = this.calculateColonyFlows(this.selectedResource);
          root.innerHTML = this.buildFlowHtml(this.flowData);
          this.bindActions(root);
          this.lastUpdateMs = Date.now();
        } catch (err) {
          gameLog('warn', 'Economy flow render fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to render economy flow.</p>';
        }
      },
    };
  }

  const api = { createEconomyFlowController };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeEconomyFlowController = api;
  }
})();