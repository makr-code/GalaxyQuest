'use strict';
(function () {
  function createLeadersController(opts = {}) {
    const wm = opts.wm;
    const api = opts.api;
    const documentRef = opts.documentRef || document;
    const esc = opts.esc || ((v) => String(v ?? ''));
    const showToast = opts.showToast || (() => {});
    const getColonies = typeof opts.getColonies === 'function' ? opts.getColonies : (() => []);
    const getAdvisorWidget = typeof opts.getAdvisorWidget === 'function' ? opts.getAdvisorWidget : (() => null);

    class LeadersController {
      constructor() {
        this._tab = 'my_leaders';
        this.roleLabel = {
          colony_manager: 'Colony Manager',
          fleet_commander: 'Fleet Commander',
          science_director: 'Science Director',
          diplomacy_officer: 'Diplomacy Officer',
          trade_director: 'Trade Director',
          advisor: 'Advisor',
        };
        this.rarityLabel = {
          common: 'Common',
          uncommon: 'Uncommon',
          rare: 'Rare',
          legendary: 'Legendary',
        };
        this._styleInjected = false;
      }

      _injectCardStyles() {
        if (this._styleInjected) return;
        this._styleInjected = true;
        const styleNode = documentRef.createElement('style');
        styleNode.textContent = `
          .leader-tab-bar { display:flex; gap:0.5rem; margin-bottom:0.9rem; border-bottom:1px solid var(--border,#333); padding-bottom:0.4rem; }
          .leader-tab-btn { background:none; border:none; color:var(--text-secondary,#aaa); cursor:pointer; padding:0.3rem 0.8rem; border-radius:4px 4px 0 0; font-size:0.85rem; }
          .leader-tab-btn.active { background:var(--accent,#4a9eff22); color:var(--accent,#4a9eff); border-bottom:2px solid var(--accent,#4a9eff); }
          .mkt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:0.75rem; }
          .leader-card { background:var(--panel-bg,#1a1a2e); border:1px solid var(--border,#333); border-radius:8px; padding:0.75rem; display:flex; flex-direction:column; gap:0.3rem; position:relative; }
          .leader-card.rarity-uncommon { border-color:#4fc3f7; }
          .leader-card.rarity-rare { border-color:#a78bfa; }
          .leader-card.rarity-legendary { border-color:#f59e0b; box-shadow:0 0 10px #f59e0b44; }
          .leader-card.is-hired { opacity:0.55; }
          .leader-portrait-lg { font-size:2.2rem; line-height:1; display:block; text-align:center; }
          .rarity-badge { font-size:0.64rem; font-weight:700; text-transform:uppercase; padding:1px 5px; border-radius:3px; position:absolute; top:0.45rem; right:0.45rem; }
          .rarity-badge.rarity-common { background:#555; color:#ddd; }
          .rarity-badge.rarity-uncommon { background:#0c4a6e; color:#7dd3fc; }
          .rarity-badge.rarity-rare { background:#3b0764; color:#c4b5fd; }
          .rarity-badge.rarity-legendary { background:#78350f; color:#fcd34d; }
          .leader-card-name { font-weight:700; font-size:0.95rem; margin-top:0.2rem; }
          .leader-card-role { font-size:0.72rem; color:var(--text-secondary,#aaa); }
          .leader-card-tagline { font-size:0.74rem; font-style:italic; color:var(--accent,#4a9eff); margin-top:0.2rem; line-height:1.3; }
          .leader-card-traits { display:flex; flex-wrap:wrap; gap:0.25rem; margin-top:0.25rem; }
          .chip-trait { font-size:0.66rem; background:#333; color:#ccc; padding:1px 6px; border-radius:20px; }
          .skill-bar-row { display:flex; align-items:center; gap:0.3rem; margin-bottom:0.1rem; }
          .skill-bar-label { font-size:0.65rem; color:var(--text-secondary,#aaa); width:72px; flex-shrink:0; }
          .skill-bar-track { flex:1; height:4px; background:#333; border-radius:2px; overflow:hidden; }
          .skill-bar-fill { height:100%; background:var(--accent,#4a9eff); border-radius:2px; transition:width 0.3s; }
          .leader-card-cost { font-size:0.75rem; color:#ccc; margin-top:0.3rem; }
          .leader-card-free { color:#4ade80; font-style:italic; }
          .advisor-hint-card { background:var(--panel-bg,#1a1a2e); border-left:3px solid var(--accent,#4a9eff); border-radius:0 6px 6px 0; padding:0.6rem 0.75rem; margin-bottom:0.5rem; }
          .advisor-hint-card.hint-warning { border-left-color:#f59e0b; }
          .advisor-hint-card.hint-quest_hint { border-left-color:#a78bfa; }
          .advisor-hint-card.hint-action_required { border-left-color:#ef4444; }
          .advisor-hint-title { font-weight:700; font-size:0.85rem; }
          .advisor-hint-body { font-size:0.78rem; color:var(--text-secondary,#aaa); margin-top:0.2rem; }
          #advisor-widget { position:fixed; bottom:3.2rem; left:0.8rem; z-index:900; }
          #advisor-bubble { background:var(--panel-bg,#1a1a2e); border:1px solid var(--accent,#4a9eff); border-radius:10px; padding:0.4rem 0.65rem; display:flex; align-items:center; gap:0.5rem; cursor:pointer; box-shadow:0 2px 12px #00000066; min-width:48px; }
          #advisor-bubble:hover { border-color:#7dd3fc; }
          #advisor-bubble-portrait { font-size:1.4rem; }
          #advisor-bubble-info { display:flex; flex-direction:column; line-height:1.2; }
          #advisor-bubble-name { font-size:0.7rem; font-weight:700; color:#ccc; }
          #advisor-bubble-badge { font-size:0.65rem; color:var(--accent,#4a9eff); }
        `;
        documentRef.head.appendChild(styleNode);
      }

      renderTabs(active) {
        return `<div class="leader-tab-bar">
          <button class="leader-tab-btn ${active === 'my_leaders' ? 'active' : ''}" data-tab="my_leaders">My Leaders</button>
          <button class="leader-tab-btn ${active === 'marketplace' ? 'active' : ''}" data-tab="marketplace">Marketplace</button>
        </div>`;
      }

      renderMyLeaders(leaders) {
        const hasAdvisor = leaders.some((leader) => leader.role === 'advisor');
        const nonAdvisors = leaders.filter((leader) => leader.role !== 'advisor');
        const advisors = leaders.filter((leader) => leader.role === 'advisor');
        const colonies = getColonies();

        return `
          ${!hasAdvisor ? `<div style="background:#1e3a2f;border:1px solid #4ade8066;border-radius:6px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.8rem;">
            <strong>No Advisor yet.</strong> Visit the <span style="color:var(--accent)">Marketplace</span> tab to hire a free Advisor who will guide you through the game.
          </div>` : ''}

          ${advisors.length ? `<div style="margin-bottom:0.75rem">
            <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.05em">Advisor</div>
            ${advisors.map((leader) => `
              <div style="display:flex;align-items:center;gap:0.6rem;background:var(--panel-bg,#1a1a2e);border:1px solid var(--accent,#4a9eff);border-radius:7px;padding:0.5rem 0.75rem;">
                <span style="font-size:1.6rem">${esc(leader.portrait || '')}</span>
                <div style="flex:1">
                  <div style="font-weight:700">${esc(leader.name)}</div>
                  <div style="font-size:0.72rem;color:var(--text-secondary)">${this.rarityLabel[leader.rarity] || ''} - Lv ${leader.level}</div>
                  ${leader.tagline ? `<div style="font-size:0.73rem;font-style:italic;color:var(--accent)">${esc(leader.tagline)}</div>` : ''}
                </div>
                <button class="btn btn-danger btn-sm dismiss-btn" data-lid="${leader.id}" title="Dismiss">X</button>
              </div>`).join('')}
          </div>` : ''}

          <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.05em">Officers</div>
          <table class="data-table" style="width:100%;font-size:0.8rem">
            <thead><tr>
              <th></th><th>Name</th><th>Role</th><th>Lv</th><th>Assignment</th>
              <th>Autonomy</th><th>Last Action</th><th></th>
            </tr></thead>
            <tbody>
            ${nonAdvisors.length ? nonAdvisors.map((leader) => `
              <tr>
                <td style="font-size:1.2rem;text-align:center">${esc(leader.portrait || '')}</td>
                <td>
                  ${esc(leader.name)}
                  ${leader.rarity && leader.rarity !== 'common' ? `<span class="rarity-badge rarity-${leader.rarity}" style="position:static;margin-left:4px">${this.rarityLabel[leader.rarity]}</span>` : ''}
                </td>
                <td>${this.roleLabel[leader.role] ?? leader.role}</td>
                <td>${leader.level}</td>
                <td>${leader.colony_name
                  ? `${esc(leader.colony_name)} [${esc(leader.colony_coords || '?')}]`
                  : leader.fleet_id ? `Fleet #${leader.fleet_id}` : '<em>Unassigned</em>'}</td>
                <td>
                  <select class="input-sm autonomy-sel" data-lid="${leader.id}">
                    <option value="0" ${+leader.autonomy === 0 ? 'selected' : ''}>Off</option>
                    <option value="1" ${+leader.autonomy === 1 ? 'selected' : ''}>Suggest</option>
                    <option value="2" ${+leader.autonomy === 2 ? 'selected' : ''}>Full Auto</option>
                  </select>
                </td>
                <td style="font-size:0.72rem;max-width:170px;overflow:hidden;text-overflow:ellipsis" title="${esc(leader.last_action || '')}">
                  ${leader.last_action ? esc(leader.last_action.substring(0, 55)) + '...' : '-'}
                </td>
                <td style="white-space:nowrap">
                  <select class="input-sm assign-col-sel" data-lid="${leader.id}">
                    <option value="">- Colony -</option>
                    ${colonies.map((colony) => `<option value="${colony.id}">${esc(colony.name)}</option>`).join('')}
                  </select>
                  <button class="btn btn-secondary btn-sm assign-col-btn" data-lid="${leader.id}">Assign</button>
                  <button class="btn btn-danger btn-sm dismiss-btn" data-lid="${leader.id}">X</button>
                </td>
              </tr>`).join('')
            : '<tr><td colspan="8" class="text-muted">No officers hired yet - visit the Marketplace.</td></tr>'}
            </tbody>
          </table>
          <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="ai-tick-btn">Run AI Tick</button>
          </div>`;
      }

      renderMarketplace(candidates) {
        const available = candidates.filter((candidate) => !candidate.is_hired);
        const hired = candidates.filter((candidate) => candidate.is_hired);
        const expiresAt = candidates[0]?.expires_at;

        return `
          <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.65rem">
            <strong>Marketplace</strong> - ${available.length} candidate(s) available.
            ${expiresAt ? `Refreshes at <strong>${String(expiresAt).substring(0, 16)}</strong>.` : ''}
          </div>
          ${available.length === 0 ? '<p class="text-muted">Marketplace is empty. Come back in 24 hours.</p>' : ''}
          <div class="mkt-grid">
            ${[...available, ...hired].map((candidate) => this.renderCard(candidate)).join('')}
          </div>`;
      }

      renderCard(candidate) {
        const isHired = !!+candidate.is_hired;
        const skills = this._skillsForRole(candidate.role, candidate);
        const mt = +candidate.hire_metal;
        const cr = +candidate.hire_crystal;
        const dt = +candidate.hire_deuterium;
        const free = mt === 0 && cr === 0 && dt === 0;
        return `
          <div class="leader-card rarity-${candidate.rarity} ${isHired ? 'is-hired' : ''}">
            <span class="rarity-badge rarity-${candidate.rarity}">${this.rarityLabel[candidate.rarity]}</span>
            <span class="leader-portrait-lg">${esc(candidate.portrait || '')}</span>
            <div class="leader-card-name">${esc(candidate.name)}</div>
            <div class="leader-card-role">${this.roleLabel[candidate.role] ?? candidate.role}</div>
            <div class="leader-card-tagline">${esc(candidate.tagline)}</div>
            <div class="leader-card-traits">
              ${candidate.trait_1 ? `<span class="chip-trait">${esc(candidate.trait_1)}</span>` : ''}
              ${candidate.trait_2 ? `<span class="chip-trait">${esc(candidate.trait_2)}</span>` : ''}
            </div>
            <div style="margin-top:0.3rem">
              ${skills.map((skill) => `
                <div class="skill-bar-row">
                  <span class="skill-bar-label">${esc(skill.label)}</span>
                  <div class="skill-bar-track"><div class="skill-bar-fill" style="width:${Math.round(+skill.val / 10 * 100)}%"></div></div>
                  <span style="font-size:0.65rem;color:#aaa;width:16px;text-align:right">${skill.val}</span>
                </div>`).join('')}
            </div>
            <details style="margin-top:0.35rem">
              <summary style="cursor:pointer;font-size:0.7rem;color:var(--text-secondary)">Background</summary>
              <p style="font-size:0.73rem;color:var(--text-secondary);margin-top:0.25rem;line-height:1.35">${esc(candidate.backstory)}</p>
            </details>
            <div class="leader-card-cost" style="margin-top:0.4rem">
              ${free
                ? '<span class="leader-card-free">Free</span>'
                : [mt > 0 ? `${(mt / 1000).toFixed(0)}k M` : '', cr > 0 ? `${(cr / 1000).toFixed(0)}k C` : '', dt > 0 ? `${(dt / 1000).toFixed(0)}k D` : ''].filter(Boolean).join(' ')}
            </div>
            ${isHired
              ? '<button class="btn btn-secondary btn-sm" style="margin-top:0.4rem" disabled>Hired</button>'
              : `<button class="btn btn-primary btn-sm hire-candidate-btn" data-cid="${candidate.id}" style="margin-top:0.4rem">Hire</button>`}
          </div>`;
      }

      _skillsForRole(role, candidate) {
        const map = {
          colony_manager: [{ label: 'Production', val: candidate.skill_production }, { label: 'Construction', val: candidate.skill_construction }],
          fleet_commander: [{ label: 'Tactics', val: candidate.skill_tactics }, { label: 'Navigation', val: candidate.skill_navigation }],
          science_director: [{ label: 'Research', val: candidate.skill_research }, { label: 'Efficiency', val: candidate.skill_efficiency }],
          diplomacy_officer: [{ label: 'Efficiency', val: candidate.skill_efficiency }, { label: 'Guidance', val: candidate.skill_guidance }],
          trade_director: [{ label: 'Efficiency', val: candidate.skill_efficiency }, { label: 'Production', val: candidate.skill_production }],
          advisor: [{ label: 'Guidance', val: candidate.skill_guidance }, { label: 'Research', val: candidate.skill_research }],
        };
        return map[role] || [{ label: 'Skill', val: 1 }];
      }

      bindTabs(root) {
        root.querySelectorAll('.leader-tab-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            this._tab = btn.dataset.tab;
            wm.refresh('leaders');
          });
        });
      }

      bindHireButtons(root) {
        root.querySelectorAll('.hire-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const role = btn.dataset.role;
            const nameEl = root.querySelector(`.hire-name[data-role="${role}"]`);
            const name = nameEl?.value.trim();
            if (!name) {
              showToast('Enter a name first.', 'error');
              return;
            }
            const response = await api.hireLeader(name, role);
            if (response.success) {
              showToast(response.message, 'success');
              wm.refresh('leaders');
            } else {
              showToast(response.error || 'Failed', 'error');
            }
          });
        });
      }

      bindHireCandidateButtons(root) {
        root.querySelectorAll('.hire-candidate-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const cid = parseInt(btn.dataset.cid, 10);
            btn.disabled = true;
            const response = await api.hireCandidate(cid);
            if (response.success) {
              showToast(response.message, 'success');
              wm.refresh('leaders');
              const advisorWidget = getAdvisorWidget();
              if (advisorWidget && typeof advisorWidget.maybeRefresh === 'function') {
                advisorWidget.maybeRefresh();
              }
            } else {
              showToast(response.error || 'Hire failed.', 'error');
              btn.disabled = false;
            }
          });
        });
      }

      bindAutonomyControls(root) {
        root.querySelectorAll('.autonomy-sel').forEach((sel) => {
          sel.addEventListener('change', async () => {
            const response = await api.setAutonomy(parseInt(sel.dataset.lid, 10), parseInt(sel.value, 10));
            if (response.success) showToast(response.message, 'info');
            else showToast(response.error, 'error');
          });
        });
      }

      bindAssignmentControls(root) {
        root.querySelectorAll('.assign-col-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const lid = parseInt(btn.dataset.lid, 10);
            const sel = root.querySelector(`.assign-col-sel[data-lid="${lid}"]`);
            const cid = sel?.value ? parseInt(sel.value, 10) : null;
            const response = await api.assignLeader(lid, cid, null);
            if (response.success) {
              showToast(response.message, 'success');
              wm.refresh('leaders');
            } else {
              showToast(response.error, 'error');
            }
          });
        });
      }

      bindDismissControls(root) {
        root.querySelectorAll('.dismiss-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Dismiss this leader?')) return;
            const response = await api.dismissLeader(parseInt(btn.dataset.lid, 10));
            if (response.success) {
              showToast(response.message, 'success');
              wm.refresh('leaders');
              const advisorWidget = getAdvisorWidget();
              if (advisorWidget && typeof advisorWidget.maybeRefresh === 'function') {
                advisorWidget.maybeRefresh();
              }
            } else {
              showToast(response.error, 'error');
            }
          });
        });
      }

      bindAiTick(root) {
        root.querySelector('#ai-tick-btn')?.addEventListener('click', async () => {
          const response = await api.aiTick();
          if (!response.success) return;
          const actions = response.actions || [];
          showToast(actions.length ? `AI: ${actions[0]}` : 'AI: No actions taken.', 'info');
          wm.refresh('leaders');
        });
      }

      bindActions(root) {
        this.bindHireButtons(root);
        this.bindAutonomyControls(root);
        this.bindAssignmentControls(root);
        this.bindDismissControls(root);
        this.bindAiTick(root);
      }

      async render() {
        const root = wm.body('leaders');
        if (!root) return;

        this._injectCardStyles();
        root.innerHTML = '<p class="text-muted">Loading...</p>';

        try {
          if (this._tab === 'marketplace') {
            const marketplace = await api.leaderMarketplace();
            if (!marketplace.success) {
              root.innerHTML = '<p class="error">Marketplace unavailable.</p>';
              return;
            }
            root.innerHTML = this.renderTabs('marketplace') + this.renderMarketplace(marketplace.candidates || []);
            this.bindTabs(root);
            this.bindHireCandidateButtons(root);
            return;
          }

          const data = await api.leaders();
          if (!data.success) {
            root.innerHTML = '<p class="error">Failed to load leaders.</p>';
            return;
          }
          root.innerHTML = this.renderTabs('my_leaders') + this.renderMyLeaders(data.leaders || []);
          this.bindTabs(root);
          this.bindActions(root);
        } catch (error) {
          root.innerHTML = `<p class="error">${esc(String(error))}</p>`;
        }
      }
    }

    return new LeadersController();
  }

  const api = {
    createLeadersController,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeLeadersController = api;
  }
})();
