'use strict';
(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function boundedPercent(value, fallback = 0) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
  }

  function createOverviewController({
    wm,
    api,
    windowRef,
    documentRef,
    getColonies,
    setColonies,
    getCurrentColony,
    getPlanetSelect,
    getUiState,
    fmt,
    fmtName,
    showToast,
    shouldRedirectOnAuthLoadError,
    redirectToLogin,
    getGalaxy3d,
    uiKitEmptyStateHTML,
    focusColonyDevelopment,
    selectColonyById,
    buildWarningsHtml,
    buildOfflineSummaryNode,
    buildResourceInsightNode,
    evaluateRiskUpgradeBudget,
    riskFocusFromFlags,
    signed,
    renderInlineTemplate,
    renderInlineTemplateList,
    renderFleetListFn,
    renderBattleLogFn,
    bindOverviewActionsFn,
  } = {}) {
    const esc = escapeHtml;
    const formatHtml = (value) => esc(fmt(value));
    const nameHtml = (value) => esc(fmtName(value));
    const templates = {
      fleetRow: `
          <div class="fleet-row" data-fleet-id="{{{fleetId}}}">
            {{{fleetLabelHtml}}}
            <span class="fleet-mission">{{{mission}}}</span>
            <span class="fleet-target" title="[{{{targetGalaxy}}}:{{{targetSystem}}}:{{{targetPosition}}}]">-> {{{targetSystemName}}}</span>
            {{{positionHtml}}}
            <span class="fleet-timer" data-end="{{{arrivalTimeRaw}}}">{{{arrivalCountdown}}}</span>
            {{{progressHtml}}}
            {{{fleetHealthHtml}}}
            {{{vesselListHtml}}}
            {{{returningBadgeHtml}}}
            {{{ftlBadgesHtml}}}
            {{{recallButtonHtml}}}
          </div>`,
      battleRow: `
          <div class="battle-row {{{battleClass}}}">
            <span class="battle-result">{{{resultLabel}}}</span>
            <span class="battle-vs">vs {{{defenderName}}}</span>
            <span class="battle-time" style="font-size:0.75rem;color:var(--text-muted)">{{{createdAt}}}</span>
            {{{lootHtml}}}
          </div>`,
    };

    function renderTemplate(templateName, data = {}) {
      return renderInlineTemplate(templates[templateName], data);
    }

    function renderTemplateList(templateName, rows) {
      return renderInlineTemplateList(templates[templateName], rows);
    }

    function populatePlanetSelect() {
      const planetSelect = getPlanetSelect();
      const colonies = getColonies();
      if (planetSelect) {
        const options = colonies.map((colony) => {
          const option = documentRef.createElement('option');
          option.value = String(colony.id ?? '');
          option.textContent = `${colony.name ?? ''} [${colony.galaxy ?? ''}:${colony.system ?? ''}:${colony.position ?? ''}]`;
          return option;
        });
        planetSelect.replaceChildren(...options);
      }
      if (!getCurrentColony() && colonies.length) {
        selectColonyById(colonies[0].id);
      }
    }

    function updateResourceBar() {
      const currentColony = getCurrentColony();
      if (!currentColony) return;

      function applyResResource(elId, value, ratePerHour, cap) {
        const el = documentRef.getElementById(elId);
        if (!el) return;
        el.textContent = fmt(value);
        const btn = el.closest('.resource-btn') || el.parentElement;
        if (btn) {
          // Capacity color
          btn.classList.remove('res-cap-full', 'res-cap-warn', 'res-cap-ok', 'res-cap-pulse');
          if (cap > 0) {
            const fill = value / cap;
            if (fill >= 0.95) { btn.classList.add('res-cap-full'); btn.classList.add('res-cap-pulse'); }
            else if (fill >= 0.75) btn.classList.add('res-cap-warn');
            else btn.classList.add('res-cap-ok');
          }
        }
        // Rate line
        let rateEl = el.parentElement ? el.parentElement.querySelector('.res-rate') : null;
        if (!rateEl && el.parentElement) {
          rateEl = documentRef.createElement('span');
          rateEl.className = 'res-rate';
          el.parentElement.appendChild(rateEl);
        }
        if (rateEl && ratePerHour !== undefined) {
          const rateVal = Math.round(ratePerHour);
          const sign = rateVal > 0 ? '+' : '';
          const arrow = rateVal > 0 ? '▲' : rateVal < 0 ? '▼' : '—';
          const color = rateVal > 0 ? '#2ecc71' : rateVal < 0 ? '#e74c3c' : '#aaa';
          rateEl.style.color = color;
          rateEl.textContent = `${arrow} ${sign}${fmt(rateVal)}/h`;
        }
      }

      applyResResource('res-metal',    currentColony.metal    ?? 0, currentColony.metal_per_hour,    currentColony.metal_cap);
      applyResResource('res-crystal',  currentColony.crystal  ?? 0, currentColony.crystal_per_hour,  currentColony.crystal_cap);
      applyResResource('res-deuterium',currentColony.deuterium?? 0, currentColony.deuterium_per_hour,currentColony.deuterium_cap);
      applyResResource('res-food',     currentColony.food     ?? 0, currentColony.food_per_hour,     currentColony.food_cap);
      applyResResource('res-rare-earth',currentColony.rare_earth ?? 0, currentColony.rare_earth_per_hour, currentColony.rare_earth_cap ?? 50000);

      const resEnergyEl = documentRef.getElementById('res-energy');
      if (resEnergyEl) resEnergyEl.textContent = currentColony.energy ?? '-';
      const popEl = documentRef.getElementById('res-population');
      if (popEl) popEl.textContent = `${fmt(currentColony.population ?? 0)}/${fmt(currentColony.max_population ?? 500)}`;
      const happEl = documentRef.getElementById('res-happiness');
      if (happEl) {
        const happiness = parseInt(currentColony.happiness ?? 70, 10);
        happEl.textContent = `${happiness}%`;
        happEl.style.color = happiness >= 70 ? '#2ecc71' : happiness >= 40 ? '#f1c40f' : '#e74c3c';
      }
      const topbarCoordsEl = documentRef.getElementById('topbar-coords');
      if (topbarCoordsEl) {
        topbarCoordsEl.textContent = `[${currentColony.galaxy}:${currentColony.system}:${currentColony.position}]`;
      }
      if (windowRef._GQ_meta) {
        const darkMatterEl = documentRef.getElementById('res-dark-matter');
        if (darkMatterEl) darkMatterEl.textContent = fmt(windowRef._GQ_meta.dark_matter ?? 0);
      }
    }

    function applyBadges(data) {
      const msgBadge = documentRef.getElementById('msg-badge');
      if (msgBadge && data.unread_msgs > 0) {
        msgBadge.textContent = data.unread_msgs;
        msgBadge.classList.remove('hidden');
      } else if (msgBadge) {
        msgBadge.classList.add('hidden');
      }

      const qBadge = documentRef.getElementById('quest-badge');
      const unclaimed = data.user_meta?.unclaimed_quests ?? 0;
      if (qBadge && unclaimed > 0) {
        qBadge.textContent = unclaimed;
        qBadge.classList.remove('hidden');
      } else if (qBadge) {
        qBadge.classList.add('hidden');
      }
    }

    async function load() {
      try {
        const data = await api.overview();
        if (!data.success) {
          console.error('Overview API error:', data.error);
          if (/not authenticated|unauthorized|401/i.test(String(data.error || ''))) {
            if (shouldRedirectOnAuthLoadError('api/game.php?action=overview', 'overview')) {
              redirectToLogin('overview-not-authenticated');
            } else {
              console.info('[overview] Auth-Fehler erkannt, Redirect unterdrueckt (policy).');
            }
            return;
          }
          showToast(data.error || 'Overview konnte nicht geladen werden.', 'error');
          const root = wm.body('overview');
          if (root) {
            const error = documentRef.createElement('p');
            error.className = 'text-muted';
            error.style.color = '#e74c3c';
            error.textContent = `Error: ${data.error || 'Nicht eingeloggt. Bitte neu laden.'}`;
            root.replaceChildren(error);
          }
          return;
        }

        setColonies(data.colonies || []);
        windowRef._GQ_battles = data.battles || [];
        windowRef._GQ_politics = data.politics || null;
        windowRef._GQ_meta = data.user_meta || {};
        windowRef._GQ_fleets = data.fleets || [];
        windowRef._GQ_offline = data.offline_progress || null;

        const galaxy3d = getGalaxy3d ? getGalaxy3d() : null;
        if (galaxy3d && typeof galaxy3d.setGalaxyFleets === 'function') {
          galaxy3d.setGalaxyFleets(windowRef._GQ_fleets || []);
        }

        // Refresh FTL infrastructure overlay (lazy: only when galaxy3d is active)
        if (galaxy3d && typeof galaxy3d.setFtlInfrastructure === 'function') {
          api.ftlMap().then((ftlData) => {
            if (ftlData?.success) {
              windowRef._GQ_ftl_map = ftlData;
              galaxy3d.setFtlInfrastructure(ftlData.gates || [], ftlData.resonance_nodes || []);
            }
          }).catch(() => {});
        }

        populatePlanetSelect();
        updateResourceBar();
        applyBadges(data);
        wm.refresh('overview');
        wm.refresh('minimap');
      } catch (e) {
        const em = String(e?.message || e || '');
        if (/abort|cancel|navigation/i.test(em)) return;
        if (/not authenticated|unauthorized|http\s*401|\b401\b/i.test(em)) {
          if (shouldRedirectOnAuthLoadError('api/game.php?action=overview', 'overview')) {
            redirectToLogin('overview-401');
          } else {
            console.info('[overview] 401 erkannt, Redirect unterdrueckt (policy).');
          }
          return;
        }
        console.error('Overview load failed', e);
        showToast('Overview konnte nicht geladen werden. Bitte Seite neu laden.', 'error');
        const root = wm.body('overview');
        if (root && !root.innerHTML.trim()) {
          const error = documentRef.createElement('p');
          error.className = 'text-muted';
          error.style.color = '#e74c3c';
          error.textContent = `Fehler beim Laden: ${em}`;
          root.replaceChildren(error);
        }
      }
    }

    async function runRiskAutoUpgrade(cid, focusBuilding) {
      const autoRiskUpgradeBudgetShare = 0.55;
      focusColonyDevelopment(cid, {
        source: 'economy-risk-auto',
        focusBuilding,
      });

      const colony = getColonies().find((c) => Number(c.id || 0) === Number(cid || 0)) || null;
      if (!colony) {
        showToast('Kolonie nicht gefunden, Auto-Upgrade abgebrochen.', 'warning');
        return;
      }

      let buildingsPayload = null;
      try {
        buildingsPayload = await api.buildings(cid);
      } catch (_) {
        showToast('Kostenpr\u00fcfung nicht m\u00f6glich (Netzwerk). Auto-Upgrade aus Sicherheitsgr\u00fcnden abgebrochen.', 'warning');
        return;
      }
      if (!buildingsPayload?.success) {
        showToast(buildingsPayload?.error || 'Kostenpr\u00fcfung fehlgeschlagen. Auto-Upgrade abgebrochen.', 'warning');
        return;
      }

      const buildingEntry = (buildingsPayload.buildings || []).find((b) => String(b.type || '') === String(focusBuilding || ''));
      if (!buildingEntry) {
        showToast(`Geb\u00e4ude ${fmtName(focusBuilding)} nicht verf\u00fcgbar.`, 'warning');
        return;
      }

      const budgetCheck = evaluateRiskUpgradeBudget(colony, buildingEntry.next_cost || {}, autoRiskUpgradeBudgetShare);
      if (!budgetCheck.ok) {
        showToast(`Auto +1 blockiert (Budgetlimit ${Math.round(autoRiskUpgradeBudgetShare * 100)}%). ${budgetCheck.details.join(', ')}`, 'warning');
        return;
      }

      const res = await api.upgrade(cid, focusBuilding);
      if (!res?.success) {
        showToast(res?.error || 'Auto-Upgrade fehlgeschlagen.', 'warning');
        return;
      }
      const queuePos = Number(res.queue_position || 0);
      const targetLevel = Number(res.target_level || 0);
      if (queuePos > 1) showToast(`${fmtName(focusBuilding)} eingereiht (Pos ${queuePos}, Lv ${targetLevel}).`, 'success');
      else showToast(`${fmtName(focusBuilding)} gestartet (Lv ${targetLevel}).`, 'success');
      await load();
      wm.refresh('buildings');
      wm.refresh('colony');
    }

    function renderFleetList(root) {
      renderFleetListFn({
        root,
        onReload: async () => load(),
      });
    }

    function renderBattleLog(root) {
      renderBattleLogFn({ root });
    }

    function bindOverviewActions(root) {
      bindOverviewActionsFn(root);
    }

    function render() {
      const root = wm.body('overview');
      if (!root) return;
      const colonies = getColonies();
      if (!colonies.length) {
        root.innerHTML = uiKitEmptyStateHTML('No colonies yet', 'Found your first colony to unlock strategic overview data.');
        return;
      }

      const currentColony = getCurrentColony();
      const meta = windowRef._GQ_meta || {};
      const protUntil = meta.protection_until ? new Date(meta.protection_until) : null;
      const protected_ = protUntil && protUntil > Date.now();
      const pvpOn = !!parseInt(meta.pvp_mode, 10);
      const protText = protected_ ? `Newbie protection until ${protUntil.toLocaleDateString()}` : 'No protection';
      const colonyTypeLabels = {
        balanced: 'Balanced', mining: 'Mining', industrial: 'Industrial',
        research: 'Research', agricultural: 'Agricultural', military: 'Military'
      };
      const offline = windowRef._GQ_offline || null;

      root.innerHTML = `
        <div class="status-bar">
          <span class="status-chip ${protected_ ? 'chip-shield' : 'chip-neutral'}">${protText}</span>
          <span class="status-chip ${pvpOn ? 'chip-pvp-on' : 'chip-pvp-off'}">PvP: ${pvpOn ? 'ON' : 'OFF'}</span>
          <button id="pvp-toggle-btn" class="btn btn-sm ${pvpOn ? 'btn-warning' : 'btn-secondary'}" ${protected_ ? 'disabled' : ''}>
            ${pvpOn ? 'Disable PvP' : 'Enable PvP'}
          </button>
          <span class="status-chip chip-rank">Rank ${formatHtml(meta.rank_points ?? 0)} RP</span>
          <span class="status-chip chip-dm">DM ${formatHtml(meta.dark_matter ?? 0)} DM</span>
          <button class="btn btn-secondary btn-sm" id="open-leaders-btn">Leaders</button>
        </div>

        <div data-overview-offline-summary></div>

        <div data-overview-resource-insight></div>

        <h3 style="margin:0.75rem 0 0.5rem">Your Colonies</h3>
        <div class="overview-grid">
          ${colonies.map((colony) => {
            const leaderChips = (colony.leaders || []).map((leader) =>
                `<span class="leader-chip" title="${esc(leader.role)} Lv${esc(leader.level)} - ${esc(leader.last_action || 'idle')}">
                 ${leader.role === 'colony_manager' ? 'MGR' : leader.role === 'science_director' ? 'SCI' : 'MIL'} ${esc(leader.name)}
               </span>`
            ).join('');
            const colonyHealthValue = colony.integrity_pct ?? colony.health_pct ?? colony.hp_pct ?? colony.condition_pct;
            const derivedHealth = colonyHealthValue === null || colonyHealthValue === undefined
              || (typeof colonyHealthValue === 'string' && colonyHealthValue.trim() === '')
              ? NaN
              : Number(colonyHealthValue);
            const colonyHealthPct = Number.isFinite(derivedHealth) && derivedHealth >= 0 && derivedHealth <= 100
              ? Math.round(derivedHealth)
              : null;
            const colonyShieldValue = colony.shield_pct ?? colony.shields_pct ?? colony.planetary_shield_pct;
            const rawShield = colonyShieldValue === null || colonyShieldValue === undefined
              || (typeof colonyShieldValue === 'string' && colonyShieldValue.trim() === '')
              ? NaN
              : Number(colonyShieldValue);
            const colonyShieldPct = Number.isFinite(rawShield) && rawShield >= 0 && rawShield <= 100
              ? Math.round(rawShield)
              : null;
            const colonyHealthTone = colonyHealthPct === null
              ? ''
              : (colonyHealthPct < 30 ? 'is-critical' : (colonyHealthPct < 60 ? 'is-warning' : 'is-good'));
            const colonyShieldTone = colonyShieldPct === null
              ? ''
              : (colonyShieldPct < 30 ? 'is-critical' : (colonyShieldPct < 60 ? 'is-warning' : 'is-good'));
            const happinessPct = boundedPercent(colony.happiness, 70);
            const servicesPct = boundedPercent(colony.public_services);
            return `
            <div class="planet-card ${currentColony && colony.id === currentColony.id ? 'selected' : ''}" data-cid="${esc(colony.id)}">
              <div class="planet-card-name">${esc(colony.name)}
                ${colony.is_homeworld ? '<span class="hw-badge">HW</span>' : ''}
              </div>
              <div class="planet-card-coords">[${esc(colony.galaxy)}:${esc(colony.system)}:${esc(colony.position)}]</div>
              <div class="planet-card-type">
                <span class="colony-type-badge">${esc(Object.hasOwn(colonyTypeLabels, colony.colony_type) ? colonyTypeLabels[colony.colony_type] : colony.colony_type)}</span>
                \u2022 ${nameHtml(colony.planet_type || 'terrestrial')}
                ${colony.in_habitable_zone ? '<span class="hz-badge" title="Habitable Zone">\u{1F30D}</span>' : ''}
              </div>
              ${buildWarningsHtml(colony, offline)}
              <div style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-secondary)">
                \u26fe ${formatHtml(colony.metal)} &nbsp; \u{1F48E} ${formatHtml(colony.crystal)} &nbsp; \u26C1 ${formatHtml(colony.deuterium)}
                ${parseFloat(colony.rare_earth || 0) > 0 ? `&nbsp; \u{1F4A0} ${formatHtml(colony.rare_earth)}` : ''}
              </div>
              ${(() => {
                const maxMetal = Number(colony.max_metal || 10000000);
                const maxCrystal = Number(colony.max_crystal || 8000000);
                const maxDeuterium = Number(colony.max_deuterium || 4000000);
                const metalPct = Math.round(boundedPercent((Number(colony.metal || 0) / maxMetal) * 100));
                const crystalPct = Math.round(boundedPercent((Number(colony.crystal || 0) / maxCrystal) * 100));
                const deuteriumPct = Math.round(boundedPercent((Number(colony.deuterium || 0) / maxDeuterium) * 100));
                const metalTone = metalPct > 90 ? 'is-critical' : (metalPct > 70 ? 'is-warning' : 'is-good');
                const crystalTone = crystalPct > 90 ? 'is-critical' : (crystalPct > 70 ? 'is-warning' : 'is-good');
                const deuteriumTone = deuteriumPct > 90 ? 'is-critical' : (deuteriumPct > 70 ? 'is-warning' : 'is-good');
                return `<div class="entity-bars" style="margin-top:0.3rem;">
                  <div class="entity-bar-row" title="Metal storage ${metalPct}%">
                    <span class="entity-bar-label" style="font-size:0.7rem;">Met</span>
                    <div class="bar-wrap"><div class="bar-fill bar-integrity ${metalTone}" style="width:${metalPct}%;height:5px;"></div></div>
                    <span class="entity-bar-value" style="font-size:0.7rem;">${metalPct}%</span>
                  </div>
                  <div class="entity-bar-row" title="Crystal storage ${crystalPct}%">
                    <span class="entity-bar-label" style="font-size:0.7rem;">Cry</span>
                    <div class="bar-wrap"><div class="bar-fill bar-integrity ${crystalTone}" style="width:${crystalPct}%;height:5px;"></div></div>
                    <span class="entity-bar-value" style="font-size:0.7rem;">${crystalPct}%</span>
                  </div>
                  <div class="entity-bar-row" title="Deuterium storage ${deuteriumPct}%">
                    <span class="entity-bar-label" style="font-size:0.7rem;">Deu</span>
                    <div class="bar-wrap"><div class="bar-fill bar-integrity ${deuteriumTone}" style="width:${deuteriumPct}%;height:5px;"></div></div>
                    <span class="entity-bar-value" style="font-size:0.7rem;">${deuteriumPct}%</span>
                  </div>
                </div>`;
              })()}
              <div style="margin-top:0.2rem;font-size:0.75rem;color:var(--text-secondary)">
                \u{1F33F} ${formatHtml(colony.food || 0)} &nbsp; \u26A1 ${formatHtml(colony.energy ?? 0)}
              </div>
              ${(() => {
                const energyAmount = Number(colony.energy ?? 0);
                const energyMax = 10000;
                const energyPct = Math.min(100, Math.round((energyAmount / energyMax) * 100));
                const energyTone = energyAmount <= 0 ? 'is-critical' : (energyAmount < (energyMax * 0.3) ? 'is-warning' : 'is-good');
                return `<div class="entity-bars" style="margin-top:0.2rem;">
                  <div class="entity-bar-row" title="Energy balance">
                    <span class="entity-bar-label" style="font-size:0.7rem;">Energy</span>
                    <div class="bar-wrap"><div class="bar-fill bar-integrity ${energyTone}" style="width:${energyPct}%;height:5px;"></div></div>
                    <span class="entity-bar-value" style="font-size:0.7rem;">${energyAmount <= 0 ? 'DEFICIT' : (energyAmount < (energyMax * 0.3) ? 'LOW' : 'OK')}</span>
                  </div>
                </div>`;
              })()}
              <div class="welfare-bar" style="margin-top:0.4rem">
                <span title="Happiness ${happinessPct}%">\u{1F600}</span>
                <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${happinessPct}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${happinessPct}%</span>
              </div>
              <div class="welfare-bar" style="margin-top:0.4rem">
                <span title="Happiness ${happinessPct}%">\u{1F600}</span>
                <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${happinessPct}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${happinessPct}%</span>
              </div>
              ${(() => {
                const pop = Number(colony.population ?? 0);
                const maxPop = Number(colony.max_population ?? 500);
                const popPct = Math.round(boundedPercent((pop / maxPop) * 100));
                const popTone = popPct >= 95 ? 'is-critical' : (popPct >= 70 ? 'is-warning' : 'is-good');
                return `<div class="entity-bars" style="margin-top:0.2rem;">
                  <div class="entity-bar-row" title="Population capacity ${popPct}%">
                    <span class="entity-bar-label" style="font-size:0.7rem;">Pop</span>
                    <div class="bar-wrap"><div class="bar-fill bar-integrity ${popTone}" style="width:${popPct}%;height:5px;"></div></div>
                    <span class="entity-bar-value" style="font-size:0.7rem;">${formatHtml(pop)}/${formatHtml(maxPop)}</span>
                  </div>
                </div>`;
              })()}
              <div class="welfare-bar">
                <span title="Public Services ${servicesPct}%">\u{1F3DB}</span>
                <div class="bar-wrap"><div class="bar-fill bar-services" style="width:${servicesPct}%"></div></div>
                <span style="font-size:0.7rem;min-width:28px">${servicesPct}%</span>
              </div>
              ${(colonyHealthPct !== null || colonyShieldPct !== null) ? `<div class="entity-bars" aria-label="Colony status bars">
                ${colonyHealthPct === null ? '' : `<div class="entity-bar-row" title="Colony integrity ${colonyHealthPct}%">
                  <span class="entity-bar-label">Health</span>
                  <div class="bar-wrap"><div class="bar-fill bar-integrity ${colonyHealthTone}" style="width:${colonyHealthPct}%"></div></div>
                  <span class="entity-bar-value">${colonyHealthPct}%</span>
                </div>`}
                ${colonyShieldPct === null ? '' : `<div class="entity-bar-row" title="Colony shields ${colonyShieldPct}%">
                  <span class="entity-bar-label">Shield</span>
                  <div class="bar-wrap"><div class="bar-fill bar-shield ${colonyShieldTone}" style="width:${colonyShieldPct}%"></div></div>
                  <span class="entity-bar-value">${colonyShieldPct}%</span>
                </div>`}
              </div>` : ''}
              ${colony.deposit_metal >= 0 ? `
                <div style="margin-top:0.3rem;font-size:0.7rem">
                  <span class="deposit-chip ${colony.deposit_metal < 100000 ? 'depleted' : ''}" title="Metal deposit remaining">\u26fe ${formatHtml(colony.deposit_metal)}</span>
                  <span class="deposit-chip ${colony.deposit_crystal < 50000 ? 'depleted' : ''}" title="Crystal deposit">\u{1F48E} ${formatHtml(colony.deposit_crystal)}</span>
                  <span class="deposit-chip rare-earth-chip" title="Rare Earth deposit">\u{1F4A0} ${formatHtml(colony.deposit_rare_earth)}</span>
                </div>` : ''}
              ${leaderChips ? `<div class="leader-chips">${leaderChips}</div>` : ''}
            </div>`;
          }).join('')}
        </div>

        <h3 style="margin:1rem 0 0.5rem">Fleets in Motion</h3>
        <div id="fleet-list-wm"></div>

        <h3 style="margin:1rem 0 0.5rem">Recent Battles</h3>
        <div id="battle-log-wm"></div>

        <h3 style="margin:1rem 0 0.5rem">Quick Navigation</h3>
        <div class="overview-actions"
             style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;"
             data-quick-nav>
          <button class="btn btn-outline-primary btn-sm" data-open-window="colony">Colony</button>
          <button class="btn btn-outline-primary btn-sm" data-open-window="buildings">Buildings</button>
          <button class="btn btn-outline-primary btn-sm" data-open-window="economy">Economy</button>
          <button class="btn btn-outline-primary btn-sm" data-open-window="messages">Messages</button>
          <button class="btn btn-outline-primary btn-sm" data-open-window="galaxy">Galaxy</button>
        </div>`;

      const offlineSummary = root.querySelector('[data-overview-offline-summary]');
      const offlineSummaryNode = buildOfflineSummaryNode(offline);
      if (offlineSummaryNode) offlineSummary?.replaceWith(offlineSummaryNode);
      else offlineSummary?.remove();

      const resourceInsight = root.querySelector('[data-overview-resource-insight]');
      const resourceInsightNode = buildResourceInsightNode(offline, meta);
      if (resourceInsightNode) resourceInsight?.replaceWith(resourceInsightNode);
      else resourceInsight?.remove();

      bindOverviewActions(root);
      renderFleetList(root);
      renderBattleLog(root);
      // Bind View Hyperlinks
      const ViewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
      if (ViewHyperlinks) ViewHyperlinks.bindAll(root);
    }

    return {
      load,
      render,
      populatePlanetSelect,
      updateResourceBar,
      applyBadges,
      runRiskAutoUpgrade,
      renderTemplate,
      renderTemplateList,
      renderFleetList,
      renderBattleLog,
      bindOverviewActions,
      riskFocusFromFlags: (flags) => riskFocusFromFlags(flags),
      evaluateRiskUpgradeBudget: (colony, nextCost, share = 0.55) => evaluateRiskUpgradeBudget(colony, nextCost, share),
      signed: (value, digits = 0) => signed(value, digits),
      buildOfflineSummaryNode: (offline) => buildOfflineSummaryNode(offline),
      buildResourceInsightNode: (offline, meta) => buildResourceInsightNode(offline, meta),
    };
  }

  const api = { createOverviewController };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.GQRuntimeOverviewController = api; }
})();
