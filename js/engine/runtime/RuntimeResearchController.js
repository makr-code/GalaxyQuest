'use strict';

(function () {
  function createResearchController(opts = {}) {
    const {
      wm = null,
      api = null,
      getCurrentColony = () => null,
      getAudioManager = () => null,
      fmtName = (value) => String(value || ''),
      fmt = (value) => String(value || 0),
      esc = (value) => String(value || ''),
      countdown = (value) => String(value || ''),
      showToast = () => {},
      gameLog = () => {},
    } = opts;

    return {
      buildCardsHtml(researchRows) {
        return `<div class="card-grid">${researchRows.map((row) => {
          const busy = !!row.research_end;
          const unlocked = row.can_research !== false;
          const locked = !unlocked;
          const cost = row.next_cost;
          const missing = Array.isArray(row.missing_prereqs) ? row.missing_prereqs : [];
          const missingText = missing.map((m) => m.tech + ' L' + m.required_level).join(', ');
          let researchProgressPct = 0;
          let researchTone = 'is-good';
          if (busy && row.research_start && row.research_end) {
            const now = Date.now();
            const startMs = new Date(row.research_start).getTime();
            const endMs = new Date(row.research_end).getTime();
            const totalMs = endMs - startMs;
            if (totalMs > 0) {
              researchProgressPct = Math.min(100, Math.round(Math.max(0, (now - startMs) / totalMs * 100)));
              researchTone = researchProgressPct < 30 ? 'is-critical' : (researchProgressPct < 70 ? 'is-warning' : 'is-good');
            }
          }
          return `
          <div class="item-card ${locked ? 'item-card-locked' : ''}">
            <div class="item-card-header">
              <span class="item-name">${fmtName(row.type)}</span>
              <span class="item-level">Lv ${row.level}</span>
            </div>
            ${locked ? '<div class="item-locked-badge">­ƒöÆ Locked</div>' : ''}
            <div class="item-cost">
              ${cost.metal ? `<span class="cost-metal">Ô¼í ${fmt(cost.metal)}</span>` : ''}
              ${cost.crystal ? `<span class="cost-crystal">­ƒÆÄ ${fmt(cost.crystal)}</span>` : ''}
              ${cost.deuterium ? `<span class="cost-deut">­ƒöÁ ${fmt(cost.deuterium)}</span>` : ''}
            </div>
            ${locked && missing.length ? `<div class="item-prereq-hint" title="Prerequisites">Requires: ${esc(missingText)}</div>` : ''}
            ${busy
              ? `<div class="item-timer">­ƒö¼ <span data-end="${esc(row.research_end)}">${countdown(row.research_end)}</span></div>
                <div class="entity-bars" style="margin-top:0.2rem;">
                  <div class="entity-bar-row" title="Research progress ${researchProgressPct}%">
                    <span class="entity-bar-label">Res</span>
                    <div class="bar-wrap"><div class="bar-fill bar-integrity ${researchTone}" style="width:${researchProgressPct}%"></div></div>
                    <span class="entity-bar-value">${researchProgressPct}%</span>
                  </div>
                </div>`
              : unlocked ? `<button class="btn btn-primary btn-sm research-btn" data-type="${esc(row.type)}">Research</button>` : '<button class="btn btn-secondary btn-sm" disabled>Locked</button>'}
          </div>`;
        }).join('')}</div>`;
      },

      bindActions(root) {
        root.querySelectorAll('.research-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            const currentColony = getCurrentColony();
            const response = await api.doResearch(currentColony.id, btn.dataset.type);
            if (response.success) {
              showToast(`Researching ${fmtName(btn.dataset.type)}ÔÇª`, 'success');
              const audioManager = getAudioManager();
              if (audioManager && typeof audioManager.playResearchStart === 'function') audioManager.playResearchStart();
              await this.render();
            } else {
              showToast(response.error || 'Research failed', 'error');
              btn.disabled = false;
            }
          });
        });
      },

      async render() {
        const root = wm.body('research');
        if (!root) return;
        const currentColony = getCurrentColony();
        if (!currentColony) {
          root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
          return;
        }
        root.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';

        try {
          const finishResult = await api.finishResearch();
          if (finishResult?.success && Array.isArray(finishResult.completed) && finishResult.completed.length > 0) {
            const audioManager = getAudioManager();
            if (audioManager && typeof audioManager.playResearchComplete === 'function') audioManager.playResearchComplete();
            showToast(`Forschung abgeschlossen: ${finishResult.completed.map((type) => fmtName(type)).join(', ')}`, 'success');
          }
          const data = await api.research(currentColony.id);
          if (!data.success) {
            root.innerHTML = '<p class="text-red">Error.</p>';
            return;
          }

          root.innerHTML = this.buildCardsHtml(data.research || []);
          this.bindActions(root);
        } catch (err) {
          gameLog('warn', 'Research view laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to load research.</p>';
        }
      },
    };
  }

  const api = { createResearchController };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeResearchController = api;
  }
})();