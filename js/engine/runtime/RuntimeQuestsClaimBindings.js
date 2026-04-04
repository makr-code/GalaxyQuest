/**
 * RuntimeQuestsClaimBindings.js
 *
 * Binds quest claim buttons in the quests window.
 */
(function () {
  function createQuestsClaimBindings() {
    function bindClaimButtons({ root, api, showToast, loadOverview, rerenderQuests }) {
      root.querySelectorAll('.claim-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const achievementId = parseInt(btn.dataset.aid, 10);
          const result = await api.claimAchievement(achievementId);
          if (result.success) {
            showToast(result.message || '­ƒÅå Reward claimed!', 'success');
            await loadOverview();
            rerenderQuests();
          } else {
            showToast(result.error || 'Could not claim reward.', 'error');
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
