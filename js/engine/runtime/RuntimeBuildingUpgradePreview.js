'use strict';

(function () {
  function createBuildingUpgradePreview(opts = {}) {
    const {
      fmt = (value) => String(value ?? 0),
      fmtName = (value) => String(value || ''),
      esc = (value) => String(value || ''),
      getCurrentColony = () => null,
    } = opts;

    function simulateBuildingUpgrade(building) {
      const currentLevel = Number(building.level || 0);
      const nextLevel = currentLevel + 1;
      const cost = building.next_cost || { metal: 0, crystal: 0, deuterium: 0 };

      // Estimate production scaling (simplified: most buildings scale linearly or with small multiplier)
      // Linear scaling: Output += 20% per level for extractors/farms
      // Level-based scaling for capacity buildings: +200 per level for habitats, etc.

      const buildingType = String(building.type || '');
      let productionMultiplier = 1.20; // Default: +20% per level
      let capacityIncrease = 0;
      let description = '';

      // Type-specific scaling rules
      if (buildingType.includes('mine') || buildingType.includes('synth') || buildingType === 'hydroponic_farm') {
        // Extractors scale +20% per level
        productionMultiplier = 1.20;
        description = `Production increases by ~20% (Lv${nextLevel} typically produces ${fmt(Math.round(Number(building.production_rate || 10) * productionMultiplier))}/h)`;
      } else if (buildingType === 'habitat') {
        // Habitats +200 population per level
        capacityIncrease = 200;
        description = `Population capacity increases by +200 (new total: ${fmt((Math.max(0, Number(getCurrentColony()?.max_population || 500)) + 200))})`;
      } else if (buildingType.includes('storage') || buildingType === 'deuterium_tank') {
        // Storage scales +30% per level
        productionMultiplier = 1.30;
        description = 'Storage capacity increases by ~30%';
      } else if (buildingType === 'solar_plant' || buildingType === 'fusion_reactor') {
        // Energy generation scaling +25% per level
        productionMultiplier = 1.25;
        description = 'Energy output increases by ~25%';
      } else if (buildingType === 'robotics_factory') {
        // Build time reduction scales: -10% per level (faster)
        description = 'Build times reduce by ~10% (cumulative effect)';
      } else if (buildingType === 'nanite_factory') {
        // Dramatic time reduction
        description = 'Build times reduce dramatically (major efficiency boost)';
      } else if (buildingType === 'research_lab') {
        // Research acceleration +15% per level
        productionMultiplier = 1.15;
        description = 'Research speed increases by ~15%';
      } else {
        // Generic facility
        description = `Building will improve operational efficiency (Lv${nextLevel})`;
      }

      return {
        currentLevel,
        nextLevel,
        cost,
        productionMultiplier,
        capacityIncrease,
        description,
        estimatedTimeToBuild: currentLevel < 5 ? `${5 + (currentLevel * 2)}min` : `${30 + (currentLevel * 10)}min`, // Rough estimate
      };
    }

    function buildUpgradePreviewModal(building, simulation) {
      const cost = simulation.cost;
      const currentColony = getCurrentColony();
      const currentResources = currentColony ? {
        metal: Number(currentColony.metal || 0),
        crystal: Number(currentColony.crystal || 0),
        deuterium: Number(currentColony.deuterium || 0),
      } : { metal: 0, crystal: 0, deuterium: 0 };

      // Check if player has enough resources
      const canAfford = (cost.metal <= currentResources.metal)
        && (cost.crystal <= currentResources.crystal)
        && (cost.deuterium <= currentResources.deuterium);

      // ROI calculation: How long until upgrade pays for itself?
      // Simple formula: cost / (production * 0.1) = roughly hours to break even
      const roiEstimate = cost.metal > 0 ? Math.round((cost.metal * 0.2) / (Number(building.production_rate || 1) + 1)) : '?';

      return `
      <div style="position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:50000; animation:fadeIn 200ms ease;">
        <div style="background:var(--bg-panel); border:1px solid var(--border-lit); border-radius:8px; padding:1.2rem; max-width:420px; max-height:85vh; overflow-y:auto; box-shadow:0 20px 40px rgba(0,0,0,0.8);">

          <h3 style="margin:0 0 0.8rem; color:var(--accent-cyan);">⚙️ ${esc(fmtName(building.type))} Upgrade Preview</h3>

          <div style="border-bottom:1px solid var(--border); padding-bottom:0.8rem; margin-bottom:0.8rem;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; font-size:0.9rem;">
              <div>
                <div style="color:var(--text-secondary); font-size:0.75rem; margin-bottom:0.2rem;">CURRENT STATUS</div>
                <div style="font-weight:bold; color:var(--accent-yellow);">Level ${simulation.currentLevel}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);">Current tier</div>
              </div>
              <div>
                <div style="color:var(--text-secondary); font-size:0.75rem; margin-bottom:0.2rem;">AFTER UPGRADE</div>
                <div style="font-weight:bold; color:var(--accent-green);">↗ Level ${simulation.nextLevel}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);">+1 tier</div>
              </div>
            </div>
          </div>

          <div style="background:rgba(58,160,255,0.08); border:1px solid var(--border); border-radius:4px; padding:0.8rem; margin-bottom:0.8rem; font-size:0.85rem;">
            <div style="color:var(--text-secondary); margin-bottom:0.4rem;">📊 Impact</div>
            <div style="color:var(--accent-cyan); line-height:1.6;">
              ${esc(simulation.description)}
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.5rem; margin-bottom:0.8rem; font-size:0.8rem;">
            <div style="background:var(--bg-panel2); padding:0.5rem; border-radius:4px; text-align:center;">
              <div style="color:var(--text-secondary); font-size:0.7rem;">COST (Metal)</div>
              <div style="font-weight:bold; color:${cost.metal > 0 ? 'var(--metal-color)' : 'var(--text-muted)'};">${esc(fmt(cost.metal || 0))}</div>
              <div style="font-size:0.65rem; color:${cost.metal <= currentResources.metal ? 'var(--accent-green)' : 'var(--accent-red)'};">
                ${cost.metal <= currentResources.metal ? '✓ Affordable' : `✗ Short ${fmt(cost.metal - currentResources.metal)}`}
              </div>
            </div>
            <div style="background:var(--bg-panel2); padding:0.5rem; border-radius:4px; text-align:center;">
              <div style="color:var(--text-secondary); font-size:0.7rem;">COST (Crystal)</div>
              <div style="font-weight:bold; color:${cost.crystal > 0 ? 'var(--crystal-color)' : 'var(--text-muted)'};">${esc(fmt(cost.crystal || 0))}</div>
              <div style="font-size:0.65rem; color:${cost.crystal <= currentResources.crystal ? 'var(--accent-green)' : 'var(--accent-red)'};">
                ${cost.crystal <= currentResources.crystal ? '✓ Affordable' : `✗ Short ${fmt(cost.crystal - currentResources.crystal)}`}
              </div>
            </div>
            <div style="background:var(--bg-panel2); padding:0.5rem; border-radius:4px; text-align:center;">
              <div style="color:var(--text-secondary); font-size:0.7rem;">COST (Deuterium)</div>
              <div style="font-weight:bold; color:${cost.deuterium > 0 ? 'var(--deut-color)' : 'var(--text-muted)'};">${esc(fmt(cost.deuterium || 0))}</div>
              <div style="font-size:0.65rem; color:${cost.deuterium <= currentResources.deuterium ? 'var(--accent-green)' : 'var(--accent-red)'};">
                ${cost.deuterium <= currentResources.deuterium ? '✓ Affordable' : `✗ Short ${fmt(cost.deuterium - currentResources.deuterium)}`}
              </div>
            </div>
          </div>

          <div style="background:var(--bg-panel2); border:1px solid var(--border); border-radius:4px; padding:0.6rem; margin-bottom:0.8rem; font-size:0.8rem;">
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="color:var(--text-secondary);">⏱️ Build Time</span>
              <span style="font-weight:bold; color:var(--accent-green);">${esc(String(simulation.estimatedTimeToBuild))}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-secondary);">💰 ROI Breakeven</span>
              <span style="font-weight:bold; color:var(--accent-yellow); font-size:0.75rem;">~${esc(String(roiEstimate))} build cycles</span>
            </div>
          </div>

          <div style="display:flex; gap:0.5rem; margin-top:1rem;">
            <button id="preview-confirm-btn" class="btn btn-primary" style="flex:1; ${canAfford ? '' : 'opacity:0.5; cursor:not-allowed;'}" ${canAfford ? '' : 'disabled'}>
              Confirm Upgrade
            </button>
            <button id="preview-cancel-btn" class="btn btn-secondary" style="flex:1;">
              Cancel
            </button>
          </div>

        </div>
      </div>

      <style>
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      </style>
    `;
    }

    return {
      simulateBuildingUpgrade,
      buildUpgradePreviewModal,
    };
  }

  const api = { createBuildingUpgradePreview };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeBuildingUpgradePreview = api;
  }
})();