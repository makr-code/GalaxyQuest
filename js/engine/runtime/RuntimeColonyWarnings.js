'use strict';

(function () {
  function createColonyWarnings(opts = {}) {
    const {
      fmt = (value) => String(value ?? 0),
    } = opts;

    function detectColonyWarnings(colony, offline) {
      const warnings = [];

      // Check 1: Energy Deficit / Low Energy
      const energy = Number(colony.energy ?? 0);
      const energyMax = 10000;
      if (energy <= 0) {
        warnings.push({
          level: 'critical',
          icon: '⚠️',
          title: 'ENERGY DEFICIT',
          desc: 'Colony will lose production efficiency without power',
          action: 'solar_plant'
        });
      } else if (energy < (energyMax * 0.2)) {
        warnings.push({
          level: 'warning',
          icon: '⚡',
          title: 'Low Energy',
          desc: `Only ${fmt(energy)} units available`,
          action: 'solar_plant'
        });
      }

      // Check 2: Population Unhappiness / Unrest Risk
      const happiness = Number(colony.happiness ?? 70);
      if (happiness < 40) {
        warnings.push({
          level: 'critical',
          icon: '😠',
          title: 'UNREST RISK',
          desc: `Happiness ${happiness}% - Rebellions likely within 24h`,
          action: 'hospital'
        });
      } else if (happiness < 55) {
        warnings.push({
          level: 'warning',
          icon: '😐',
          title: 'Unhappy Population',
          desc: `Happiness ${happiness}% - Unrest building`,
          action: 'hospital'
        });
      }

      // Check 3: Population at Capacity (overcrowding)
      const pop = Number(colony.population ?? 0);
      const maxPop = Number(colony.max_population ?? 500);
      const popPct = maxPop > 0 ? Math.round((pop / maxPop) * 100) : 0;
      if (popPct >= 95) {
        warnings.push({
          level: 'critical',
          icon: '👥',
          title: 'OVERCROWDED',
          desc: `Population ${fmt(pop)}/${fmt(maxPop)} - Growth stalled`,
          action: 'robotics_facility'
        });
      } else if (popPct >= 80) {
        warnings.push({
          level: 'warning',
          icon: '👥',
          title: 'High Population Density',
          desc: `${popPct}% capacity - Growth slowing`,
          action: 'robotics_facility'
        });
      }

      // Check 4: Storage Critical (all resources high)
      const maxMetal = Number(colony.max_metal || 10000000);
      const maxCrystal = Number(colony.max_crystal || 8000000);
      const maxDeut = Number(colony.max_deuterium || 4000000);
      const metalPct = maxMetal > 0 ? Math.round((Number(colony.metal || 0) / maxMetal) * 100) : 0;
      const crystalPct = maxCrystal > 0 ? Math.round((Number(colony.crystal || 0) / maxCrystal) * 100) : 0;
      const deutPct = maxDeut > 0 ? Math.round((Number(colony.deuterium || 0) / maxDeut) * 100) : 0;

      if (metalPct >= 95 && crystalPct >= 95 && deutPct >= 95) {
        warnings.push({
          level: 'critical',
          icon: '🏭',
          title: 'ALL STORAGE FULL',
          desc: 'Production will stall - transfer or trade immediately',
          action: 'storage_silo'
        });
      } else if ((metalPct >= 90 || crystalPct >= 90 || deutPct >= 90)) {
        warnings.push({
          level: 'warning',
          icon: '📦',
          title: 'Storage Capacity High',
          desc: `${Math.max(metalPct, crystalPct, deutPct)}% - Plan transfers`,
          action: 'storage_silo'
        });
      }

      // Check 5: Food Crisis / Famine
      const food = Number(colony.food ?? 0);
      if (food < 100) {
        warnings.push({
          level: 'critical',
          icon: '🍞',
          title: 'FAMINE IMMINENT',
          desc: `Food ${fmt(food)} - Population will starve within 1h`,
          action: 'hydroponic_farm'
        });
      } else if (food < 500) {
        warnings.push({
          level: 'warning',
          icon: '🥕',
          title: 'Low Food Reserves',
          desc: `Food ${fmt(food)} - Only ${Math.floor(food / (pop || 1))} units per capita`,
          action: 'hydroponic_farm'
        });
      }

      // Check 6: Colony Health Degradation
      const health = Number(colony.integrity_pct ?? colony.health_pct ?? colony.hp_pct ?? colony.condition_pct ?? 100);
      if (health < 30) {
        warnings.push({
          level: 'critical',
          icon: '💥',
          title: 'STRUCTURAL DAMAGE',
          desc: `Integrity ${health}% - Catastrophic failure approaching`,
          action: 'repair_dock'
        });
      } else if (health < 60) {
        warnings.push({
          level: 'warning',
          icon: '🔧',
          title: 'Colony Damaged',
          desc: `Integrity ${health}% - Repairs recommended`,
          action: 'repair_dock'
        });
      }

      // Check 7: Shield Down (vulnerable to attack)
      const shieldPct = Number(colony.shield_pct ?? colony.shields_pct ?? colony.planetary_shield_pct ?? 100);
      if (shieldPct < 20 && shieldPct > 0) {
        warnings.push({
          level: 'warning',
          icon: '🛡️',
          title: 'Shields Weakening',
          desc: `Shield ${Math.round(shieldPct)}% - Imminent attack vulnerable`,
          action: 'shield_generator'
        });
      }

      return warnings.sort((a, b) => {
        const levelOrder = { critical: 0, warning: 1, info: 2 };
        return (levelOrder[a.level] ?? 999) - (levelOrder[b.level] ?? 999);
      });
    }

    function buildWarningsHtml(colony, offline) {
      const warnings = detectColonyWarnings(colony, offline);
      if (!warnings.length) return '';

      // Show only top 2-3 most critical warnings to avoid clutter
      const topWarnings = warnings.slice(0, 2);
      const cid = Number(colony.id || 0);

      return `
      <div class="colony-warnings-panel" style="margin-top:0.4rem; padding:0.35rem; border-radius:4px; border-left:3px solid ${
        topWarnings[0].level === 'critical' ? '#ff4455' : '#ffcc00'
      }; background:rgba(${ 
        topWarnings[0].level === 'critical' ? '255,68,85' : '255,204,0'
      },0.08);">
        ${topWarnings.map((w) => `
          <div class="warning-row" style="display:flex; align-items:center; gap:0.4rem; margin:0.2rem 0; font-size:0.75rem;">
            <span style="flex-shrink:0; font-size:0.85rem;">${w.icon}</span>
            <span style="flex:1; color:${w.level === 'critical' ? '#ff8f9f' : '#ffd966'}; font-weight:bold;">${w.title}</span>
            <button class="btn btn-sm btn-secondary" data-warning-action="${w.action}" data-warning-cid="${cid}" style="padding:0.15rem 0.3rem; font-size:0.65rem; flex-shrink:0;">Fix</button>
          </div>
        `).join('')}
      </div>`;
    }

    return {
      detectColonyWarnings,
      buildWarningsHtml,
    };
  }

  const api = { createColonyWarnings };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeColonyWarnings = api;
  }
})();