'use strict';

(function () {
  function createFleetController(opts = {}) {
    const {
      wm = null,
      api = null,
      getCurrentColony = () => null,
      getUiState = () => ({}),
      esc = (value) => String(value || ''),
      fmtName = (value) => String(value || ''),
      gameLog = () => {},
      missionDefaultsHelper = null,
      submitFlowHelper = null,
      statusPanelsHelper = null,
    } = opts;

    return {
      prefillTarget(coords, mission, defaults = {}) {
        if (!coords) return;
        const uiState = getUiState();
        uiState.fleetPrefill = {
          galaxy: Number(coords.galaxy || 1),
          system: Number(coords.system || 1),
          position: Number(coords.position || 1),
          mission: String(mission || 'transport'),
          owner: defaults.owner || '',
          threatLevel: defaults.threatLevel || '',
          intel: defaults.intel || null,
          ts: Date.now(),
        };
        wm.open('fleet');
        setTimeout(() => {
          const root = wm.body('fleet');
          if (!root) return;
          const galaxyInput = root.querySelector('#f-galaxy');
          const systemInput = root.querySelector('#f-system');
          const positionInput = root.querySelector('#f-position');
          if (galaxyInput) galaxyInput.value = String(coords.galaxy || 1);
          if (systemInput) systemInput.value = String(coords.system || 1);
          if (positionInput) positionInput.value = String(coords.position || 1);
          const missionInput = root.querySelector(`input[name="mission"][value="${mission}"]`);
          if (missionInput) {
            missionInput.checked = true;
            missionInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, 0);
      },

      pickDefaultShips(mission, avail, intel) {
        return missionDefaultsHelper.pickDefaultShips(mission, avail, intel);
      },

      applyMissionDefaults(root, avail, prefill) {
        missionDefaultsHelper.applyMissionDefaults(root, avail, prefill);
      },

      buildPayload(root) {
        return submitFlowHelper.buildPayload(root);
      },

      bindMissionDefaults(root, avail) {
        missionDefaultsHelper.bindMissionDefaults(root, avail, () => {
          this.applyMissionDefaults(root, avail, getUiState().fleetPrefill);
        });
      },

      async renderForm() {
        const root = wm.body('fleet');
        if (!root) return;
        const currentColony = getCurrentColony();
        if (!currentColony) {
          root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
          return;
        }

        root.innerHTML = `
        <form id="fleet-form-wm" autocomplete="off">
          <h3>1. Select Ships</h3>
          <div id="fleet-ship-select-wm"><p class="text-muted">Loading ships...</p></div>

          <h3>2. Select Mission</h3>
          <div class="mission-grid">
            <label><input type="radio" name="mission" value="attack" /> Attack colony</label>
            <label><input type="radio" name="mission" value="transport" checked /> Transport resources</label>
            <label><input type="radio" name="mission" value="spy" /> Spy on colony</label>
            <label><input type="radio" name="mission" value="colonize" /> Colonize planet</label>
            <label><input type="radio" name="mission" value="harvest" /> Harvest deposits</label>
            <label><input type="radio" name="mission" value="survey" /> Survey system (FTL infrastructure)</label>
          </div>

          <h3>3. Target Coordinates</h3>
          <div class="coord-inputs">
            <label>Galaxy  <input type="number" id="f-galaxy"   min="1" max="9"   value="1" /></label>
            <label>System  <input type="number" id="f-system"   min="1" max="499" value="1" /></label>
            <label>Position<input type="number" id="f-position" min="1" max="15"  value="1" /></label>
          </div>

          <div class="form-info" id="fleet-wormhole-info" style="margin-top:0.4rem;">
            <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="checkbox" id="f-use-wormhole" />
              Use Wormhole Jump (requires Wormhole Theory Lv5 and active route)
            </label>
          </div>

          <div id="fleet-ftl-status" style="margin-top:0.4rem;padding:0.4rem 0.6rem;border-radius:4px;background:rgba(0,0,0,0.15);font-size:0.82rem;"></div>

          <h3>4. Cargo (optional)</h3>
          <div class="cargo-inputs">
            <label>Metal    <input type="number" id="f-cargo-metal"   min="0" value="0" /></label>
            <label>Crystal  <input type="number" id="f-cargo-crystal" min="0" value="0" /></label>
            <label>Deuterium<input type="number" id="f-cargo-deut"    min="0" value="0" /></label>
          </div>

          <div id="fleet-default-hint" class="form-info"></div>

          <button type="submit" class="btn btn-primary">Launch Fleet</button>
          <div id="fleet-send-result-wm" class="form-info" aria-live="polite"></div>
        </form>`;

        try {
          const [data, wormholeData, ftlData] = await Promise.all([
            api.ships(currentColony.id),
            api.wormholes(currentColony.id).catch(() => ({ success: false, wormholes: [], wormhole_theory_level: 0, can_jump: false })),
            api.ftlStatus().catch(() => null),
          ]);
          const shipEl = root.querySelector('#fleet-ship-select-wm');
          if (!data.success) {
            shipEl.innerHTML = '<p class="text-red">Error.</p>';
            return;
          }
          statusPanelsHelper.applyWormholeInfo(root, wormholeData);
          statusPanelsHelper.applyFtlStatus(root, ftlData);

          const avail = [...(data.ships || []), ...(data.blueprints || [])].filter((ship) => Number(ship.count || 0) > 0);
          if (!avail.length) {
            shipEl.innerHTML = '<p class="text-muted">No ships on this planet.</p>';
            return;
          }
          shipEl.innerHTML = `<div class="ship-selector-grid">${avail.map((ship) => `
          <div class="ship-selector-row">
            <span>${esc(ship.name || fmtName(ship.type))}${ship.ship_class ? ` | ${esc(fmtName(ship.ship_class))}` : ''} (${ship.count})</span>
            <input type="number" class="fleet-ship-qty" data-type="${esc(ship.type)}"
                   min="0" max="${ship.count}" value="0" />
          </div>`).join('')}</div>`;
          const uiState = getUiState();
          this.bindMissionDefaults(root, avail);
          this.applyMissionDefaults(root, avail, uiState.fleetPrefill);
        } catch (err) {
          gameLog('info', 'Fleet mission defaults konnten nicht initialisiert werden', err);
        }

        submitFlowHelper.bindSubmit(root, (submitRoot) => {
          return this.buildPayload(submitRoot);
        });
      },
    };
  }

  const api = { createFleetController };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeFleetController = api;
  }
})();