/**
 * RuntimeSocialControllersBootstrap.js
 *
 * Central bootstrap wiring for social, intel, diplomacy and ranking controllers.
 */

'use strict';

(function () {
  function createSocialControllersBootstrap(opts = {}) {
    const runtimeMessagesControllerApi = opts.runtimeMessagesControllerApi || {};
    const runtimeIntelControllerApi = opts.runtimeIntelControllerApi || {};
    const runtimeTradeRoutesControllerApi = opts.runtimeTradeRoutesControllerApi || {};
    const runtimeTradersDashboardControllerApi = opts.runtimeTradersDashboardControllerApi || {};
    const runtimePiratesControllerApi = opts.runtimePiratesControllerApi || {};
    const runtimeAlliancesControllerApi = opts.runtimeAlliancesControllerApi || {};
    const runtimeTradeProposalsControllerApi = opts.runtimeTradeProposalsControllerApi || {};
    const runtimeLeadersControllerApi = opts.runtimeLeadersControllerApi || {};
    const runtimeFactionsControllerApi = opts.runtimeFactionsControllerApi || {};
    const runtimeLeaderboardControllerApi = opts.runtimeLeaderboardControllerApi || {};
    const runtimeWarControllerApi = opts.runtimeWarControllerApi || {};
    const runtimeColonizationControllerApi = opts.runtimeColonizationControllerApi || {};

    const messagesController = runtimeMessagesControllerApi.createMessagesController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      renderInlineTemplate: opts.renderInlineTemplate,
      renderInlineTemplateList: opts.renderInlineTemplateList,
      uiKitTemplateHTML: opts.uiKitTemplateHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      esc: opts.esc,
      gameLog: opts.gameLog,
      showToast: opts.showToast,
      getAudioManager: opts.getAudioManager,
      getMessageConsoleState: opts.getMessageConsoleState,
      updateMessageSignalsFromInbox: opts.updateMessageSignalsFromInbox,
      runtimeCommandParsingApi: opts.runtimeCommandParsingApi,
      runtimeMessageConsoleCommandApi: opts.runtimeMessageConsoleCommandApi,
      playMessageSendRef: opts.playMessageSendRef,
    });

    const intelController = runtimeIntelControllerApi.createIntelController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      esc: opts.esc,
      fmt: opts.fmt,
      fmtName: opts.fmtName,
      showToast: opts.showToast,
      getCurrentColony: opts.getCurrentColony,
    });

    const tradeRoutesController = runtimeTradeRoutesControllerApi.createTradeRoutesController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      esc: opts.esc,
      gameLog: opts.gameLog,
      invalidateGetCache: opts.invalidateGetCache,
      getResourceInsightConfig: opts.getResourceInsightConfig,
      getSuggestedTradeAmount: opts.getSuggestedTradeAmount,
      getCurrentColony: opts.getCurrentColony,
    });

    const tradersDashboardController = runtimeTradersDashboardControllerApi.createTradersDashboardController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      esc: opts.esc,
      gameLog: opts.gameLog,
      showToast: opts.showToast,
      invalidateGetCache: opts.invalidateGetCache,
    });

    const piratesController = runtimePiratesControllerApi.createPiratesController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      esc: opts.esc,
      gameLog: opts.gameLog,
      showToast: opts.showToast,
      invalidateGetCache: opts.invalidateGetCache,
    });

    const alliancesController = runtimeAlliancesControllerApi.createAlliancesController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      esc: opts.esc,
      fmt: opts.fmt,
      showToast: opts.showToast,
      invalidateGetCache: opts.invalidateGetCache,
    });

    const tradeProposalsController = runtimeTradeProposalsControllerApi.createTradeProposalsController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      esc: opts.esc,
      showToast: opts.showToast,
      getAudioManager: opts.getAudioManager,
      onLoadOverview: opts.onLoadOverview,
      getResourceInsightConfig: opts.getResourceInsightConfig,
      getSuggestedTradeAmount: opts.getSuggestedTradeAmount,
    });

    const leadersController = runtimeLeadersControllerApi.createLeadersController({
      wm: opts.wm,
      api: opts.api,
      documentRef: opts.documentRef,
      esc: opts.esc,
      showToast: opts.showToast,
      getColonies: opts.getColonies,
      getAdvisorWidget: opts.getAdvisorWidget,
    });

    const factionsController = runtimeFactionsControllerApi.createFactionsController({
      wm: opts.wm,
      api: opts.api,
      showToast: opts.showToast,
      esc: opts.esc,
      uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      onLoadOverview: opts.onLoadOverview,
      getCurrentColony: opts.getCurrentColony,
      windowRef: opts.windowRef,
    });

    const leaderboardController = runtimeLeaderboardControllerApi.createLeaderboardController({
      wm: opts.wm,
      api: opts.api,
      esc: opts.esc,
      fmt: opts.fmt,
      uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
      uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
      gameLog: opts.gameLog,
      getCurrentUser: opts.getCurrentUser,
    });

    const warController = runtimeWarControllerApi.createWarController
      ? runtimeWarControllerApi.createWarController({
          wm: opts.wm,
          api: opts.api,
          uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
          uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
          esc: opts.esc,
          gameLog: opts.gameLog,
          showToast: opts.showToast,
          invalidateGetCache: opts.invalidateGetCache,
        })
      : null;

    const colonizationController = runtimeColonizationControllerApi.createColonizationController
      ? runtimeColonizationControllerApi.createColonizationController({
          wm: opts.wm,
          api: opts.api,
          uiKitSkeletonHTML: opts.uiKitSkeletonHTML,
          uiKitEmptyStateHTML: opts.uiKitEmptyStateHTML,
          esc: opts.esc,
          gameLog: opts.gameLog,
          showToast: opts.showToast,
        })
      : null;

    return {
      messagesController,
      intelController,
      tradeRoutesController,
      tradersDashboardController,
      piratesController,
      alliancesController,
      tradeProposalsController,
      leadersController,
      factionsController,
      leaderboardController,
      warController,
      colonizationController,
    };
  }

  const api = {
    createSocialControllersBootstrap,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSocialControllersBootstrap = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
