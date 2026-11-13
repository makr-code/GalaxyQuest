'use strict';

(function () {
  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  function createElement(documentRef, tagName, className = '', text = '') {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text !== null && text !== undefined) element.textContent = String(text);
    return element;
  }

  function createOverviewLists(opts = {}) {
    const {
      windowRef = window,
      fmt = (value) => String(value ?? 0),
      fmtName = (value) => String(value || ''),
      countdown = () => '-',
      api = null,
      showToast = () => {},
      getAudioManager = () => null,
    } = opts;

    function readPercent(...values) {
      for (const value of values) {
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
          return Math.round(parsed);
        }
      }
      return null;
    }

    function renderFleetList(params = {}) {
      const {
        root = null,
        onReload = async () => {},
      } = params;

      const fleetList = root?.querySelector?.('#fleet-list-wm');
      const fleets = windowRef._GQ_fleets || [];
      if (!fleetList) return;
      if (!fleets.length) {
        const empty = createElement(fleetList.ownerDocument, 'p', 'text-muted', 'No active fleets.');
        fleetList.replaceChildren(empty);
        return;
      }

      const documentRef = fleetList.ownerDocument;
      const rows = fleets.map((fleet) => {
        const pos = fleet.current_pos || {};
        const coordinates = [pos.x, pos.y, pos.z].map(Number);
        const fleetId = numericId(fleet.id);
        const row = createElement(documentRef, 'div', 'fleet-row');
        row.dataset.fleetId = fleetId ? String(fleetId) : '';

        const labelWrap = createElement(documentRef, 'span', 'fleet-label-wrap');
        const label = fleet.fleet_label ? String(fleet.fleet_label) : '';
        const labelText = createElement(documentRef, 'span', 'fleet-label-text', label);
        labelText.title = label || `Fleet ${String(fleet.id || '')}`;
        labelWrap.append(labelText);
        if (fleetId) {
          const editButton = createElement(documentRef, 'button', 'fleet-label-edit-btn', '✎');
          editButton.setAttribute('aria-label', 'Fleet umbenennen');
          editButton.title = 'Fleet umbenennen';
          editButton.dataset.fid = String(fleetId);
          editButton.dataset.label = label;
          labelWrap.append(editButton);
        }
        row.append(labelWrap);

        row.append(createElement(documentRef, 'span', 'fleet-mission', String(fleet.mission || '').toUpperCase()));
        const target = createElement(
          documentRef,
          'span',
          'fleet-target',
          `-> ${String(fleet.target_system_name || `[${fleet.target_galaxy}:${fleet.target_system}:${fleet.target_position}]`)}`
        );
        target.title = `[${String(fleet.target_galaxy || '')}:${String(fleet.target_system || '')}:${String(fleet.target_position || '')}]`;
        row.append(target);

        if (coordinates.every(Number.isFinite)) {
          const position = createElement(
            documentRef,
            'span',
            'fleet-pos',
            `POS ${coordinates.map((value) => Math.round(value)).join(', ')} ly`
          );
          position.title = '3D position';
          row.append(position);
        }

        const timer = createElement(documentRef, 'span', 'fleet-timer', countdown(fleet.arrival_time));
        timer.dataset.end = String(fleet.arrival_time || '');
        row.append(timer);

        if (fleet.departure_time && fleet.arrival_time) {
          const depMs = new Date(fleet.departure_time).getTime();
          const arrMs = new Date(fleet.arrival_time).getTime();
          const totalMs = arrMs - depMs;

          if (Number.isFinite(depMs) && Number.isFinite(arrMs) && totalMs > 0) {
            const progressPct = Math.min(100, Math.round(Math.max(0, ((Date.now() - depMs) / totalMs) * 100)));
            const progressTone = progressPct < 30 ? 'is-critical' : (progressPct < 70 ? 'is-warning' : 'is-good');
            const progress = createElement(documentRef, 'div', 'entity-bars');
            progress.style.margin = '0 4px 0 0';
            const progressRow = createElement(documentRef, 'div', 'entity-bar-row');
            progressRow.title = `Fleet transit progress ${progressPct}%`;
            const progressLabel = createElement(documentRef, 'span', 'entity-bar-label', 'Transit');
            progressLabel.style.fontSize = '0.7rem';
            const progressBarWrap = createElement(documentRef, 'div', 'bar-wrap');
            progressBarWrap.style.minWidth = '60px';
            const progressBar = createElement(documentRef, 'div', `bar-fill bar-integrity ${progressTone}`);
            progressBar.style.width = `${progressPct}%`;
            progressBar.style.height = '6px';
            progressBarWrap.append(progressBar);
            const progressValue = createElement(documentRef, 'span', 'entity-bar-value', `${progressPct}%`);
            progressValue.style.fontSize = '0.7rem';
            progressRow.append(progressLabel, progressBarWrap, progressValue);
            progress.append(progressRow);
            row.append(progress);
          }
        }

        const shieldPct = readPercent(
          fleet.shield_pct
          ?? fleet.shields_pct
          ?? fleet.shield_integrity_pct
          ?? fleet.defense_shield_pct
        );
        if (shieldPct !== null) {
          const shieldTone = shieldPct < 30 ? 'is-critical' : (shieldPct < 60 ? 'is-warning' : 'is-good');
          const health = createElement(documentRef, 'div', 'entity-bars entity-bars-compact');
          health.setAttribute('aria-label', 'Fleet status bars');
          const healthRow = createElement(documentRef, 'div', 'entity-bar-row');
          healthRow.title = `Fleet shields ${shieldPct}%`;
          healthRow.append(createElement(documentRef, 'span', 'entity-bar-label', 'Shield'));
          const healthBarWrap = createElement(documentRef, 'div', 'bar-wrap');
          const healthBar = createElement(documentRef, 'div', `bar-fill bar-shield ${shieldTone}`);
          healthBar.style.width = `${shieldPct}%`;
          healthBarWrap.append(healthBar);
          healthRow.append(healthBarWrap);
          healthRow.append(createElement(documentRef, 'span', 'entity-bar-value', `${shieldPct}%`));
          health.append(healthRow);
          row.append(health);
        }

        const vessels = Array.isArray(fleet.vessels) ? fleet.vessels : [];
        const vesselChips = vessels
          .slice(0, 5)
          .map((vessel) => createElement(
            documentRef,
            'span',
            'fleet-vessel-chip',
            `${fmtName(vessel.type)} x${String(vessel.count)}`
          ));
        if (vesselChips.length) {
          const vesselList = createElement(documentRef, 'div', 'fleet-vessel-list');
          vesselList.append(...vesselChips);
          row.append(vesselList);
        }

        if (fleet.returning) row.append(createElement(documentRef, 'span', 'fleet-returning', 'Returning'));

        const rawStealthSec = Number(fleet.stealth_remaining_s || 0);
        const stealthSec = Number.isFinite(rawStealthSec) && rawStealthSec > 0 ? Math.floor(rawStealthSec) : 0;
        if (stealthSec > 0) {
          const stealth = createElement(documentRef, 'span', 'fleet-stealth-badge', `Stealth ${stealthSec}s`);
          stealth.title = `Vel'Ar stealth: ${stealthSec}s remaining`;
          row.append(stealth);
        }
        const hullDmg = readPercent(fleet.hull_damage_pct) ?? 0;
        if (hullDmg > 0) {
          const hull = createElement(documentRef, 'span', 'fleet-hull-badge', `Hull ${hullDmg}%`);
          hull.title = `Kryl'Tha hull damage: -${hullDmg}% attack`;
          row.append(hull);
        }

        if (!fleet.returning && fleetId) {
          const recallButton = createElement(documentRef, 'button', 'btn btn-warning btn-sm recall-btn', 'Recall');
          recallButton.dataset.fid = String(fleetId);
          row.append(recallButton);
        }

        return row;
      });
      fleetList.replaceChildren(...rows);

      fleetList.querySelectorAll('.recall-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const fleetId = numericId(btn.dataset.fid);
          if (!fleetId) return;
          const response = await api.recallFleet(fleetId);
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

      fleetList.querySelectorAll('.fleet-label-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const wrap = btn.closest('.fleet-label-wrap');
          if (!wrap || wrap.querySelector('.fleet-label-input')) return;
          const fleetId = numericId(btn.dataset.fid);
          if (!fleetId) return;
          const textSpan = wrap.querySelector('.fleet-label-text');
          const currentLabel = btn.dataset.label || '';
          const input = windowRef.document.createElement('input');
          input.type = 'text';
          input.maxLength = 48;
          input.className = 'fleet-label-input';
          input.value = currentLabel;
          input.setAttribute('aria-label', 'Fleet label');
          wrap.insertBefore(input, textSpan);
          textSpan.style.display = 'none';
          btn.style.display = 'none';
          input.focus();
          input.select();

          async function _save() {
            const newLabel = input.value.trim().slice(0, 48);
            try {
              const res = await api.renameFleet(fleetId, newLabel);
              if (res && res.success !== false) {
                btn.dataset.label = newLabel;
                textSpan.textContent = newLabel;
                showToast(newLabel ? `Fleet umbenannt: "${newLabel}"` : 'Fleet-Label entfernt.', 'success');
              } else {
                showToast((res && res.error) || 'Fehler beim Umbenennen.', 'error');
              }
            } catch (_) {
              showToast('Fehler beim Umbenennen.', 'error');
            }
            input.remove();
            textSpan.style.display = '';
            btn.style.display = '';
          }

          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); _save(); }
            if (e.key === 'Escape') { input.remove(); textSpan.style.display = ''; btn.style.display = ''; }
          });
          input.addEventListener('blur', () => _save());
        });
      });
    }

    function renderBattleLog(params = {}) {
      const {
        root = null,
      } = params;

      const battleLog = root?.querySelector?.('#battle-log-wm');
      if (!battleLog) return;
      const battles = windowRef._GQ_battles || [];
      if (!battles.length) {
        const empty = createElement(battleLog.ownerDocument, 'p', 'text-muted', 'No battles yet.');
        battleLog.replaceChildren(empty);
        return;
      }

      const documentRef = battleLog.ownerDocument;
      const rows = battles.map((battle) => {
        const report = battle.report || {};
        const won = report.attacker_wins;
        const loot = report.loot || {};
        const row = createElement(documentRef, 'div', `battle-row ${won ? 'battle-win' : 'battle-loss'}`);
        row.append(createElement(documentRef, 'span', 'battle-result', won ? 'Victory' : 'Defeat'));
        row.append(createElement(documentRef, 'span', 'battle-vs', `vs ${String(battle.defender_name ?? '')}`));
        const time = createElement(
          documentRef,
          'span',
          'battle-time',
          new Date(battle.created_at).toLocaleString()
        );
        time.style.fontSize = '0.75rem';
        time.style.color = 'var(--text-muted)';
        row.append(time);

        const lootText = [
          loot.metal > 0 ? `MET ${fmt(loot.metal)}` : '',
          loot.crystal > 0 ? `CRY ${fmt(loot.crystal)}` : '',
          loot.deuterium > 0 ? `DEU ${fmt(loot.deuterium)}` : '',
          loot.rare_earth > 0 ? `RRE ${fmt(loot.rare_earth)}` : '',
        ].filter(Boolean).join(' ');
        if (won && lootText) row.append(createElement(documentRef, 'span', 'battle-loot', lootText));
        return row;
      });
      battleLog.replaceChildren(...rows);
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