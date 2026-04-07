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
      // Shared post-claim handler
      async function handleClaimResult(btn, promise, successMsg) {
        btn.disabled = true;
        const result = await promise;
        if (result.success) {
          showToast(result.message || successMsg, 'success');
          await loadOverview();
          rerenderQuests();
        } else {
          showToast(result.error || 'Belohnung konnte nicht abgerufen werden.', 'error');
          btn.disabled = false;
        }
      }

      // ── Achievement claim buttons ────────────────────────────────────────────
      root.querySelectorAll('.claim-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const achievementId = parseInt(btn.dataset.aid, 10);
          handleClaimResult(btn, api.claimAchievement(achievementId), '🏅 Reward claimed!');
        });
      });

      // ── Faction quest claim buttons ──────────────────────────────────────────
      root.querySelectorAll('.faction-claim-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const userQuestId = parseInt(btn.dataset.uqid, 10);
          handleClaimResult(btn, api.claimFactionQuest(userQuestId), '🌐 Auftragsbelohnung erhalten!');
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
