/**
 * RuntimeOverviewBootstrap.js
 *
 * Central bootstrap wiring for Overview runtime modules.
 */

'use strict';

(function () {
  function createOverviewBootstrap(opts = {}) {
    const runtimeOverviewInsightsApi = opts.runtimeOverviewInsightsApi || {};
    const runtimeOverviewListsApi = opts.runtimeOverviewListsApi || {};
    const runtimeOverviewActionsApi = opts.runtimeOverviewActionsApi || {};
    const runtimeOverviewControllerApi = opts.runtimeOverviewControllerApi || {};

    const overviewInsights = runtimeOverviewInsightsApi.createOverviewInsights({
      fmt: opts.fmt,
      fmtName: opts.fmtName,
      esc: opts.esc,
      getUiState: opts.getUiState,
      getCurrentColony: opts.getCurrentColony,
      getResourceInsightConfig: opts.getResourceInsightConfig,
      getResourceInsightValue: opts.getResourceInsightValue,
      getResourceInsightTotal: opts.getResourceInsightTotal,
      formatResourceInsightValue: opts.formatResourceInsightValue,
    });

    const overviewLists = runtimeOverviewListsApi.createOverviewLists({
      windowRef: opts.windowRef,
      esc: opts.esc,
      fmt: opts.fmt,
      fmtName: opts.fmtName,
      countdown: opts.countdown,
      api: opts.api,
      showToast: opts.showToast,
      getAudioManager: opts.getAudioManager,
    });

    let overviewController = null;

    const overviewActions = runtimeOverviewActionsApi.createOverviewActions({
      api: opts.api,
      wm: opts.wm,
      getUiState: opts.getUiState,
      getCurrentColony: opts.getCurrentColony,
      setCurrentColony: opts.setCurrentColony,
      getColonies: opts.getColonies,
      getPlanetSelect: opts.getPlanetSelect,
      updateResourceBar: () => overviewController.updateResourceBar(),
      renderOverview: () => overviewController.render(),
      focusColonyDevelopment: opts.focusColonyDevelopment,
      fmtName: opts.fmtName,
      showToast: opts.showToast,
      openFleetTransportPlanner: opts.openFleetTransportPlanner,
      openTradeMarketplace: opts.openTradeMarketplace,
      getAudioManager: opts.getAudioManager,
      runRiskAutoUpgrade: async (cid, focusBuilding) => overviewController.runRiskAutoUpgrade(cid, focusBuilding),
      onReload: async () => overviewController.load(),
    });

    overviewController = runtimeOverviewControllerApi.createOverviewController({
      wm: opts.wm,
      api: opts.api,
      windowRef: opts.windowRef,
      documentRef: opts.documentRef,
      getColonies: opts.getColonies,
      setColonies: opts.setColonies,
      getCurrentColony: opts.getCurrentColony,
      getPlanetSelect: opts.getPlanetSelect,
      getUiState: opts.getUiState,
      fmt: opts.fmt,
      fmtName: opts.fmtName,
      esc: opts.esc,
      showToast: opts.showToast,
      shouldRedirectOnAuthLoadError: opts.shouldRedirectOnAuthLoadError,
      redirectToLogin: opts.redirectToLogin,
      getGalaxy3d: opts.getGalaxy3d,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      focusColonyDevelopment: opts.focusColonyDevelopment,
      selectColonyById: opts.selectColonyById,
      buildWarningsHtml: (colony, offline) => opts.buildWarningsHtml(colony, offline),
      buildOfflineSummaryHtml: (offline) => overviewInsights.buildOfflineSummaryHtml(offline),
      buildResourceInsightHtml: (offline, meta) => overviewInsights.buildResourceInsightHtml(offline, meta),
      evaluateRiskUpgradeBudget: (colony, nextCost, share) => overviewInsights.evaluateRiskUpgradeBudget(colony, nextCost, share),
      riskFocusFromFlags: (flags) => overviewInsights.riskFocusFromFlags(flags),
      signed: (value, digits) => overviewInsights.signed(value, digits),
      riskLabel: (status) => overviewInsights.riskLabel(status),
      renderInlineTemplate: opts.renderInlineTemplate,
      renderInlineTemplateList: opts.renderInlineTemplateList,
      renderFleetListFn: (params) => overviewLists.renderFleetList(params),
      renderBattleLogFn: (params) => overviewLists.renderBattleLog(params),
      bindOverviewActionsFn: (root) => overviewActions.bindOverviewActions(root),
    });

    return {
      overviewController,
    };
  }

  const api = {
    createOverviewBootstrap,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeOverviewBootstrap = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
