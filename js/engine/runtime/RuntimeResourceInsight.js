/**
 * RuntimeResourceInsight.js
 *
 * Resource insight, trade launch and transport planner helpers.
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  const RESOURCE_INSIGHT_CONFIG = Object.freeze({
    metal: { key: 'metal', label: 'Metal', icon: 'MET', desc: 'Basismetall fuer Hulls, Industrie und Ausbau. Ueberschuesse eignen sich fuer Angebotstrades oder interne Transporte.', focusBuilding: 'metal_mine', rateKey: 'metal', tradeable: true, transportable: true },
    crystal: { key: 'crystal', label: 'Crystal', icon: 'CRY', desc: 'Veredelte Hochtechnologieressource fuer Forschung, Scanner und Komponentenbau.', focusBuilding: 'crystal_mine', rateKey: 'crystal', tradeable: true, transportable: true },
    deuterium: { key: 'deuterium', label: 'Deuterium', icon: 'DEU', desc: 'Treibstoff und Spezialressource. Transporte, Flottenstarts und Handel ziehen Deuterium fuer Frachtsicherung und Flugzeit.', focusBuilding: 'deuterium_synth', rateKey: 'deuterium', tradeable: true, transportable: true },
    food: { key: 'food', label: 'Food', icon: 'FOD', desc: 'Versorgt die Bevoelkerung und stabilisiert Wachstum. Negative Raten wirken direkt auf Wohlfahrt und Ausbau.', focusBuilding: 'hydroponic_farm', rateKey: 'food', tradeable: false, transportable: false },
    rare_earth: { key: 'rare_earth', label: 'Rare Earth', icon: 'RRE', desc: 'Seltene Fertigungsmetalle fuer fortgeschrittene Module. Im aktuellen Handelssystem nur strategisch beobachten, nicht direkt handeln.', focusBuilding: 'rare_earth_drill', rateKey: 'rare_earth', tradeable: false, transportable: false },
    population: { key: 'population', label: 'Population', icon: 'POP', desc: 'Arbeitskraefte und Wachstumspuffer der Kolonie. Engpaesse limitieren Produktion und Baugeschwindigkeit.', focusBuilding: 'habitat_dome', rateKey: 'population', tradeable: false, transportable: false },
    happiness: { key: 'happiness', label: 'Happiness', icon: 'HAP', desc: 'Produktivitaets- und Stabilitaetsindikator. Sinkt Happiness, verlieren selbst volle Lager an Effizienz.', focusBuilding: 'hospital', rateKey: null, tradeable: false, transportable: false },
    energy: { key: 'energy', label: 'Energy', icon: 'ENG', desc: 'Versorgt Gebaeude und beeinflusst alle Produktionsketten. Defizite wirken sofort auf die Wirtschaft.', focusBuilding: 'solar_plant', rateKey: null, tradeable: false, transportable: false },
    dark_matter: { key: 'dark_matter', label: 'Dark Matter', icon: 'DM', desc: 'Prestigewaehrung aus Quests und Progression. Nicht ueber den normalen Rohstoffmarkt handelbar.', focusBuilding: '', rateKey: null, tradeable: false, transportable: false },
  });

  const runtimeCtx = {
    getCurrentColony: () => null,
    getMeta: () => ({}),
    getColonies: () => [],
    getUiState: () => null,
    setFleetPrefill: () => {},
    showToast: () => {},
    wmOpen: () => {},
    wmRefresh: () => {},
    fmt: (n) => String(n || 0),
  };

  function configureResourceInsightRuntime(opts = {}) {
    if (!opts || typeof opts !== 'object') return;
    Object.assign(runtimeCtx, opts);
  }

  function getResourceInsightConfig(resourceKey) {
    return RESOURCE_INSIGHT_CONFIG[String(resourceKey || '').toLowerCase()] || null;
  }

  function getResourceInsightValue(resourceKey, colony = runtimeCtx.getCurrentColony(), meta = runtimeCtx.getMeta()) {
    const key = String(resourceKey || '');
    if (key === 'dark_matter') return Number(meta?.dark_matter || 0);
    if (!colony) return 0;
    if (key === 'population') return Number(colony.population || 0);
    if (key === 'happiness') return Number(colony.happiness || 0);
    if (key === 'energy') return Number(colony.energy || 0);
    return Number(colony[key] || 0);
  }

  function getResourceInsightTotal(resourceKey, meta = runtimeCtx.getMeta()) {
    const key = String(resourceKey || '');
    if (key === 'dark_matter') return Number(meta?.dark_matter || 0);
    const colonies = runtimeCtx.getColonies();
    return colonies.reduce((sum, colony) => sum + getResourceInsightValue(key, colony, meta), 0);
  }

  function formatResourceInsightValue(resourceKey, value, colony = runtimeCtx.getCurrentColony()) {
    const key = String(resourceKey || '');
    const numeric = Number(value || 0);
    if (key === 'population') {
      const maxPopulation = Number(colony?.max_population || 0);
      return maxPopulation > 0 ? `${runtimeCtx.fmt(numeric)}/${runtimeCtx.fmt(maxPopulation)}` : runtimeCtx.fmt(numeric);
    }
    if (key === 'happiness') return `${Math.round(numeric)}%`;
    if (key === 'energy') return `${Math.round(numeric)}`;
    return runtimeCtx.fmt(numeric);
  }

  function getSuggestedTradeAmount(resourceKey, mode = 'request') {
    const key = String(resourceKey || '');
    if (!['metal', 'crystal', 'deuterium'].includes(key)) return 0;
    const currentValue = Math.max(0, getResourceInsightValue(key));
    if (mode === 'offer') {
      return Math.max(250, Math.min(5000, Math.round(currentValue * 0.08)));
    }
    return Math.max(1000, Math.min(5000, Math.round(currentValue * 0.15) || 1000));
  }

  function openResourceInsight(resourceKey) {
    const config = getResourceInsightConfig(resourceKey);
    if (!config) return;
    const uiState = runtimeCtx.getUiState();
    if (uiState && typeof uiState === 'object') {
      uiState.resourceInsight = config.key;
    }
    runtimeCtx.wmOpen('overview');
    runtimeCtx.wmRefresh('overview');
  }

  function openTradeMarketplace(resourceKey, mode = 'request') {
    const config = getResourceInsightConfig(resourceKey);
    if (!config?.tradeable) {
      runtimeCtx.showToast(`${config?.label || 'Ressource'} ist im aktuellen Markt nicht direkt handelbar.`, 'info');
      return;
    }
    runtimeCtx.wmOpen('trade');
    window.setTimeout(() => {
      window.GQTradeProposalsController?.showProposeDialog(0, '', {
        resourceKey: config.key,
        mode,
      });
    }, 0);
  }

  function openFleetTransportPlanner(resourceKey) {
    const config = getResourceInsightConfig(resourceKey);
    if (!config?.transportable) {
      runtimeCtx.showToast(`${config?.label || 'Ressource'} nutzt aktuell keinen direkten Frachteinsatz.`, 'info');
      return;
    }
    const currentColony = runtimeCtx.getCurrentColony();
    const cargo = { metal: 0, crystal: 0, deuterium: 0 };
    cargo[config.key] = getSuggestedTradeAmount(config.key, 'offer');
    runtimeCtx.setFleetPrefill({
      galaxy: Number(currentColony?.galaxy || 1),
      system: Number(currentColony?.system || 1),
      position: Number(currentColony?.position || 1),
      mission: 'transport',
      owner: `${config.icon} ${config.label}`,
      threatLevel: 'Frachtsicherung aktiv',
      cargo,
      ts: Date.now(),
    });
    runtimeCtx.wmOpen('fleet');
    runtimeCtx.wmRefresh('fleet');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      RESOURCE_INSIGHT_CONFIG,
      configureResourceInsightRuntime,
      getResourceInsightConfig,
      getResourceInsightValue,
      getResourceInsightTotal,
      formatResourceInsightValue,
      getSuggestedTradeAmount,
      openResourceInsight,
      openTradeMarketplace,
      openFleetTransportPlanner,
    };
  } else {
    window.GQRuntimeResourceInsight = {
      RESOURCE_INSIGHT_CONFIG,
      configureResourceInsightRuntime,
      getResourceInsightConfig,
      getResourceInsightValue,
      getResourceInsightTotal,
      formatResourceInsightValue,
      getSuggestedTradeAmount,
      openResourceInsight,
      openTradeMarketplace,
      openFleetTransportPlanner,
    };
  }
})();
