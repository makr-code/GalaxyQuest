'use strict';

(function () {
  function createOverviewActions(opts = {}) {
    const {
      api = null,
      wm = null,
      getUiState = () => ({}),
      getCurrentColony = () => null,
      setCurrentColony = () => {},
      getColonies = () => [],
      getPlanetSelect = () => null,
      updateResourceBar = () => {},
      renderOverview = () => {},
      focusColonyDevelopment = () => {},
      fmtName = (value) => String(value || ''),
      showToast = () => {},
      openFleetTransportPlanner = () => {},
      openTradeMarketplace = () => {},
      getAudioManager = () => null,
      runRiskAutoUpgrade = async () => {},
      onReload = async () => {},
    } = opts;

    function bindOverviewActions(root) {
      root.querySelectorAll('.planet-card').forEach((card) => {
        card.addEventListener('click', () => {
          const cid = parseInt(card.dataset.cid, 10);
          const colonies = getColonies();
          const nextColony = colonies.find((c) => c.id === cid) || null;
          setCurrentColony(nextColony);
          const planetSelect = getPlanetSelect();
          if (planetSelect) planetSelect.value = String(cid);
          updateResourceBar();
          renderOverview();
        });
      });

      root.querySelector('#open-leaders-btn')?.addEventListener('click', () => wm.open('leaders'));

      root.querySelectorAll('[data-resource-action="focus-building"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const currentColony = getCurrentColony();
          if (!currentColony) return;
          const focusBuilding = String(btn.getAttribute('data-resource-focus') || 'colony_hq');
          focusColonyDevelopment(currentColony.id, {
            source: 'resource-insight',
            focusBuilding,
          });
          wm.open('buildings');
          showToast(`Fokus gesetzt: ${fmtName(focusBuilding)}.`, 'info');
        });
      });

      root.querySelectorAll('[data-resource-action="transport"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openFleetTransportPlanner(String(btn.getAttribute('data-resource') || ''));
          showToast('Transportplanung geoeffnet. Ziel und Eskorte im Fleet-Fenster setzen.', 'info');
        });
      });

      root.querySelectorAll('[data-resource-action="market-buy"]').forEach((btn) => {
        btn.addEventListener('click', () => openTradeMarketplace(String(btn.getAttribute('data-resource') || ''), 'request'));
      });

      root.querySelectorAll('[data-resource-action="market-sell"]').forEach((btn) => {
        btn.addEventListener('click', () => openTradeMarketplace(String(btn.getAttribute('data-resource') || ''), 'offer'));
      });

      root.querySelectorAll('[data-resource-action="close-insight"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const uiState = getUiState();
          uiState.resourceInsight = null;
          renderOverview();
        });
      });

      root.querySelectorAll('[data-risk-action="focus"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cid = Number(btn.getAttribute('data-risk-cid') || 0);
          if (!cid) return;
          const focusBuilding = String(btn.getAttribute('data-risk-focus') || 'colony_hq');
          focusColonyDevelopment(cid, {
            source: 'economy-risk',
            focusBuilding,
          });
          const audioManager = getAudioManager();
          if (audioManager) audioManager.playUiClick();
          showToast(`Kolonie-Fokus gesetzt: ${fmtName(focusBuilding)}.`, 'info');
        });
      });

      root.querySelectorAll('[data-risk-action="auto"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const cid = Number(btn.getAttribute('data-risk-cid') || 0);
          if (!cid) return;
          const focusBuilding = String(btn.getAttribute('data-risk-focus') || 'colony_hq');
          btn.disabled = true;
          const prevLabel = btn.textContent;
          btn.textContent = '...';
          try {
            await runRiskAutoUpgrade(cid, focusBuilding);
            const audioManager = getAudioManager();
            if (audioManager) audioManager.playUiConfirm();
          } catch (err) {
            showToast(String(err?.message || err || 'Auto-Upgrade fehlgeschlagen.'), 'error');
            const audioManager = getAudioManager();
            if (audioManager) audioManager.playUiError();
          } finally {
            btn.disabled = false;
            btn.textContent = prevLabel || 'Auto +1';
          }
        });
      });

      // Warning Fix Buttons (Problem Pre-Warnings)
      root.querySelectorAll('[data-warning-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cid = Number(btn.getAttribute('data-warning-cid') || 0);
          const focusBuilding = String(btn.getAttribute('data-warning-action') || 'colony_hq');
          if (!cid) return;

          const colonies = getColonies();
          const targetColony = colonies.find((c) => Number(c.id || 0) === cid);
          if (!targetColony) {
            showToast('Colony not found.', 'error');
            return;
          }

          setCurrentColony(targetColony);
          const planetSelect = getPlanetSelect();
          if (planetSelect) planetSelect.value = String(cid);
          updateResourceBar();

          focusColonyDevelopment(cid, {
            source: 'problem-warning',
            focusBuilding,
          });

          wm.open('buildings');
          const audioManager = getAudioManager();
          if (audioManager) audioManager.playUiClick();
          showToast(`Opening ${fmtName(focusBuilding)} for repair...`, 'info');
        });
      });

      root.querySelector('#pvp-toggle-btn')?.addEventListener('click', async () => {
        const response = await api.togglePvp();
        if (response.success) {
          const audioManager = getAudioManager();
          if (audioManager && typeof audioManager.playPvpToggle === 'function') audioManager.playPvpToggle();
          showToast(response.pvp_mode ? 'PvP enabled!' : 'PvP disabled.', 'info');
          await onReload();
        } else {
          showToast(response.error || 'Could not toggle PvP.', 'error');
        }
      });
    }

    return {
      bindOverviewActions,
    };
  }

  const api = { createOverviewActions };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeOverviewActions = api;
  }
})();