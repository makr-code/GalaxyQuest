/**
 * RuntimeQuestsDataModel.js
 *
 * Builds grouped quest data and shared category metadata for renderQuests().
 */
(function () {
  function createQuestsDataModelBuilder() {
    function build({ achievements }) {
      const all = Array.isArray(achievements) ? achievements : [];
      const groups = {};
      for (const a of all) {
        if (!groups[a.category]) groups[a.category] = [];
        groups[a.category].push(a);
      }

      const categoryLabels = {
        faction:   '🌐 Fraktionsaufträge',
        tutorial:  '📚 Tutorial – New Player Quests',
        economy:   '💰 Economy', expansion: '🌌 Expansion',
        combat:    '⚔ Combat',   milestone: '🏅 Veteran Milestones',
      };
      const categoryOrder = ['faction', 'tutorial', 'economy', 'expansion', 'combat', 'milestone'];

      return { groups, categoryLabels, categoryOrder };
    }

    return { build };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQuestsDataModelBuilder };
  } else {
    window.GQRuntimeQuestsDataModel = { createQuestsDataModelBuilder };
  }
})();
