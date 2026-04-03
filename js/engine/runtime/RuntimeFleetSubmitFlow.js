'use strict';

(function () {
  function createFleetSubmitFlowHelper(opts = {}) {
    const {
      api = null,
      getCurrentColony = () => null,
      getAudioManager = () => null,
      loadOverview = async () => {},
      showToast = () => {},
      gameLog = () => {},
    } = opts;

    return {
      buildPayload(root) {
        const currentColony = getCurrentColony();
        const ships = {};
        root.querySelectorAll('.fleet-ship-qty').forEach((inp) => {
          const count = parseInt(inp.value, 10);
          if (count > 0) ships[inp.dataset.type] = count;
        });

        return {
          origin_colony_id: currentColony.id,
          target_galaxy: parseInt(root.querySelector('#f-galaxy').value, 10),
          target_system: parseInt(root.querySelector('#f-system').value, 10),
          target_position: parseInt(root.querySelector('#f-position').value, 10),
          mission: root.querySelector('input[name="mission"]:checked')?.value,
          use_wormhole: !!root.querySelector('#f-use-wormhole')?.checked,
          ships,
          cargo: {
            metal: parseFloat(root.querySelector('#f-cargo-metal').value) || 0,
            crystal: parseFloat(root.querySelector('#f-cargo-crystal').value) || 0,
            deuterium: parseFloat(root.querySelector('#f-cargo-deut').value) || 0,
          },
        };
      },

      bindSubmit(root, buildPayload = null) {
        const formEl = root?.querySelector('#fleet-form-wm');
        if (!formEl) return;
        formEl.addEventListener('submit', async (e) => {
          e.preventDefault();
          const resultEl = root.querySelector('#fleet-send-result-wm');
          resultEl.textContent = '';

          const payload = typeof buildPayload === 'function' ? buildPayload(root) : this.buildPayload(root);
          const mission = payload.mission;
          const submitBtn = root.querySelector('button[type="submit"]');
          submitBtn.disabled = true;
          try {
            const response = await api.sendFleet(payload);
            if (response.success) {
              resultEl.className = 'form-info';
              resultEl.textContent = `Fleet launched! ETA: ${new Date(response.arrival_time).toLocaleString()}`;
              showToast('Fleet launched!', 'success');
              const audioManager = getAudioManager();
              if (audioManager && typeof audioManager.playFleetMission === 'function') audioManager.playFleetMission(mission);
              else if (audioManager && typeof audioManager.playFleetLaunch === 'function') audioManager.playFleetLaunch();
              await loadOverview();
            } else {
              resultEl.className = 'form-error';
              resultEl.textContent = response.error || 'Failed to send fleet.';
            }
          } catch (err) {
            gameLog('warn', 'Fleet send request fehlgeschlagen', err);
            resultEl.className = 'form-error';
            resultEl.textContent = 'Network error.';
          }
          submitBtn.disabled = false;
        });
      },
    };
  }

  const api = { createFleetSubmitFlowHelper };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeFleetSubmitFlow = api;
  }
})();