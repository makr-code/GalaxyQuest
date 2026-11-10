/**
 * RuntimeQuestsCardTemplate.js
 *
 * Builds one quest card HTML block.
 * Handles both regular achievements (source undefined) and faction quests
 * (source === 'faction_quest'), routing claim buttons accordingly.
 */
(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  function createQuestsCardTemplateBuilder() {
    function build({ quest, fmt }) {
      const q = quest || {};
      const safeFormat = (value) => escapeHtml(fmt(value));
      const isFactionQuest = q.source === 'faction_quest';
      const progress = Number(q.progress);
      const goal = Number(q.goal);
      const pct = !Number.isFinite(goal) || goal <= 0
        ? 100
        : Number.isFinite(progress)
          ? Math.min(100, Math.max(0, Math.round((progress / goal) * 100)))
          : 0;
      const state = q.reward_claimed ? 'claimed' : q.completed ? 'claimable' : 'pending';

      const rewards = [];
      if (q.reward_metal) rewards.push(`⚙ ${safeFormat(q.reward_metal)}`);
      if (q.reward_crystal) rewards.push(`💎 ${safeFormat(q.reward_crystal)}`);
      if (q.reward_deuterium) rewards.push(`🔋 ${safeFormat(q.reward_deuterium)}`);
      if (q.reward_dark_matter) rewards.push(`✨ ${safeFormat(q.reward_dark_matter)} DM`);
      if (q.reward_rank_points) rewards.push(`⭐ ${safeFormat(q.reward_rank_points)} RP`);
      if (q.reward_standing) rewards.push(`🤝 +${escapeHtml(q.reward_standing)} Standing`);

      // Faction quests use user_quest_id; achievements use achievement id.
      const questId = numericId(q.id);
      const claimId = numericId(isFactionQuest ? q.user_quest_id : q.id);
      const claimDataAttr = claimId
        ? (isFactionQuest ? `data-uqid="${claimId}"` : `data-aid="${claimId}"`)
        : '';
      const claimClass = isFactionQuest ? 'faction-claim-btn' : 'claim-btn';

      return `
            <div class="quest-card quest-${state}" data-aid="${questId}">
              <div class="quest-header">
                <span class="quest-icon">${state==='claimed'?'✅':state==='claimable'?'📦':'🕐'}</span>
                <span class="quest-title">${escapeHtml(q.title)}</span>
              </div>
              <div class="quest-desc">${escapeHtml(q.description)}</div>
              ${state !== 'claimed' ? `
                <div class="quest-progress-wrap">
                  <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
                  <span class="quest-progress-label">${escapeHtml(q.progress)} / ${escapeHtml(q.goal)}</span>
                </div>` : ''}
              <div class="quest-footer">
                <span class="quest-rewards">${rewards.join(' &nbsp; ')}</span>
                ${state==='claimable' && claimId
                  ? `<button class="btn btn-primary btn-sm ${claimClass}" ${claimDataAttr}>✅ Claim</button>`
                  : state==='claimed'
                    ? `<span class="quest-claimed-label">Claimed ${q.completed_at && Number.isFinite(new Date(q.completed_at).getTime()) ? new Date(q.completed_at).toLocaleDateString() : ''}</span>`
                    : ''}
              </div>
            </div>`;
    }

    return { build };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQuestsCardTemplateBuilder };
  } else {
    window.GQRuntimeQuestsCardTemplate = { createQuestsCardTemplateBuilder };
  }
})();
