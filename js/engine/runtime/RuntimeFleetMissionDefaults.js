'use strict';

(function () {
  function createFleetMissionDefaultsHelper(opts = {}) {
    const {
      getCurrentColony = () => null,
      esc = (value) => String(value || ''),
    } = opts;

    return {
      pickDefaultShips(mission, avail, intel) {
        const available = Array.isArray(avail) ? avail : [];
        const byType = Object.fromEntries(available.map((ship) => [String(ship.type), ship]));
        const selected = {};
        const choose = (type, amount) => {
          const ship = byType[type];
          if (!ship) return false;
          const count = Math.max(0, Math.min(Number(ship.count || 0), Number(amount || 0)));
          if (count > 0) {
            selected[type] = count;
            return true;
          }
          return false;
        };

        if (mission === 'spy') {
          if (!choose('espionage_probe', 1)) choose('pathfinder', 1);
          return selected;
        }
        if (mission === 'colonize') {
          choose('colony_ship', 1);
          choose('small_cargo', 1);
          choose('large_cargo', 1);
          return selected;
        }
        if (mission === 'harvest') {
          if (!choose('recycler', 4)) choose('pathfinder', 2);
          choose('large_cargo', 2);
          return selected;
        }
        if (mission === 'transport') {
          if (!choose('large_cargo', 8)) choose('small_cargo', 12);
          choose('pathfinder', 1);
          return selected;
        }

        if (mission === 'attack') {
          const threatScore = Number(intel?.threat?.score || 0);
          const heavyTarget = threatScore >= 80 ? 8 : threatScore >= 50 ? 5 : 3;
          const mediumTarget = threatScore >= 80 ? 12 : threatScore >= 50 ? 8 : 5;
          if (!choose('battlecruiser', heavyTarget)) choose('battleship', heavyTarget);
          choose('cruiser', mediumTarget);
          choose('heavy_fighter', mediumTarget);
          if (!Object.keys(selected).length) choose('light_fighter', Math.min(20, Number(byType.light_fighter?.count || 0)));
          return selected;
        }

        choose('small_cargo', 1);
        return selected;
      },

      applyMissionDefaults(root, avail, prefill = null) {
        if (!root) return;
        const fallbackPrefill = prefill || {};
        const mission = String(root.querySelector('input[name="mission"]:checked')?.value || fallbackPrefill.mission || 'transport');
        const selectedShips = this.pickDefaultShips(mission, avail, fallbackPrefill.intel);
        root.querySelectorAll('.fleet-ship-qty').forEach((inp) => {
          inp.value = String(selectedShips[inp.dataset.type] || 0);
        });

        const currentColony = getCurrentColony();
        const cargoMetal = root.querySelector('#f-cargo-metal');
        const cargoCrystal = root.querySelector('#f-cargo-crystal');
        const cargoDeut = root.querySelector('#f-cargo-deut');
        if (mission === 'transport' && currentColony) {
          const cargoCap = Object.entries(selectedShips).reduce((sum, [type, count]) => {
            const ship = (avail || []).find((entry) => entry.type === type);
            return sum + (Number(ship?.cargo || 0) * Number(count || 0));
          }, 0);
          const prefillCargo = fallbackPrefill.cargo && typeof fallbackPrefill.cargo === 'object'
            ? fallbackPrefill.cargo
            : null;
          const metal = prefillCargo
            ? Math.min(Number(currentColony.metal || 0), Math.max(0, Number(prefillCargo.metal || 0)), cargoCap)
            : Math.min(Number(currentColony.metal || 0), Math.round(cargoCap * 0.45));
          const crystal = prefillCargo
            ? Math.min(Number(currentColony.crystal || 0), Math.max(0, Number(prefillCargo.crystal || 0)), cargoCap)
            : Math.min(Number(currentColony.crystal || 0), Math.round(cargoCap * 0.3));
          const deut = prefillCargo
            ? Math.min(Number(currentColony.deuterium || 0), Math.max(0, Number(prefillCargo.deuterium || 0)), cargoCap)
            : Math.min(Number(currentColony.deuterium || 0), Math.round(cargoCap * 0.15));
          if (cargoMetal) cargoMetal.value = String(Math.max(0, metal));
          if (cargoCrystal) cargoCrystal.value = String(Math.max(0, crystal));
          if (cargoDeut) cargoDeut.value = String(Math.max(0, deut));
        } else {
          if (cargoMetal) cargoMetal.value = '0';
          if (cargoCrystal) cargoCrystal.value = '0';
          if (cargoDeut) cargoDeut.value = '0';
        }

        const hint = root.querySelector('#fleet-default-hint');
        if (hint) {
          const owner = fallbackPrefill.owner ? `Ziel: ${esc(fallbackPrefill.owner)}` : 'Freies Zielprofil';
          const threat = fallbackPrefill.threatLevel ? ` | Bedrohung: ${esc(fallbackPrefill.threatLevel)}` : '';
          const scan = fallbackPrefill.intel?.intel?.latest_scan_at
            ? ` | Scan: ${esc(new Date(fallbackPrefill.intel.intel.latest_scan_at).toLocaleString())}`
            : '';
          hint.innerHTML = `${owner}${threat}${scan} | Missionsdefaults gesetzt.`;
        }
      },

      bindMissionDefaults(root, avail, onChange = null) {
        if (!root) return;
        root.querySelectorAll('input[name="mission"]').forEach((input) => {
          input.addEventListener('change', () => {
            if (typeof onChange === 'function') onChange(root, avail);
          });
        });
      },
    };
  }

  const api = { createFleetMissionDefaultsHelper };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeFleetMissionDefaults = api;
  }
})();