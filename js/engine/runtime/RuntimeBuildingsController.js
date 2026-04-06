'use strict';

(function () {
  function createBuildingsController(opts = {}) {
    const {
      wm = null,
      api = null,
      windowRef = (typeof window !== 'undefined' ? window : null),
      documentRef = (typeof document !== 'undefined' ? document : null),
      getCurrentColony = () => null,
      getUiState = () => ({}),
      getBuildingUiMeta = () => ({ cat: 'Other', icon: '', desc: '' }),
      fmtName = (value) => String(value || ''),
      fmt = (value) => String(value || 0),
      esc = (value) => String(value || ''),
      countdown = (value) => String(value || ''),
      simulateBuildingUpgrade = () => ({}),
      buildUpgradePreviewModal = () => '',
      queueColonySurfaceSceneData = () => {},
      updateResourceBar = () => {},
      showToast = () => {},
      gameLog = () => {},
    } = opts;

    return {
      getBuildingFocus() {
        const currentColony = getCurrentColony();
        const uiState = getUiState();
        return uiState.colonyViewFocus && Number(uiState.colonyViewFocus.colonyId) === Number(currentColony?.id)
          ? String(uiState.colonyViewFocus.focusBuilding || '')
          : '';
      },

      groupByCategory(buildings) {
        const byCategory = {};
        for (const building of buildings) {
          const meta = getBuildingUiMeta(building.type);
          (byCategory[meta.cat] ??= []).push({ ...building, meta });
        }
        return byCategory;
      },

      buildQueueHtml(upgradeQueue) {
        if (!upgradeQueue.length) return '';
        const active = upgradeQueue.find((q) => String(q.status || '') === 'running') || null;
        const queued = upgradeQueue.filter((q) => String(q.status || '') === 'queued');
        return `
        <div class="system-card" style="margin-bottom:0.8rem">
          <div class="system-row"><strong>Bauauftrags-Queue</strong></div>
          ${active ? `<div class="system-row">­ƒöº Aktiv: ${esc(fmtName(active.type || 'building'))} -> Lv ${esc(String(active.target_level || '?'))} ┬À ETA <span data-end="${esc(active.eta)}">${countdown(active.eta)}</span></div>` : '<div class="system-row text-muted">Aktuell kein aktiver Auftrag.</div>'}
          ${queued.length ? `<div class="system-row">­ƒôï Wartend: ${queued.map((q) => `${esc(fmtName(q.type || 'building'))} -> Lv ${esc(String(q.target_level || '?'))}`).join(' ┬À ')}</div>` : '<div class="system-row text-muted">Keine weiteren Auftr├ñge in Warteschlange.</div>'}
        </div>`;
      },

      buildCardsHtml(byCategory, buildingFocus) {
        const catOrder = ['Extraction', 'Energy', 'Life Support', 'Population', 'Industry', 'Storage', 'Science', 'Military', 'Advanced', 'Other'];
        let html = '';
        for (const cat of catOrder) {
          const items = byCategory[cat];
          if (!items?.length) continue;
          html += `<div class="building-category"><h4 class="building-cat-title">${cat}</h4><div class="card-grid">`;
          for (const building of items) {
            const busy = !!building.upgrade_end;
            let upgradeProgressPct = 0;
            let upgradeTone = 'is-good';
            if (busy && building.upgrade_start && building.upgrade_end) {
              const now = Date.now();
              const startMs = new Date(building.upgrade_start).getTime();
              const endMs = new Date(building.upgrade_end).getTime();
              const totalMs = endMs - startMs;
              if (totalMs > 0) {
                upgradeProgressPct = Math.min(100, Math.round(Math.max(0, (now - startMs) / totalMs * 100)));
                upgradeTone = upgradeProgressPct < 30 ? 'is-critical' : (upgradeProgressPct < 70 ? 'is-warning' : 'is-good');
              }
            }
            const cost = building.next_cost;
            const rawIntegrity = Number(
              building.integrity_pct
              ?? building.health_pct
              ?? building.hp_pct
              ?? building.condition_pct
              ?? (busy ? 92 : 100)
            );
            const integrityPct = Number.isFinite(rawIntegrity)
              ? Math.max(0, Math.min(100, Math.round(rawIntegrity)))
              : (busy ? 92 : 100);
            const rawShield = Number(
              building.shield_pct
              ?? building.shields_pct
              ?? building.defense_shield_pct
              ?? ((building.meta?.cat === 'Military' || building.meta?.cat === 'Advanced')
                ? Math.min(100, Math.round(25 + Number(building.level || 0) * 8))
                : 0)
            );
            const shieldPct = Number.isFinite(rawShield)
              ? Math.max(0, Math.min(100, Math.round(rawShield)))
              : 0;
            const integrityTone = integrityPct < 30 ? 'is-critical' : (integrityPct < 60 ? 'is-warning' : 'is-good');
            const shieldTone = shieldPct < 30 ? 'is-critical' : (shieldPct < 60 ? 'is-warning' : 'is-good');
            html += `
            <div class="item-card ${buildingFocus === building.type ? 'item-card-focus' : ''}" data-building-type="${esc(building.type)}">
              <div class="item-card-header">
                <span class="item-name">${building.meta.icon} ${fmtName(building.type)}</span>
                <span class="item-level">Lv ${building.level}</span>
              </div>
              <div class="item-desc">${building.meta.desc}</div>
              <div class="entity-bars" aria-label="Building status bars">
                <div class="entity-bar-row" title="Building integrity ${integrityPct}%">
                  <span class="entity-bar-label">Health</span>
                  <div class="bar-wrap"><div class="bar-fill bar-integrity ${integrityTone}" style="width:${integrityPct}%"></div></div>
                  <span class="entity-bar-value">${integrityPct}%</span>
                </div>
                <div class="entity-bar-row" title="Building shields ${shieldPct}%">
                  <span class="entity-bar-label">Shield</span>
                  <div class="bar-wrap"><div class="bar-fill bar-shield ${shieldTone}" style="width:${shieldPct}%"></div></div>
                  <span class="entity-bar-value">${shieldPct}%</span>
                </div>
              </div>
              <div class="item-cost">
                ${cost.metal ? `<span class="cost-metal">Ô¼í ${fmt(cost.metal)}</span>` : ''}
                ${cost.crystal ? `<span class="cost-crystal">­ƒÆÄ ${fmt(cost.crystal)}</span>` : ''}
                ${cost.deuterium ? `<span class="cost-deut">­ƒöÁ ${fmt(cost.deuterium)}</span>` : ''}
              </div>
              ${busy
                ? `<div class="item-timer">ÔÅ│ ETA <span data-end="${esc(building.upgrade_end)}">${countdown(building.upgrade_end)}</span></div>
                <div class="entity-bars" style="margin-top:0.2rem;">
                  <div class="entity-bar-row" title="Upgrade progress ${upgradeProgressPct}%">
                    <span class="entity-bar-label">Upgr</span>
                    <div class="bar-wrap"><div class="bar-fill bar-integrity ${upgradeTone}" style="width:${upgradeProgressPct}%"></div></div>
                    <span class="entity-bar-value">${upgradeProgressPct}%</span>
                  </div>
                </div>`
                : `<button class="btn btn-primary btn-sm upgrade-btn" data-type="${esc(building.type)}">Ôåæ Upgrade</button>`}
            </div>`;
          }
          html += '</div></div>';
        }
        return html;
      },

      async handleUpgrade(type, btn) {
        const currentColony = getCurrentColony();
        btn.disabled = true;
        const response = await api.upgrade(currentColony.id, type);
        if (response.success) {
          const queuePos = Number(response.queue_position || 0);
          const targetLevel = Number(response.target_level || 0);
          if (queuePos > 1) showToast(`Queued ${fmtName(type)} -> Lv ${targetLevel} (Position ${queuePos}).`, 'success');
          else showToast(`Upgrading ${fmtName(type)} -> Lv ${targetLevel}ÔÇª`, 'success');
          const resources = await api.resources(currentColony.id);
          if (resources.success) Object.assign(currentColony, resources.resources);
          updateResourceBar();
          await this.render();
        } else {
          showToast(response.error || 'Upgrade failed', 'error');
          btn.disabled = false;
        }
      },

      bindActions(root, buildingFocus) {
        root.querySelectorAll('.upgrade-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const buildingType = btn.dataset.type;
            const building = windowRef._GQ_buildings?.find((b) => String(b.type || '') === String(buildingType || '')) || null;

            if (!building) {
              showToast('Building data not found.', 'error');
              return;
            }

            const simulation = simulateBuildingUpgrade(building);
            const previewHtml = buildUpgradePreviewModal(building, simulation);

            const modalContainer = documentRef.createElement('div');
            modalContainer.innerHTML = previewHtml;
            documentRef.body.appendChild(modalContainer);

            const confirmBtn = modalContainer.querySelector('#preview-confirm-btn');
            const cancelBtn = modalContainer.querySelector('#preview-cancel-btn');

            const closeModal = () => {
              modalContainer.remove();
            };

            cancelBtn.addEventListener('click', closeModal);

            confirmBtn.addEventListener('click', async () => {
              closeModal();
              await this.handleUpgrade(buildingType, btn);
            });

            modalContainer.querySelector('div').parentElement.addEventListener('click', (e) => {
              if (e.target === modalContainer.querySelector('div').parentElement) {
                closeModal();
              }
            });
          });
        });
        if (buildingFocus) {
          const focusEl = root.querySelector(`.item-card[data-building-type="${buildingFocus}"]`);
          if (focusEl) focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      },

      async render() {
        const root = wm.body('buildings');
        if (!root) return;
        const currentColony = getCurrentColony();
        const uiState = getUiState();
        if (!currentColony) {
          root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
          return;
        }
        root.innerHTML = '<p class="text-muted">LoadingÔÇª</p>';
        const buildingFocus = this.getBuildingFocus();

        try {
          await api.finishBuilding(currentColony.id);
          const data = await api.buildings(currentColony.id);
          if (!data.success) {
            root.innerHTML = '<p class="text-red">Error loading buildings.</p>';
            return;
          }

          windowRef._GQ_buildings = data.buildings || [];

          const byCategory = this.groupByCategory(data.buildings || []);
          const upgradeQueue = Array.isArray(data.upgrade_queue) ? data.upgrade_queue : [];
          queueColonySurfaceSceneData(currentColony, data);
          let html = '';
          if (buildingFocus) {
            html += `<div class="build-focus-banner">Fokus: ${fmtName(buildingFocus)}${uiState.colonyViewFocus?.source ? ` ┬À Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>`;
          }
          html += this.buildQueueHtml(upgradeQueue);
          html += this.buildCardsHtml(byCategory, buildingFocus);
          root.innerHTML = html;
          this.bindActions(root, buildingFocus);
        } catch (err) {
          gameLog('warn', 'Buildings view laden fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to load buildings.</p>';
        }
      },
    };
  }

  const api = { createBuildingsController };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeBuildingsController = api;
  }
})();