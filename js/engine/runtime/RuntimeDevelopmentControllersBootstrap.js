/**
 * RuntimeDevelopmentControllersBootstrap.js
 *
 * Central bootstrap wiring for development-facing controllers.
 */

'use strict';

(function () {
  function createDevelopmentControllersBootstrap(opts = {}) {
    const runtimeColonyViewControllerApi = opts.runtimeColonyViewControllerApi || {};
    const runtimeEconomyFlowControllerApi = opts.runtimeEconomyFlowControllerApi || {};
    const runtimeEconomyControllerApi = opts.runtimeEconomyControllerApi || {};
    const runtimeBuildingUpgradePreviewApi = opts.runtimeBuildingUpgradePreviewApi || {};
    const runtimeBuildingsControllerApi = opts.runtimeBuildingsControllerApi || {};
    const runtimeResearchControllerApi = opts.runtimeResearchControllerApi || {};
    const runtimeShipyardControllerApi = opts.runtimeShipyardControllerApi || {};

    const colonyViewController = runtimeColonyViewControllerApi.createColonyViewController({
      wm: opts.wm,
      api: opts.api,
      getCurrentColony: opts.getCurrentColony,
      getUiState: opts.getUiState,
      buildColonyGridCells: opts.buildColonyGridCells,
      buildingZoneLabel: opts.buildingZoneLabel,
      pickZoneBuildFocus: opts.pickZoneBuildFocus,
      getBuildingUiMeta: opts.getBuildingUiMeta,
      getRecommendedBuildingFocus: opts.getRecommendedBuildingFocus,
      selectColonyById: opts.selectColonyById,
      focusColonyDevelopment: opts.focusColonyDevelopment,
      queueColonySurfaceSceneData: opts.queueColonySurfaceSceneData,
      fmtName: opts.fmtName,
      esc: opts.esc,
      showToast: opts.showToast,
      gameLog: opts.gameLog,
    });

    const economyFlowController = runtimeEconomyFlowControllerApi.createEconomyFlowController({
      wm: opts.wm,
      getColonies: opts.getColonies,
      resourceInsightConfig: opts.resourceInsightConfig,
      fmtName: opts.fmtName,
      esc: opts.esc,
      fmt: opts.fmt,
      selectColonyById: opts.selectColonyById,
      gameLog: opts.gameLog,
    });

    const runtimeBuildingUpgradePreview = runtimeBuildingUpgradePreviewApi.createBuildingUpgradePreview({
      fmt: opts.fmt,
      fmtName: opts.fmtName,
      esc: opts.esc,
      getCurrentColony: opts.getCurrentColony,
    });

    const simulateBuildingUpgrade = runtimeBuildingUpgradePreview.simulateBuildingUpgrade;
    const buildUpgradePreviewModal = runtimeBuildingUpgradePreview.buildUpgradePreviewModal;

    const buildingsController = runtimeBuildingsControllerApi.createBuildingsController({
      wm: opts.wm,
      api: opts.api,
      windowRef: opts.windowRef,
      documentRef: opts.documentRef,
      getCurrentColony: opts.getCurrentColony,
      getUiState: opts.getUiState,
      getBuildingUiMeta: opts.getBuildingUiMeta,
      fmtName: opts.fmtName,
      fmt: opts.fmt,
      esc: opts.esc,
      countdown: opts.countdown,
      simulateBuildingUpgrade,
      buildUpgradePreviewModal,
      queueColonySurfaceSceneData: opts.queueColonySurfaceSceneData,
      updateResourceBar: opts.updateResourceBar,
      showToast: opts.showToast,
      gameLog: opts.gameLog,
    });

    const researchController = runtimeResearchControllerApi.createResearchController({
      wm: opts.wm,
      api: opts.api,
      getCurrentColony: opts.getCurrentColony,
      getAudioManager: opts.getAudioManager,
      fmtName: opts.fmtName,
      fmt: opts.fmt,
      esc: opts.esc,
      countdown: opts.countdown,
      updateResourceBar: opts.updateResourceBar,
      showToast: opts.showToast,
      gameLog: opts.gameLog,
    });

    function gqStatusMsg(el, msg, type) {
      const p = opts.documentRef.createElement('p');
      p.className = 'text-' + type;
      p.textContent = msg;
      el.replaceChildren(p);
    }

    const shipyardController = runtimeShipyardControllerApi.createShipyardController({
      wm: opts.wm,
      api: opts.api,
      windowRef: opts.windowRef,
      documentRef: opts.documentRef,
      getCurrentColony: opts.getCurrentColony,
      updateResourceBar: opts.updateResourceBar,
      fmt: opts.fmt,
      fmtName: opts.fmtName,
      esc: opts.esc,
      countdown: opts.countdown,
      showToast: opts.showToast,
      gameLog: opts.gameLog,
      gqStatusMsg,
      GQUI: opts.GQUI,
    });

    const economyController = runtimeEconomyControllerApi.createEconomyController
      ? runtimeEconomyControllerApi.createEconomyController({
          wm: opts.wm,
          api: opts.api,
          esc: opts.esc,
          showToast: opts.showToast,
          gameLog: opts.gameLog,
          invalidateGetCache: opts.invalidateGetCache,
        })
      : null;

    return {
      colonyViewController,
      economyFlowController,
      economyController,
      buildingsController,
      researchController,
      shipyardController,
    };
  }

  const api = {
    createDevelopmentControllersBootstrap,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeDevelopmentControllersBootstrap = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
