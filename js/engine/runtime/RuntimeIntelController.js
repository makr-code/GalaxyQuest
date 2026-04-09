'use strict';
(function () {
  function createIntelController({
    wm,
    api,
    documentRef,
    uiKitSkeletonHTML,
    uiKitEmptyStateHTML,
    esc,
    fmt,
    fmtName,
    showToast,
    getCurrentColony,
  } = {}) {
    let lastMatchupScan = null;
    const battleDetailCache = new Map();

    function renderCombatSummary(report) {
      const ctx = report?.simulation_context || {};
      const power = ctx.power_rating || {};
      const winLabel = ctx.attacker_wins === null || typeof ctx.attacker_wins === 'undefined'
        ? 'n/a'
        : (ctx.attacker_wins ? 'Attacker victory' : 'Defender hold');
      const diceVar = Number(ctx.dice_variance_index || 0);

      return `
        <div class="system-row small" style="margin-top:0.45rem; color:#b8c7d9;">
          <span style="display:inline-block; margin-right:0.7rem;">Seed: ${esc(String(ctx.seed || 'n/a').slice(0, 12))}</span>
          <span style="display:inline-block; margin-right:0.7rem;">Var: ${fmt(diceVar)}</span>
          <span style="display:inline-block; margin-right:0.7rem;">PWR A/D: ${fmt(power.attacker || 0)} / ${fmt(power.defender || 0)}</span>
          <span style="display:inline-block;">${esc(winLabel)}</span>
        </div>`;
    }

    function renderSpyReportCard(report) {
      if (!report || !report.report) return '';
      const r = report.report;
      const createdAt = new Date(report.created_at).toLocaleString();
      const status = r.status || 'unknown';

      if (status === 'uninhabited') {
        return `
          <div class="system-card" style="margin-bottom:1rem">
            <div class="system-row"><strong>Uninhabited Planet</strong></div>
            <div class="system-row text-muted small">${createdAt}</div>
            ${r.planet ? `<div class="system-row">Class: ${esc(r.planet.planet_class || '?')}</div>` : ''}
            ${r.planet && r.planet.deposit_metal ? `<div class="system-row">Metal: ${esc(r.planet.richness_metal || '?')}</div>` : ''}
            ${r.planet && r.planet.deposit_crystal ? `<div class="system-row">Crystal: ${esc(r.planet.richness_crystal || '?')}</div>` : ''}
          </div>`;
      }

      if (status !== 'inhabited') return '';

      return `
        <div class="system-card" style="margin-bottom:1rem">
          <div class="system-row"><strong>Spy Report: ${esc(r.owner || '?')}</strong></div>
          <div class="system-row" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <strong>Spy Report: ${esc(r.owner || '?')}</strong>
            ${!report.is_own && report.owner_username ? `<span class="lb-alliance-tag">via ${esc(report.owner_username)}</span>` : ''}
          </div>
          <div class="system-row text-muted small">${createdAt}</div>

          <div class="system-row" style="margin-top:0.5rem"><strong>Resources</strong></div>
          ${r.resources ? `
            <div class="system-row small">
              Metal ${fmt(r.resources.metal || 0)} | Crystal ${fmt(r.resources.crystal || 0)} |
              Deuterium ${fmt(r.resources.deuterium || 0)} | Rare Earth ${fmt(r.resources.rare_earth || 0)}
            </div>
          ` : ''}

          <div class="system-row" style="margin-top:0.5rem"><strong>Welfare</strong></div>
          ${r.welfare ? `
            <div class="welfare-bar" style="margin-top:0.3rem">
              <span title="Happiness ${r.welfare.happiness || 0}%">HAP</span>
              <div class="bar-wrap"><div class="bar-fill bar-happiness" style="width:${r.welfare.happiness || 0}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${r.welfare.happiness || 0}%</span>
            </div>
            <div class="welfare-bar">
              <span title="Population">POP</span>
              <div class="bar-wrap"><div class="bar-fill bar-population" style="width:${Math.min(100, Math.round((r.welfare.population || 0) / (r.welfare.max_population || 500) * 100))}%"></div></div>
              <span style="font-size:0.7rem;min-width:38px">${fmt(r.welfare.population || 0)}</span>
            </div>
            <div class="welfare-bar">
              <span title="Public Services">SRV</span>
              <div class="bar-wrap"><div class="bar-fill bar-services" style="width:${r.welfare.public_services || 0}%"></div></div>
              <span style="font-size:0.7rem;min-width:28px">${r.welfare.public_services || 0}%</span>
            </div>
          ` : ''}

          ${r.stealth_masked ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Stealth</strong></div>
            <div class="system-row small text-muted">${esc(r.stealth_note || 'Fleet intel is hidden by active stealth technology.')}</div>
          ` : ''}

          ${r.ships && Object.keys(r.ships).length ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Ships</strong></div>
            <div class="system-row small">
              ${Object.entries(r.ships).map(([ship, count]) => esc(fmtName(ship)) + ': ' + fmt(count)).join(' | ')}
            </div>
          ` : ''}

          ${r.leaders && r.leaders.length ? `
            <div class="system-row" style="margin-top:0.5rem"><strong>Leaders</strong></div>
            <div class="system-row small">
              ${r.leaders.map((l) => esc(l.name || '?') + ' (' + esc(l.role || '?') + ') Lv' + (l.level || 0)).join(' | ')}
            </div>
          ` : ''}
        </div>`;
    }

    function renderBattleReportCard(report) {
      if (!report || !report.report) return '';
      const r = report.report || {};
      const createdAt = new Date(report.created_at).toLocaleString();
      const explain = Array.isArray(r.explainability?.top_factors) ? r.explainability.top_factors : [];
      const loot = r.loot || {};
      const attackerWins = !!r.attacker_wins;
      const accent = attackerWins ? '#3e8f5a' : '#9a4b4b';
      const ctx = report.simulation_context || r;
      const atkPwr = Number(ctx.power_rating?.attacker || r.power_rating?.attacker || 0);
      const defPwr = Number(ctx.power_rating?.defender || r.power_rating?.defender || 0);
      const totalPwr = atkPwr + defPwr;
      const atkPct = totalPwr > 0 ? Math.round((atkPwr / totalPwr) * 100) : 50;
      const defPct = totalPwr > 0 ? Math.round((defPwr / totalPwr) * 100) : 50;
      const atkTone = atkPct > defPct ? 'is-good' : (atkPct >= defPct - 10 ? 'is-warning' : 'is-critical');
      const defTone = defPct > atkPct ? 'is-good' : (defPct >= atkPct - 10 ? 'is-warning' : 'is-critical');
      const powerBarsHtml = totalPwr > 0 ? `
        <div class="entity-bars" style="margin-top:0.45rem;">
          <div class="entity-bar-row" title="Attacker power ${atkPct}% (${fmt(atkPwr)})">
            <span class="entity-bar-label">Atk</span>
            <div class="bar-wrap"><div class="bar-fill bar-integrity ${atkTone}" style="width:${atkPct}%"></div></div>
            <span class="entity-bar-value">${atkPct}%</span>
          </div>
          <div class="entity-bar-row" title="Defender power ${defPct}% (${fmt(defPwr)})">
            <span class="entity-bar-label">Def</span>
            <div class="bar-wrap"><div class="bar-fill bar-shield ${defTone}" style="width:${defPct}%"></div></div>
            <span class="entity-bar-value">${defPct}%</span>
          </div>
        </div>` : '';

      return `
        <div class="system-card" style="margin-bottom:1rem; border-color:${accent};">
          <div class="system-row"><strong>Battle Report #${report.id}</strong></div>
          <div class="system-row text-muted small">${createdAt} | Role: ${esc(report.role || '?')}</div>
          <div class="system-row" style="margin-top:0.35rem; color:${accent}; font-weight:700;">
            ${attackerWins ? 'Attacker succeeded' : 'Defender held'}
          </div>
          ${powerBarsHtml}
          ${renderCombatSummary(report)}
          <div class="system-row small" style="margin-top:0.5rem;">
            Loot: Metal ${fmt(loot.metal || 0)} | Crystal ${fmt(loot.crystal || 0)} | Deuterium ${fmt(loot.deuterium || 0)} | Rare Earth ${fmt(loot.rare_earth || 0)}
          </div>
          ${explain.length ? `
            <div class="system-row" style="margin-top:0.55rem;"><strong>Top Factors</strong></div>
            <div class="system-row small" style="color:#d7dfef;">
              ${explain.map((f) => `${esc(fmtName(String(f.factor || 'factor')))} ${fmt(Number(f.impact_pct || 0))}%`).join(' | ')}
            </div>
          ` : ''}
          <div style="margin-top:0.65rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-sm" data-battle-detail="${Number(report.id || 0)}">Open Detail</button>
          </div>
        </div>`;
    }

    function renderBattleDetailBody(detailResponse) {
      const battle = detailResponse?.battle_report || {};
      const report = battle.report || {};
      const meta = battle.meta || {};
      const explain = Array.isArray(report.explainability?.top_factors) ? report.explainability.top_factors : [];
      const rounds = Array.isArray(report.rounds) ? report.rounds : [];
      const modifierBreakdown = report.modifier_breakdown || {};
      const loot = report.loot || {};
      const tech = report.tech || {};
      const attackerLost = report.attacker_lost || {};
      const defenderLost = report.defender_lost || {};
      const renderModifierRows = (sideKey, label) => {
        const buckets = modifierBreakdown?.[sideKey] || {};
        const entries = Object.entries(buckets);
        if (!entries.length) {
          return `<div class="small">${label}: none</div>`;
        }

        return `
          <div class="small" style="display:grid; gap:0.25rem;">
            <div style="font-weight:700; color:#eef4ff;">${label}</div>
            ${entries.map(([key, value]) => `
              <div>
                ${esc(fmtName(String(key || 'modifier')))}:
                +${fmt(Number(value?.add_pct || 0) * 100)}% pct |
                +${fmt(Number(value?.add_flat || 0))} flat |
                x${fmt(Number(value?.mult || 1))}
              </div>`).join('')}
          </div>`;
      };

      return `
        <div style="display:grid; gap:0.8rem; color:#dfe7f5;">
          <div>
            <div style="font-weight:700; font-size:1.05rem;">Battle Report #${fmt(battle.id || 0)}</div>
            <div class="small text-muted">${esc(String(battle.created_at || ''))} | Role: ${esc(String(battle.role || '?'))}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Combat Meta</strong></div>
            <div class="small" style="margin-top:0.35rem;">Seed: ${esc(String(meta.battle_seed || report.seed || 'n/a'))}</div>
            <div class="small">Version: ${fmt(meta.report_version || report.version || 0)} | Dice Var: ${fmt(meta.dice_variance_index || report.dice_variance_index || 0)}</div>
            <div class="small">Power A/D: ${fmt(meta.attacker_power_rating || report.power_rating?.attacker || 0)} / ${fmt(meta.defender_power_rating || report.power_rating?.defender || 0)}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Tech Snapshot</strong></div>
            <div class="small" style="margin-top:0.35rem;">Atk Wpn/Shld: ${fmt(tech.atk_wpn || 0)} / ${fmt(tech.atk_shld || 0)}</div>
            <div class="small">Def Wpn/Shld: ${fmt(tech.def_wpn || 0)} / ${fmt(tech.def_shld || 0)}</div>
          </div>
          ${(() => {
            const ec = report.energy_context;
            const dc = report.damage_channels;
            if (!ec && !dc) return '';
            const atkBudget = ec?.attacker || {};
            const defBudget = ec?.defender || {};
            const atkCh = dc?.attacker || {};
            const defCh = dc?.defender || {};
            return `
              <div style="padding:0.65rem; border:1px solid #2a4563; border-radius:10px; background:#0d1824;">
                <div><strong>Energy Economy</strong></div>
                <div style="margin-top:0.45rem; display:grid; grid-template-columns:1fr 1fr; gap:0.55rem;">
                  <div class="small">
                    <div style="font-weight:700; color:#7ec8e3; margin-bottom:0.2rem;">Attacker</div>
                    ${atkBudget.generated != null ? `<div>Generated: ${fmt(atkBudget.generated)}</div>` : ''}
                    ${atkBudget.upkeep != null ? `<div>Upkeep: ${fmt(atkBudget.upkeep)}</div>` : ''}
                    ${atkBudget.weapon_factor != null ? `<div>Wpn Factor: ${fmt(atkBudget.weapon_factor)}</div>` : ''}
                    ${atkBudget.shield_factor != null ? `<div>Shld Factor: ${fmt(atkBudget.shield_factor)}</div>` : ''}
                    ${atkBudget.weapon_efficiency != null ? `<div>Wpn Eff: ${fmt(atkBudget.weapon_efficiency)}</div>` : ''}
                    ${atkBudget.shield_efficiency != null ? `<div>Shld Eff: ${fmt(atkBudget.shield_efficiency)}</div>` : ''}
                    ${(atkCh.energy != null || atkCh.kinetic != null) ? `
                      <div style="margin-top:0.2rem; border-top:1px solid #2a4060; padding-top:0.2rem;">
                        <span style="color:#f09c30;">Energy: ${fmt(atkCh.energy || 0)}</span>
                        &nbsp;|&nbsp;
                        <span style="color:#c0c8d8;">Kinetic: ${fmt(atkCh.kinetic || 0)}</span>
                      </div>` : ''}
                  </div>
                  <div class="small">
                    <div style="font-weight:700; color:#e38080; margin-bottom:0.2rem;">Defender</div>
                    ${defBudget.generated != null ? `<div>Generated: ${fmt(defBudget.generated)}</div>` : ''}
                    ${defBudget.upkeep != null ? `<div>Upkeep: ${fmt(defBudget.upkeep)}</div>` : ''}
                    ${defBudget.weapon_factor != null ? `<div>Wpn Factor: ${fmt(defBudget.weapon_factor)}</div>` : ''}
                    ${defBudget.shield_factor != null ? `<div>Shld Factor: ${fmt(defBudget.shield_factor)}</div>` : ''}
                    ${defBudget.weapon_efficiency != null ? `<div>Wpn Eff: ${fmt(defBudget.weapon_efficiency)}</div>` : ''}
                    ${defBudget.shield_efficiency != null ? `<div>Shld Eff: ${fmt(defBudget.shield_efficiency)}</div>` : ''}
                    ${(defCh.energy != null || defCh.kinetic != null) ? `
                      <div style="margin-top:0.2rem; border-top:1px solid #2a4060; padding-top:0.2rem;">
                        <span style="color:#f09c30;">Energy: ${fmt(defCh.energy || 0)}</span>
                        &nbsp;|&nbsp;
                        <span style="color:#c0c8d8;">Kinetic: ${fmt(defCh.kinetic || 0)}</span>
                      </div>` : ''}
                  </div>
                </div>
              </div>`;
          })()}
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Losses</strong></div>
            <div class="small" style="margin-top:0.35rem;">Attacker: ${Object.keys(attackerLost).length ? Object.entries(attackerLost).map(([k, v]) => `${esc(fmtName(k))} ${fmt(v)}`).join(' | ') : 'none'}</div>
            <div class="small">Defender: ${Object.keys(defenderLost).length ? Object.entries(defenderLost).map(([k, v]) => `${esc(fmtName(k))} ${fmt(v)}`).join(' | ') : 'none'}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Loot</strong></div>
            <div class="small" style="margin-top:0.35rem;">Metal ${fmt(loot.metal || 0)} | Crystal ${fmt(loot.crystal || 0)} | Deuterium ${fmt(loot.deuterium || 0)} | Rare Earth ${fmt(loot.rare_earth || 0)}</div>
          </div>
          <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
            <div><strong>Modifier Breakdown</strong></div>
            <div class="small" style="margin-top:0.35rem; display:grid; gap:0.55rem;">
              ${renderModifierRows('attacker', 'Attacker')}
              ${renderModifierRows('defender', 'Defender')}
            </div>
          </div>
          ${rounds.length ? (() => {
            const maxAtkInt = Math.max(1, ...rounds.map((rd) => Number(rd.attacker_integrity_remaining || 0)));
            const maxDefInt = Math.max(1, ...rounds.map((rd) => Number(rd.defender_integrity_remaining || 0)));
            return `
            <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
              <div><strong>Round Flow</strong></div>
              <div class="small" style="margin-top:0.35rem; display:grid; gap:0.35rem;">
                ${rounds.map((round) => {
                  const atkInt = Number(round.attacker_integrity_remaining || 0);
                  const defInt = Number(round.defender_integrity_remaining || 0);
                  const atkIntPct = Math.round((atkInt / maxAtkInt) * 100);
                  const defIntPct = Math.round((defInt / maxDefInt) * 100);
                  const atkIntTone = atkIntPct < 30 ? 'is-critical' : (atkIntPct < 60 ? 'is-warning' : 'is-good');
                  const defIntTone = defIntPct < 30 ? 'is-critical' : (defIntPct < 60 ? 'is-warning' : 'is-good');
                  return `
                  <div style="padding:0.45rem 0.55rem; border:1px solid #314154; border-radius:8px; background:#0d1420;">
                    <div style="font-weight:700; color:#eef4ff;">Round ${fmt(round.round || 0)}${round.decisive ? ' \u25CF Decisive' : ''}</div>
                    <div style="margin:0.25rem 0;">Pressure A/D: ${fmt(round.attacker_pressure || 0)} / ${fmt(round.defender_pressure || 0)}</div>
                    <div class="entity-bar-row" title="Attacker integrity ${fmt(atkInt)}" style="margin-bottom:0.15rem;">
                      <span class="entity-bar-label" style="min-width:2.4rem;">A-Int</span>
                      <div class="bar-wrap"><div class="bar-fill bar-integrity ${atkIntTone}" style="width:${atkIntPct}%"></div></div>
                      <span class="entity-bar-value">${fmt(atkInt)}</span>
                    </div>
                    <div class="entity-bar-row" title="Defender integrity ${fmt(defInt)}">
                      <span class="entity-bar-label" style="min-width:2.4rem;">D-Int</span>
                      <div class="bar-wrap"><div class="bar-fill bar-shield ${defIntTone}" style="width:${defIntPct}%"></div></div>
                      <span class="entity-bar-value">${fmt(defInt)}</span>
                    </div>
                    <div style="margin-top:0.25rem;">Swing: ${esc(fmtName(String(round.swing || 'neutral')))}${round.outcome ? ' | Outcome: ' + esc(fmtName(String(round.outcome))) : ''}</div>
                  </div>`;
                }).join('')}
              </div>
            </div>`;
          })() : ''}
          ${explain.length ? `
            <div style="padding:0.65rem; border:1px solid #45556d; border-radius:10px; background:#121b2a;">
              <div><strong>Explainability</strong></div>
              <div class="small" style="margin-top:0.35rem; display:grid; gap:0.25rem;">
                ${explain.map((item) => `<div>${esc(fmtName(String(item.factor || 'factor')))}: ${fmt(Number(item.impact_pct || 0))}%</div>`).join('')}
              </div>
            </div>
          ` : ''}
        </div>`;
    }

    function closeBattleDetailOverlay() {
      documentRef.getElementById('intel-battle-detail-overlay')?.remove();
    }

    async function openBattleDetail(reportId) {
      const id = Number(reportId || 0);
      if (!id) return;

      closeBattleDetailOverlay();

      const overlay = documentRef.createElement('div');
      overlay.id = 'intel-battle-detail-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,8,14,0.76);z-index:10020;display:flex;align-items:center;justify-content:center;padding:20px;';
      overlay.innerHTML = `
        <div style="width:min(860px, 100%); max-height:88vh; overflow:auto; background:#0f1724; border:1px solid #4d6078; border-radius:14px; padding:18px; box-shadow:0 24px 80px rgba(0,0,0,0.45);">
          <div style="display:flex; justify-content:space-between; gap:1rem; align-items:center; margin-bottom:0.9rem;">
            <div style="font-weight:800; font-size:1.1rem; color:#eef4ff;">Battle Detail</div>
            <button id="intel-battle-detail-close" class="btn btn-sm">Close</button>
          </div>
          <div id="intel-battle-detail-body" class="text-muted small">Loading battle detail...</div>
        </div>`;
      documentRef.body.appendChild(overlay);

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          closeBattleDetailOverlay();
        }
      });
      overlay.querySelector('#intel-battle-detail-close')?.addEventListener('click', () => closeBattleDetailOverlay());

      try {
        let payload = battleDetailCache.get(id);
        if (!payload) {
          payload = await api.battleReportDetail(id);
          if (payload?.success) {
            battleDetailCache.set(id, payload);
          }
        }
        if (!payload?.success) {
          throw new Error(payload?.error || 'Failed to load battle detail.');
        }
        const body = overlay.querySelector('#intel-battle-detail-body');
        if (body) {
          body.innerHTML = renderBattleDetailBody(payload);
        }
      } catch (err) {
        const body = overlay.querySelector('#intel-battle-detail-body');
        if (body) {
          body.innerHTML = `<div class="text-red">${esc(String(err?.message || 'Failed to load battle detail.'))}</div>`;
        }
        showToast(String(err?.message || 'Failed to load battle detail.'), 'error');
      }
    }

    function renderMatchupScanPanel(fleets = []) {
      const options = fleets.length
        ? fleets.map((fleet) => `<option value="${Number(fleet.id || 0)}">Fleet #${Number(fleet.id || 0)} | ${esc(String(fleet.mission || 'unknown'))}</option>`).join('')
        : '<option value="">No fleets available</option>';
      const last = lastMatchupScan;
      let resultHtml = '<div class="text-muted small">Run a scan to estimate winrate and loss expectations against one or more target colonies.</div>';
      if (last && Array.isArray(last.ranking)) {
        resultHtml = `
          <div class="system-row small" style="margin-top:0.45rem; color:#b8c7d9;">
            Seed: ${esc(String(last.seed || '').slice(0, 12))} | Targets: ${fmt(last.targets_scanned || 0)} | Iterations: ${fmt(last.iterations || 0)}
          </div>
          <div style="margin-top:0.55rem; display:grid; gap:0.45rem;">
            ${last.ranking.map((row) => `
              <div style="padding:0.45rem 0.55rem; border:1px solid #45556d; border-radius:8px; background:#111927;">
                <div style="font-weight:700;">Target Colony #${fmt(row.target_colony_id || 0)}</div>
                <div class="small" style="color:#d7dfef; margin-top:0.2rem;">
                  Winrate: ${fmt((Number(row.attacker_winrate_estimate || 0) * 100).toFixed(2))}% |
                  Dice Var: ${fmt(row.dice_variance_avg || 0)} |
                  Loss A/D: ${fmt((Number(row.expected_loss_fraction_avg?.attacker || 0) * 100).toFixed(2))}% / ${fmt((Number(row.expected_loss_fraction_avg?.defender || 0) * 100).toFixed(2))}%
                </div>
              </div>
            `).join('')}
          </div>`;
      }

      return `
        <div class="system-card" style="margin-bottom:1rem;">
          <div class="system-row"><strong>Combat Matchup Scan</strong></div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.6rem; margin-top:0.65rem;">
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Attacker Fleet</span>
              <select id="intel-matchup-fleet" class="input">${options}</select>
            </label>
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Target Colony IDs</span>
              <input id="intel-matchup-targets" class="input" placeholder="195,196,197" />
            </label>
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Iterations</span>
              <input id="intel-matchup-iterations" class="input" type="number" min="1" max="2000" value="200" />
            </label>
            <label class="small" style="display:flex; flex-direction:column; gap:0.25rem;">
              <span>Seed</span>
              <input id="intel-matchup-seed" class="input" placeholder="scan_v1" />
            </label>
          </div>
          <div style="margin-top:0.65rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button id="intel-run-matchup-scan" class="btn">Run Scan</button>
            <button id="intel-clear-matchup-scan" class="btn btn-sm">Clear</button>
          </div>
          <div id="intel-matchup-results" style="margin-top:0.8rem;">${resultHtml}</div>
        </div>`;
    }

    function attachEventListeners(root) {
      root.querySelectorAll('[data-battle-detail]').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
          const reportId = Number(event.currentTarget?.dataset?.battleDetail || 0);
          await openBattleDetail(reportId);
        });
      });

      root.querySelector('#intel-run-matchup-scan')?.addEventListener('click', async () => {
        const fleetId = Number(root.querySelector('#intel-matchup-fleet')?.value || 0);
        const targetsRaw = String(root.querySelector('#intel-matchup-targets')?.value || '');
        const iterations = Number(root.querySelector('#intel-matchup-iterations')?.value || 200);
        const seed = String(root.querySelector('#intel-matchup-seed')?.value || '').trim();
        const targetIds = targetsRaw.split(',').map((v) => Number(String(v).trim())).filter((v) => Number.isFinite(v) && v > 0);

        if (!fleetId) {
          showToast('Select an attacker fleet first.', 'warning');
          return;
        }
        if (!targetIds.length) {
          showToast('Enter at least one target colony id.', 'warning');
          return;
        }

        const resultRoot = root.querySelector('#intel-matchup-results');
        if (resultRoot) resultRoot.innerHTML = '<div class="text-muted small">Running scan...</div>';

        try {
          const response = await api.matchupScan({
            attacker_fleet_id: fleetId,
            target_colony_ids: targetIds,
            iterations: Math.max(1, Math.min(2000, iterations || 200)),
            deterministic_seed: seed || undefined,
          });
          if (!response.success || !response.scan) {
            throw new Error(response.error || 'Matchup scan failed.');
          }
          lastMatchupScan = response.scan;
          await render();
          showToast('Combat matchup scan complete.', 'success');
        } catch (err) {
          if (resultRoot) resultRoot.innerHTML = '<div class="text-red small">Scan failed.</div>';
          showToast(String(err?.message || 'Matchup scan failed.'), 'error');
        }
      });

      root.querySelector('#intel-clear-matchup-scan')?.addEventListener('click', async () => {
        lastMatchupScan = null;
        await render();
      });
    }

    async function render() {
      const root = wm.body('intel');
      if (!root) return;

      root.innerHTML = uiKitSkeletonHTML();

      try {
        const [spyResponse, battleResponse, fleetsResponse] = await Promise.all([
          api.spyReports(),
          api.battleReports(),
          api.fleets(),
        ]);
        if (!spyResponse.success || !Array.isArray(spyResponse.spy_reports)) {
          root.innerHTML = '<p class="text-red">Failed to load intel reports.</p>';
          return;
        }

        const battleReports = battleResponse?.success && Array.isArray(battleResponse.battle_reports)
          ? battleResponse.battle_reports
          : [];
        const fleets = fleetsResponse?.success && Array.isArray(fleetsResponse.fleets)
          ? fleetsResponse.fleets
          : [];

        const spyReports = spyResponse.spy_reports;
        if (!spyReports.length && !battleReports.length) {
          root.innerHTML = renderMatchupScanPanel(fleets) + uiKitEmptyStateHTML('No intel reports yet', 'Launch reconnaissance or battle missions to collect fresh intel.');
          attachEventListeners(root);
          return;
        }

        let html = '<div>';
        html += renderMatchupScanPanel(fleets);
        const sharedBadge = spyResponse.alliance_shared ? ' <span class="lb-alliance-tag">Alliance shared</span>' : '';
        html += `<div class="system-card" style="margin-bottom:1rem"><div class="system-row"><strong>Spy Reports (${spyReports.length})</strong>${sharedBadge}</div></div>`;
        for (const report of spyReports) {
          html += renderSpyReportCard(report);
        }
        html += `<div class="system-card" style="margin:1rem 0"><div class="system-row"><strong>Battle Reports (${battleReports.length})</strong></div></div>`;
        for (const report of battleReports) {
          html += renderBattleReportCard(report);
        }
        html += '</div>';
        root.innerHTML = html;
        attachEventListeners(root);
        // Bind View Hyperlinks for navigation
        const ViewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
        if (ViewHyperlinks) ViewHyperlinks.bindAll(root);
      } catch (e) {
        root.innerHTML = '<p class="text-red">Error: ' + esc(String(e.message || 'Unknown error')) + '</p>';
      }
    }

    return { render };
  }

  const api = { createIntelController };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.GQRuntimeIntelController = api; }
})();