/**
 * RuntimeQuestsCardTemplate.js
 *
 * Builds one quest card HTML block.
 */
(function () {
  function createQuestsCardTemplateBuilder() {
    function build({ quest, esc, fmt }) {
      const q = quest || {};
      const pct = (q.goal > 0) ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 100;
      const state = q.reward_claimed ? 'claimed' : q.completed ? 'claimable' : 'pending';

      const rewards = [];
      if (q.reward_metal) rewards.push(`Ô¼í ${fmt(q.reward_metal)}`);
      if (q.reward_crystal) rewards.push(`­ƒÆÄ ${fmt(q.reward_crystal)}`);
      if (q.reward_deuterium) rewards.push(`­ƒöÁ ${fmt(q.reward_deuterium)}`);
      if (q.reward_dark_matter) rewards.push(`Ôùå ${fmt(q.reward_dark_matter)} DM`);
      if (q.reward_rank_points) rewards.push(`Ôÿà ${fmt(q.reward_rank_points)} RP`);

      return `
            <div class="quest-card quest-${state}" data-aid="${q.id}">
              <div class="quest-header">
                <span class="quest-icon">${state==='claimed'?'Ô£à':state==='claimable'?'­ƒÄü':'Ôùï'}</span>
                <span class="quest-title">${esc(q.title)}</span>
              </div>
              <div class="quest-desc">${esc(q.description)}</div>
              ${state !== 'claimed' ? `
                <div class="quest-progress-wrap">
                  <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
                  <span class="quest-progress-label">${q.progress} / ${q.goal}</span>
                </div>` : ''}
              <div class="quest-footer">
                <span class="quest-rewards">${rewards.join(' &nbsp; ')}</span>
                ${state==='claimable'
                  ? `<button class="btn btn-primary btn-sm claim-btn" data-aid="${q.id}">Ô£¿ Claim</button>`
                  : state==='claimed'
                    ? `<span class="quest-claimed-label">Claimed ${q.completed_at ? new Date(q.completed_at).toLocaleDateString() : ''}</span>`
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
