/**
 * RuntimeQuestsRenderFacade.js
 *
 * Single entry point for quests rendering flow.
 */
(function () {
  function setTextMessage(root, className, text) {
    const message = root.ownerDocument.createElement('p');
    message.className = className;
    message.textContent = text;
    root.replaceChildren(message);
  }

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
      setTextMessage(root, 'text-muted', 'Loading…');

      try {
        const check = await api.checkAchievements();
        if (!check.success) {
          setTextMessage(root, 'text-red', 'Error updating quests.');
          return;
        }
        const data = await api.achievements();
        if (!data.success) {
          setTextMessage(root, 'text-red', 'Error loading quests.');
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
          });
        }

        if (html) root.innerHTML = html;
        else setTextMessage(root, 'text-muted', 'No quests found.');

        questsClaimBindings.bindClaimButtons({
          root,
          api,
          showToast,
          loadOverview,
          rerenderQuests,
        });
      } catch (error) {
        setTextMessage(root, 'text-red', 'Failed to load quests.');
        if (typeof showToast === 'function') showToast('Failed to load quests.', 'error');
        if (typeof console !== 'undefined') console.error('Quest rendering failed', error);
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
