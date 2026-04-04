/**
 * RuntimeQuestsRenderContext.js
 *
 * Builds the argument object for RuntimeQuestsRenderFacade.
 */
(function () {
  function createQuestsRenderContextBuilder() {
    function build({
      wm,
      api,
      questsDataModelBuilder,
      questsCardTemplateBuilder,
      questsGroupTemplateBuilder,
      questsClaimBindings,
      esc,
      fmt,
      showToast,
      loadOverview,
      rerenderQuests,
    }) {
      return {
        wm,
        api,
        questsDataModelBuilder,
        questsCardTemplateBuilder,
        questsGroupTemplateBuilder,
        questsClaimBindings,
        esc,
        fmt,
        showToast,
        loadOverview,
        rerenderQuests,
      };
    }

    return { build };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQuestsRenderContextBuilder };
  } else {
    window.GQRuntimeQuestsRenderContext = { createQuestsRenderContextBuilder };
  }
})();
