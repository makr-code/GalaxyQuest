/**
 * RuntimeQuestsClaimBindings.js
 *
 * Binds quest claim buttons in the quests window.
 * Handles both achievement claim buttons (.claim-btn) and faction quest claim
 * buttons (.faction-claim-btn), routing each to the correct API call.
 */
(function () {
  function createQuestsClaimBindings() {
    function bindClaimButtons({ root, api, showToast, loadOverview, rerenderQuests }) {
      // ── Achievement claim buttons ────────────────────────────────────────────
      root.querySelectorAll('.claim-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const achievementId = parseInt(btn.dataset.aid, 10);
          const result = await api.claimAchievement(achievementId);
          if (result.success) {
            showToast(result.message || '🏅 Reward claimed!', 'success');
            await loadOverview();
            rerenderQuests();
          } else {
            showToast(result.error || 'Could not claim reward.', 'error');
            btn.disabled = false;
          }
        });
      });

      // ── Faction quest claim buttons ──────────────────────────────────────────
      root.querySelectorAll('.faction-claim-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const userQuestId = parseInt(btn.dataset.uqid, 10);
          const result = await api.claimFactionQuest(userQuestId);
          if (result.success) {
            showToast(result.message || '🌐 Auftragsbelohnung erhalten!', 'success');
            await loadOverview();
            rerenderQuests();
          } else {
            showToast(result.error || 'Belohnung konnte nicht abgerufen werden.', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    return { bindClaimButtons };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQuestsClaimBindings };
  } else {
    window.GQRuntimeQuestsClaimBindings = { createQuestsClaimBindings };
  }
})();
