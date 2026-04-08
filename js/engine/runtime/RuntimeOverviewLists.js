'use strict';

(function () {
  function createOverviewLists(opts = {}) {
    const {
      windowRef = window,
      esc = (value) => String(value || ''),
      fmt = (value) => String(value ?? 0),
      fmtName = (value) => String(value || ''),
      countdown = () => '-',
      api = null,
      showToast = () => {},
      getAudioManager = () => null,
    } = opts;

    function renderFleetList(params = {}) {
      const {
        root = null,
        renderTemplateList = () => '',
        onReload = async () => {},
      } = params;

      const fleetList = root?.querySelector?.('#fleet-list-wm');
      const fleets = windowRef._GQ_fleets || [];
      if (!fleetList) return;
      if (!fleets.length) {
        fleetList.innerHTML = '<p class="text-muted">No active fleets.</p>';
        return;
      }

      fleetList.innerHTML = renderTemplateList('fleetRow', fleets.map((fleet) => {
        const pos = fleet.current_pos || {};
        const positionHtml = (pos.x !== undefined)
          ? `<span class="fleet-pos" title="3D position">POS ${esc(String(pos.x.toFixed(0)))}, ${esc(String(pos.y.toFixed(0)))}, ${esc(String(pos.z.toFixed(0)))} ly</span>`
          : '';
        const vesselChips = (fleet.vessels || [])
          .slice(0, 5)
          .map((vessel) => `<span class="fleet-vessel-chip">${esc(fmtName(vessel.type))} x${esc(String(vessel.count))}</span>`)
          .join('');
        const vesselListHtml = vesselChips ? `<div class="fleet-vessel-list">${vesselChips}</div>` : '';

        let progressPct = 0;
        let progressTone = 'is-good';
        let progressHtml = '';

        if (fleet.departure_time && fleet.arrival_time) {
          const now = Date.now();
          const depMs = new Date(fleet.departure_time).getTime();
          const arrMs = new Date(fleet.arrival_time).getTime();
          const totalMs = arrMs - depMs;

          if (totalMs > 0) {
            progressPct = Math.min(100, Math.round(Math.max(0, ((now - depMs) / totalMs) * 100)));
            progressTone = progressPct < 30 ? 'is-critical' : (progressPct < 70 ? 'is-warning' : 'is-good');
          }

          progressHtml = `<div class="entity-bars" style="margin:0 4px 0 0;">
            <div class="entity-bar-row" title="Fleet transit progress ${progressPct}%">
              <span class="entity-bar-label" style="font-size:0.7rem;">Transit</span>
              <div class="bar-wrap" style="min-width:60px;"><div class="bar-fill bar-integrity ${progressTone}" style="width:${progressPct}%;height:6px;"></div></div>
              <span class="entity-bar-value" style="font-size:0.7rem;">${progressPct}%</span>
            </div>
          </div>`;
        }

        const stealthSec = Number(fleet.stealth_remaining_s || 0);
        const stealthBadge = stealthSec > 0
          ? `<span class="fleet-stealth-badge" title="Vel'Ar stealth: ${stealthSec}s remaining">Stealth ${stealthSec}s</span>`
          : '';
        const hullDmg = Number(fleet.hull_damage_pct || 0);
        const hullBadge = hullDmg > 0
          ? `<span class="fleet-hull-badge" title="Kryl'Tha hull damage: -${hullDmg}% attack">Hull ${hullDmg}%</span>`
          : '';
        const hullIntegrityPct = Math.max(0, Math.min(100, 100 - hullDmg));
        const rawShieldPct = Number(
          fleet.shield_pct
          ?? fleet.shields_pct
          ?? fleet.shield_integrity_pct
          ?? fleet.defense_shield_pct
          ?? 100
        );
        const shieldPct = Number.isFinite(rawShieldPct)
          ? Math.max(0, Math.min(100, Math.round(rawShieldPct)))
          : 100;
        const hullIntegrityTone = hullIntegrityPct < 30 ? 'is-critical' : (hullIntegrityPct < 60 ? 'is-warning' : 'is-good');
        const shieldTone = shieldPct < 30 ? 'is-critical' : (shieldPct < 60 ? 'is-warning' : 'is-good');
        const fleetHealthHtml = `
          <div class="entity-bars entity-bars-compact" aria-label="Fleet status bars">
            <div class="entity-bar-row" title="Fleet hull integrity ${hullIntegrityPct}%">
              <span class="entity-bar-label">Hull</span>
              <div class="bar-wrap"><div class="bar-fill bar-integrity ${hullIntegrityTone}" style="width:${hullIntegrityPct}%"></div></div>
              <span class="entity-bar-value">${hullIntegrityPct}%</span>
            </div>
            <div class="entity-bar-row" title="Fleet shields ${shieldPct}%">
              <span class="entity-bar-label">Shield</span>
              <div class="bar-wrap"><div class="bar-fill bar-shield ${shieldTone}" style="width:${shieldPct}%"></div></div>
              <span class="entity-bar-value">${shieldPct}%</span>
            </div>
          </div>`;

        return {
          mission: esc(String(fleet.mission || '').toUpperCase()),
          targetGalaxy: esc(String(fleet.target_galaxy || '')),
          targetSystem: esc(String(fleet.target_system || '')),
          targetPosition: esc(String(fleet.target_position || '')),
          targetSystemName: esc(fleet.target_system_name || `[${fleet.target_galaxy}:${fleet.target_system}:${fleet.target_position}]`),
          positionHtml,
          arrivalTimeRaw: esc(String(fleet.arrival_time || '')),
          departureTimeRaw: esc(String(fleet.departure_time || '')),
          arrivalCountdown: esc(countdown(fleet.arrival_time)),
          progressPct: esc(String(progressPct)),
          progressHtml,
          fleetHealthHtml,
          vesselListHtml,
          returningBadgeHtml: fleet.returning ? '<span class="fleet-returning">Returning</span>' : '',
          ftlBadgesHtml: stealthBadge + hullBadge,
          recallButtonHtml: !fleet.returning
            ? `<button class="btn btn-warning btn-sm recall-btn" data-fid="${esc(String(fleet.id || ''))}">Recall</button>`
            : '',
        };
      }));

      fleetList.querySelectorAll('.recall-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const response = await api.recallFleet(parseInt(btn.dataset.fid, 10));
          if (response.success) {
            const audioManager = getAudioManager();
            if (audioManager && typeof audioManager.playFleetRecall === 'function') audioManager.playFleetRecall();
            showToast('Fleet recalled.', 'success');
            await onReload();
          } else {
            showToast(response.error || 'Recall failed', 'error');
          }
        });
      });
    }

    function renderBattleLog(params = {}) {
      const {
        root = null,
        renderTemplateList = () => '',
      } = params;

      const battleLog = root?.querySelector?.('#battle-log-wm');
      if (!battleLog) return;
      const battles = windowRef._GQ_battles || [];
      if (!battles.length) {
        battleLog.innerHTML = '<p class="text-muted">No battles yet.</p>';
        return;
      }

      battleLog.innerHTML = renderTemplateList('battleRow', battles.map((battle) => {
        const report = battle.report || {};
        const won = report.attacker_wins;
        const loot = report.loot || {};
        const lootStr = [
          loot.metal > 0 ? `MET ${fmt(loot.metal)}` : '',
          loot.crystal > 0 ? `CRY ${fmt(loot.crystal)}` : '',
          loot.deuterium > 0 ? `DEU ${fmt(loot.deuterium)}` : '',
          loot.rare_earth > 0 ? `RRE ${fmt(loot.rare_earth)}` : '',
        ].filter(Boolean).join(' ');
        return {
          battleClass: won ? 'battle-win' : 'battle-loss',
          resultLabel: won ? 'Victory' : 'Defeat',
          defenderName: esc(battle.defender_name),
          createdAt: esc(new Date(battle.created_at).toLocaleString()),
          lootHtml: won && lootStr ? `<span class="battle-loot">${esc(lootStr)}</span>` : '',
        };
      }));
    }

    return {
      renderFleetList,
      renderBattleLog,
    };
  }

  const api = { createOverviewLists };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeOverviewLists = api;
  }
})();