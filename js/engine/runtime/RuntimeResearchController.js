'use strict';

(function () {
  // ── Research UI Metadata ──────────────────────────────────────────────────
  // category: display group name; tier: prereq depth (0 = base tech);
  // icon: short label badge; desc: one-line tooltip / card description.
  const RESEARCH_UI_META = {
    // Energy
    energy_tech:            { cat: 'Energy',      tier: 0, icon: 'ENE', desc: 'Foundational energy research. Required for most tech branches.' },
    ion_tech:               { cat: 'Energy',      tier: 2, icon: 'ION', desc: 'Ion-beam technology. Unlocks ion cannons and ion drives.' },
    dark_energy_tap:        { cat: 'Energy',      tier: 3, icon: 'DRK', desc: 'Harnesses dark energy. Fusion reactor gains dark matter output.' },

    // Computing
    computer_tech:          { cat: 'Computing',   tier: 0, icon: 'CPU', desc: 'Core computing systems. Required for espionage and FTL control.' },
    espionage_tech:         { cat: 'Computing',   tier: 1, icon: 'SPY', desc: 'Spy probes and counter-intelligence.' },
    hyperspace_tech:        { cat: 'Computing',   tier: 2, icon: 'FTL', desc: 'FTL navigation algorithms. Enables hyperspace jumps.' },
    quantum_computing:      { cat: 'Computing',   tier: 3, icon: 'QTM', desc: 'Quantum processors reduce all research time by 20%.' },
    stealth_tech:           { cat: 'Computing',   tier: 3, icon: 'SLT', desc: 'Cloaking field makes fleets invisible to lower-level spy probes.' },

    // Weapons
    weapons_tech:           { cat: 'Weapons',     tier: 0, icon: 'WPN', desc: 'Basic weapons research. Required for combat upgrades.' },
    laser_tech:             { cat: 'Weapons',     tier: 1, icon: 'LSR', desc: 'Laser weapons — effective against lightly shielded targets.' },
    plasma_tech:            { cat: 'Weapons',     tier: 2, icon: 'PLS', desc: 'High-damage plasma cannons.' },

    // Defense
    shielding_tech:         { cat: 'Defense',     tier: 1, icon: 'SHD', desc: 'Deflector shields. Absorbs incoming fire before hull damage.' },
    armor_tech:             { cat: 'Defense',     tier: 1, icon: 'ARM', desc: 'Reinforced hull plating. Increases ship hull points.' },

    // Drives
    combustion_drive:       { cat: 'Drives',      tier: 1, icon: 'CMB', desc: 'Chemical propulsion. Required to unlock impulse drives.' },
    impulse_drive:          { cat: 'Drives',      tier: 2, icon: 'IMP', desc: 'Sub-light impulse drive — improves in-system fleet speed.' },
    hyperspace_drive:       { cat: 'Drives',      tier: 3, icon: 'HYP', desc: 'Dedicated FTL drive unit. Dramatically increases jump range.' },

    // Exploration
    astrophysics:           { cat: 'Exploration', tier: 3, icon: 'AST', desc: 'Deep-space observation. Required for wormhole research.' },
    intergalactic_network:  { cat: 'Exploration', tier: 4, icon: 'NET', desc: 'Galactic communications relay. Required for graviton research.' },
    graviton_tech:          { cat: 'Exploration', tier: 5, icon: 'GRV', desc: 'Graviton manipulation — endgame propulsion and weaponry.' },
    wormhole_theory:        { cat: 'Exploration', tier: 4, icon: 'WRM', desc: 'Theoretical basis for stable wormhole beacons.' },

    // Industry
    nano_materials:         { cat: 'Industry',    tier: 2, icon: 'NAN', desc: 'Nano-fabrication reduces building material costs by 15%.' },
    terraforming_tech:      { cat: 'Industry',    tier: 3, icon: 'TER', desc: 'Planetary engineering. Prerequisite for the Terraformer building.' },

    // Biology
    genetic_engineering:    { cat: 'Biology',     tier: 2, icon: 'BIO', desc: '+25% food production and +10% maximum population per colony.' },
  };

  const RESEARCH_CATEGORY_ORDER = ['Energy', 'Computing', 'Weapons', 'Defense', 'Drives', 'Exploration', 'Industry', 'Biology'];

  function getResearchUiMeta(type) {
    return RESEARCH_UI_META[String(type || '')] || { cat: 'Other', tier: 0, icon: 'RES', desc: '' };
  }

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
      updateResourceBar = () => {},
      showToast = () => {},
      gameLog = () => {},
    } = opts;

    return {
      buildCardHtml(row) {
        const meta = getResearchUiMeta(row.type);
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
        <div class="item-card research-card ${locked ? 'item-card-locked' : ''}">
          <div class="item-card-header">
            <span class="research-icon-badge" aria-label="Technology icon">${esc(meta.icon)}</span>
            <span class="item-name">${fmtName(row.type)}</span>
            <span class="item-level" aria-label="Technology level">Lv ${row.level}</span>
            <span class="research-tier-badge" title="Tech tier" aria-label="Technology tier ${meta.tier}">T${meta.tier}</span>
          </div>
          ${meta.desc ? `<div class="research-desc">${esc(meta.desc)}</div>` : ''}
          ${locked ? '<div class="item-locked-badge">\uD83D\uDD12 Locked</div>' : ''}
          <div class="item-cost">
            ${cost.metal ? `<span class="cost-metal">\u26CF\uFE0F ${fmt(cost.metal)}</span>` : ''}
            ${cost.crystal ? `<span class="cost-crystal">\uD83D\uDC8E ${fmt(cost.crystal)}</span>` : ''}
            ${cost.deuterium ? `<span class="cost-deut">\u26A1 ${fmt(cost.deuterium)}</span>` : ''}
          </div>
          ${locked && missing.length ? `<div class="item-prereq-hint" title="Prerequisites">Requires: ${esc(missingText)}</div>` : ''}
          ${busy
            ? `<div class="item-timer">\u23F1 <span data-end="${esc(row.research_end)}">${countdown(row.research_end)}</span></div>
              <div class="entity-bars" style="margin-top:0.2rem;">
                <div class="entity-bar-row" title="Research progress ${researchProgressPct}%">
                  <span class="entity-bar-label">Res</span>
                  <div class="bar-wrap"><div class="bar-fill bar-integrity ${researchTone}" style="width:${researchProgressPct}%"></div></div>
                  <span class="entity-bar-value">${researchProgressPct}%</span>
                </div>
              </div>`
            : unlocked ? `<button class="btn btn-primary btn-sm research-btn" data-type="${esc(row.type)}">Research</button>` : '<button class="btn btn-secondary btn-sm" disabled>Locked</button>'}
        </div>`;
      },

      groupByCategory(researchRows) {
        const byCategory = {};
        for (const row of researchRows) {
          const meta = getResearchUiMeta(row.type);
          (byCategory[meta.cat] ??= []).push(row);
        }
        return byCategory;
      },

      buildCardsHtml(researchRows) {
        const byCategory = this.groupByCategory(researchRows);
        const catOrder = [...RESEARCH_CATEGORY_ORDER, 'Other'];
        let html = '';
        for (const cat of catOrder) {
          const items = byCategory[cat];
          if (!items?.length) continue;
          html += `<div class="research-category">
            <h4 class="research-cat-title">${esc(cat)}</h4>
            <div class="card-grid">
              ${items.map((row) => this.buildCardHtml(row)).join('')}
            </div>
          </div>`;
        }
        return html || '<p class="text-muted">No research data.</p>';
      },

      bindActions(root) {
        root.querySelectorAll('.research-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            const currentColony = getCurrentColony();
            const response = await api.doResearch(currentColony.id, btn.dataset.type);
            if (response.success) {
              showToast(`Researching ${fmtName(btn.dataset.type)}\u2026`, 'success');
              const audioManager = getAudioManager();
              if (audioManager && typeof audioManager.playResearchStart === 'function') audioManager.playResearchStart();
              const resources = await api.resources(currentColony.id);
              if (resources?.success) Object.assign(currentColony, resources.resources);
              updateResourceBar();
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

  const api = { createResearchController, getResearchUiMeta, RESEARCH_UI_META, RESEARCH_CATEGORY_ORDER };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeResearchController = api;
  }
})();