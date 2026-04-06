/**
 * RuntimeQuestsRenderFacade.js
 *
 * Single entry point for quests rendering flow.
 */
(function () {
  function createQuestsRenderFacade() {
    async function render({
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
      const root = wm.body('quests');
      if (!root) return;
      root.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';

      try {
        const data = await api.achievements();
        if (!data.success) {
          root.innerHTML = '<p class="text-red">Error loading quests.</p>';
          return;
        }

        const questsDataModel = questsDataModelBuilder.build({
          achievements: data.achievements,
        });
        const { groups, categoryLabels, categoryOrder } = questsDataModel;
        let html = '';

        for (const cat of categoryOrder) {
          if (!groups[cat]) continue;
          const quests = groups[cat];
          const done = quests.filter((q) => q.completed && q.reward_claimed).length;
          const claimable = quests.filter((q) => q.completed && !q.reward_claimed).length;
          let cardsHtml = '';

          for (const q of quests) {
            cardsHtml += questsCardTemplateBuilder.build({
              quest: q,
              esc,
              fmt,
            });
          }

          html += questsGroupTemplateBuilder.build({
            categoryLabel: categoryLabels[cat] ?? cat,
            done,
            total: quests.length,
            claimable,
            cardsHtml,
            esc,
          });
        }

        root.innerHTML = html || '<p class="text-muted">No quests found.</p>';

        questsClaimBindings.bindClaimButtons({
          root,
          api,
          showToast,
          loadOverview,
          rerenderQuests,
        });
      } catch (_) {
        root.innerHTML = '<p class="text-red">Failed to load quests.</p>';
      }
    }

    return { render };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQuestsRenderFacade };
  } else {
    window.GQRuntimeQuestsRenderFacade = { createQuestsRenderFacade };
  }
})();
