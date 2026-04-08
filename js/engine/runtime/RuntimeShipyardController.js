'use strict';
(function () {
  function createShipyardController({
    wm,
    api,
    windowRef,
    documentRef,
    getCurrentColony,
    updateResourceBar,
    fmt,
    fmtName,
    esc,
    countdown,
    showToast,
    gameLog,
    gqStatusMsg,
    GQUI,
  } = {}) {
    const moduleCatalogCache = new Map();
    let _pendingHulls = [];

    // ── Pure data helpers ──────────────────────────────────────────────────

    function computeSlotProfile(hull, layoutCode = 'default') {
      const base = Object.assign({}, hull?.slot_profile || {});
      const layout = hull?.slot_variations?.[layoutCode] || null;
      const adjustments = layout?.slot_adjustments || {};
      Object.entries(adjustments).forEach(([group, delta]) => {
        base[group] = Math.max(0, Number(base[group] || 0) + Number(delta || 0));
      });
      return base;
    }

    function moduleCatalogKey(hullCode, layoutCode) {
      return `${String(hullCode || '')}|${String(layoutCode || 'default')}`;
    }

    async function fetchModuleCatalog(colonyId, hullCode, layoutCode = 'default') {
      const key = moduleCatalogKey(hullCode, layoutCode);
      if (moduleCatalogCache.has(key)) {
        return moduleCatalogCache.get(key);
      }
      const response = await api.shipyardModules(colonyId, hullCode, layoutCode);
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load module catalog.');
      }
      moduleCatalogCache.set(key, response);
      return response;
    }

    // ── DOM builders ───────────────────────────────────────────────────────

    function renderSlotProfile(profile = {}) {
      const entries = Object.entries(profile || {}).filter(([, count]) => Number(count || 0) > 0);
      const frag = documentRef.createDocumentFragment();
      if (!entries.length) {
        const s = new GQUI.Span().setClass('text-muted small').setTextContent('No slots');
        frag.appendChild(s.dom);
        return frag;
      }
      entries.forEach(([group, count], i) => {
        if (i > 0) frag.appendChild(documentRef.createTextNode(' '));
        const chip = new GQUI.Span();
        chip.dom.style.cssText = 'display:inline-flex;align-items:center;gap:0.25rem;padding:0.15rem 0.4rem;border:1px solid rgba(120,145,180,0.35);border-radius:999px;background:rgba(80,108,152,0.14);font-size:0.7rem;';
        chip.dom.textContent = `${fmtName(group)} ${fmt(count)}`;
        frag.appendChild(chip.dom);
      });
      return frag;
    }

    function renderAffinityChips(affinities = []) {
      const list = Array.isArray(affinities) ? affinities.filter((a) => !!a) : [];
      const frag = documentRef.createDocumentFragment();
      if (!list.length) return frag;
      const fmtBonus = (type, val) => {
        const v = Number(val);
        if (type === 'cost_pct') return `Kosten ${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
        if (type === 'build_time_pct') return `Bauzeit ${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
        if (type === 'stat_mult') return `Stats ${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
        if (type === 'unlock_tier') return `Tier +${v.toFixed(0)}`;
        return `${type} ${v}`;
      };
      list.forEach((a) => {
        const active = !!a.active;
        const bonusText = fmtBonus(a.bonus_type, a.bonus_value);
        const titleText = `${String(a.faction_name || a.faction_code || '?')}: ${bonusText} \u00b7 Ben\u00f6tigt Stand ${a.min_standing} \u00b7 Aktuell ${a.user_standing ?? '?'}`;
        const chip = new GQUI.Span();
        chip.setClass('shipyard-affinity-chip ' + (active ? 'affinity-active' : 'affinity-inactive'));
        chip.dom.title = titleText;
        chip.dom.textContent = `${String(a.faction_icon || '\u2b21')} ${bonusText}`;
        frag.appendChild(chip.dom);
      });
      return frag;
    }

    function renderModuleSlotEditor(moduleCatalog) {
      const groups = Array.isArray(moduleCatalog?.module_groups) ? moduleCatalog.module_groups : [];
      if (!groups.length) {
        const span = new GQUI.Span().setClass('text-muted small').setTextContent('No module groups available for this hull/layout.');
        return span.dom;
      }

      const editor = new GQUI.Div().setClass('shipyard-slot-editor');
      let hasGroups = false;
      groups.forEach((group) => {
        const slotCount = Math.max(0, Number(group.slot_count || 0));
        if (!slotCount) return;
        hasGroups = true;

        const groupDiv = new GQUI.Div().setClass('shipyard-slot-group');
        groupDiv.dom.dataset.groupCode = String(group.code || '');
        const labelDiv = new GQUI.Div().setClass('small shipyard-slot-group-label');
        labelDiv.dom.textContent = `${fmtName(group.label || group.code || 'group')} \u00b7 Slots ${fmt(slotCount)}`;
        const affFrag = renderAffinityChips(group.affinities || []);
        if (affFrag.childNodes.length) {
          const chipsWrap = new GQUI.Span().setClass('shipyard-affinity-chips');
          chipsWrap.dom.appendChild(affFrag);
          labelDiv.dom.appendChild(chipsWrap.dom);
        }
        groupDiv.add(labelDiv);

        const rowsDiv = new GQUI.Div().setClass('shipyard-slot-rows');
        for (let idx = 0; idx < slotCount; idx++) {
          const slotRow = new GQUI.Div().setClass('shipyard-slot-row');
          slotRow.dom.dataset.groupCode = String(group.code || '');
          slotRow.dom.dataset.slotIndex = String(idx);

          const lbl = new GQUI.Span().setClass('shipyard-slot-label small').setTextContent('Slot ' + (idx + 1));
          slotRow.add(lbl);

          const sel = documentRef.createElement('select');
          sel.className = 'input shipyard-module-slot';
          sel.dataset.groupCode = String(group.code || '');
          sel.dataset.slotIndex = String(idx);
          const emptyOpt = documentRef.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = '\u2014 empty \u2014';
          sel.appendChild(emptyOpt);
          (Array.isArray(group.modules) ? group.modules : []).forEach((mod) => {
            const statsLabel = Object.entries(mod.stats_delta || {})
              .map(([k, v]) => `${fmtName(k)} ${v >= 0 ? '+' : ''}${fmt(v)}`).join(', ');
            const statsData = Object.entries(mod.stats_delta || {})
              .map(([k, v]) => `${k}:${v}`).join(',');
            const blocker = Array.isArray(mod.blockers) && mod.blockers.length
              ? ` [LOCKED: ${mod.blockers.join(' / ')}]` : '';
            const opt = documentRef.createElement('option');
            opt.value = String(mod.code || '');
            opt.dataset.stats = statsData;
            opt.dataset.tier = String(Number(mod.tier || 1));
            if (mod.unlocked === false) opt.disabled = true;
            opt.textContent = `${String(mod.label || mod.code || 'Module')} (T${fmt(mod.tier || 1)})${statsLabel ? ' \u00b7 ' + statsLabel : ''}${blocker}`;
            sel.appendChild(opt);
          });
          if (!group.modules?.length) sel.disabled = true;
          slotRow.dom.appendChild(sel);

          const arrowsDiv = new GQUI.Div().setClass('shipyard-slot-arrows');
          const upBtn = new GQUI.Button('\u25b2').setClass('btn shipyard-slot-up');
          upBtn.dom.type = 'button';
          upBtn.dom.dataset.groupCode = String(group.code || '');
          upBtn.dom.dataset.slotIndex = String(idx);
          upBtn.dom.title = 'Tauscht diesen Slot mit dem dar\u00fcber';
          if (idx === 0) upBtn.dom.disabled = true;
          const downBtn = new GQUI.Button('\u25bc').setClass('btn shipyard-slot-down');
          downBtn.dom.type = 'button';
          downBtn.dom.dataset.groupCode = String(group.code || '');
          downBtn.dom.dataset.slotIndex = String(idx);
          downBtn.dom.title = 'Tauscht diesen Slot mit dem darunter';
          if (idx === slotCount - 1) downBtn.dom.disabled = true;
          arrowsDiv.add(upBtn, downBtn);
          slotRow.add(arrowsDiv);
          rowsDiv.add(slotRow);
        }
        groupDiv.add(rowsDiv);
        editor.add(groupDiv);
      });

      if (!hasGroups) {
        const span = new GQUI.Span().setClass('text-muted small').setTextContent('No active slots for this layout.');
        return span.dom;
      }
      return editor.dom;
    }

    function collectBlueprintModulesFromUI(root) {
      const selects = Array.from(root.querySelectorAll('.shipyard-module-slot'));
      if (!selects.length) return [];
      const totals = new Map();
      selects.forEach((el) => {
        const code = String(el.value || '').trim();
        if (!code) return;
        totals.set(code, (totals.get(code) || 0) + 1);
      });
      return Array.from(totals.entries()).map(([code, quantity]) => ({ code, quantity }));
    }

    function computeLiveStats(root, baseStats = {}) {
      const slots = Array.from(root.querySelectorAll('.shipyard-module-slot'));
      const totals = Object.assign({ attack: 0, shield: 0, hull: 0, cargo: 0, speed: 0 }, baseStats);
      slots.forEach((sel) => {
        if (!sel.value) return;
        const opt = sel.options[sel.selectedIndex];
        if (!opt) return;
        const statsStr = String(opt.dataset.stats || '');
        statsStr.split(',').forEach((part) => {
          const [key, val] = part.split(':');
          if (!key || val === undefined) return;
          const k = key.trim();
          if (k in totals) totals[k] = (totals[k] || 0) + Number(val);
        });
      });
      return totals;
    }

    function swapSlots(root, groupCode, idxA, idxB) {
      const selA = root.querySelector(`.shipyard-module-slot[data-group-code="${groupCode}"][data-slot-index="${idxA}"]`);
      const selB = root.querySelector(`.shipyard-module-slot[data-group-code="${groupCode}"][data-slot-index="${idxB}"]`);
      if (!selA || !selB) return;
      const tmp = selA.value;
      selA.value = selB.value;
      selB.value = tmp;
      updateStatsPreview(root);
    }

    function updateStatsPreview(root) {
      const preview = root.querySelector('#shipyard-blueprint-stats-preview');
      if (!preview) return;
      const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
      const hullCard = root.querySelector(`.shipyard-hull-base[data-hull-code="${hullCode}"]`);
      const baseStats = hullCard
        ? {
            attack: Number(hullCard.dataset.attack || 0),
            shield: Number(hullCard.dataset.shield || 0),
            hull:   Number(hullCard.dataset.hull   || 0),
            cargo:  Number(hullCard.dataset.cargo  || 0),
            speed:  Number(hullCard.dataset.speed  || 0),
          }
        : {};
      const live = computeLiveStats(root, baseStats);
      const hasMods = Array.from(root.querySelectorAll('.shipyard-module-slot')).some((s) => s.value);
      if (!hasMods) {
        const empty = new GQUI.Div().setClass('shipyard-stats-preview-empty small text-muted')
          .setTextContent('W\u00e4hle Module, um eine Vorschau zu erhalten.');
        preview.replaceChildren(empty.dom);
        return;
      }
      const chipDefs = [
        { cls: 'chiptype-atk',   icon: '\u2616',  key: 'ATK',   val: live.attack },
        { cls: 'chiptype-shd',   icon: '\ud83d\udee1', key: 'SHD',   val: live.shield },
        { cls: 'chiptype-hll',   icon: '\ud83d\udee0', key: 'HULL',  val: live.hull   },
        { cls: 'chiptype-cargo', icon: '\ud83d\udce6', key: 'CARGO', val: live.cargo  },
        { cls: 'chiptype-spd',   icon: '\u26a1', key: 'SPD',   val: live.speed  },
      ];
      const grid = new GQUI.Div().setClass('shipyard-stats-preview-grid');
      chipDefs.forEach(({ cls, icon, key, val }) => {
        const chip = new GQUI.Div().setClass('shipyard-stats-chip ' + cls);
        chip.dom.textContent = icon + ' ' + key + ' ';
        const strong = documentRef.createElement('strong');
        strong.textContent = fmt(val);
        chip.dom.appendChild(strong);
        grid.add(chip);
      });
      const wrap = new GQUI.Div().setClass('shipyard-stats-preview');
      wrap.add(new GQUI.Div().setClass('shipyard-stats-preview-label').setTextContent('Kompilierte Statistiken (Vorschau)'));
      wrap.add(grid);
      preview.replaceChildren(wrap.dom);
    }

    // ── Saved presets (localStorage) ──────────────────────────────────────

    function _presetKey() { return 'gq_shipyard_presets_v1'; }

    function loadPresetsFromStorage() {
      try {
        return JSON.parse(windowRef.localStorage.getItem(_presetKey()) || '[]');
      } catch (err) {
        gameLog('info', 'Shipyard-Presets konnten nicht aus Storage geladen werden', err);
        return [];
      }
    }

    function savePresetToStorage(name, hull, layout, modules) {
      const presets = loadPresetsFromStorage().filter((p) => p.name !== name);
      presets.unshift({ name, hull, layout, modules, ts: Date.now() });
      windowRef.localStorage.setItem(_presetKey(), JSON.stringify(presets.slice(0, 20)));
    }

    function deletePresetFromStorage(name) {
      const presets = loadPresetsFromStorage().filter((p) => p.name !== name);
      windowRef.localStorage.setItem(_presetKey(), JSON.stringify(presets));
    }

    function buildPresetToolbarDom() {
      const presets = loadPresetsFromStorage();
      const sel = documentRef.createElement('select');
      sel.id = 'shipyard-preset-select';
      sel.className = 'input shipyard-preset-select';
      if (!presets.length) sel.disabled = true;
      const placeholder = documentRef.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '\u2014 Preset laden \u2014';
      sel.appendChild(placeholder);
      if (presets.length) {
        presets.forEach((p) => {
          const opt = documentRef.createElement('option');
          opt.value = String(p.name);
          opt.textContent = `${p.name} \u00b7 ${fmtName(p.hull)} / ${fmtName(p.layout)}`;
          sel.appendChild(opt);
        });
      } else {
        const noOpt = documentRef.createElement('option');
        noOpt.value = '';
        noOpt.disabled = true;
        noOpt.textContent = 'Keine Presets gespeichert';
        sel.appendChild(noOpt);
      }

      const loadBtn = new GQUI.Button('Laden').setClass('btn btn-secondary btn-sm');
      loadBtn.dom.id = 'shipyard-preset-load';
      loadBtn.dom.type = 'button';
      if (!presets.length) loadBtn.dom.disabled = true;

      const saveBtn = new GQUI.Button('Speichern').setClass('btn btn-secondary btn-sm');
      saveBtn.dom.id = 'shipyard-preset-save';
      saveBtn.dom.type = 'button';

      const delBtn = new GQUI.Button('L\u00f6schen').setClass('btn btn-warning btn-sm');
      delBtn.dom.id = 'shipyard-preset-delete';
      delBtn.dom.type = 'button';
      if (!presets.length) delBtn.dom.disabled = true;

      const toolbar = new GQUI.Div().setClass('shipyard-preset-toolbar');
      toolbar.dom.appendChild(sel);
      toolbar.add(loadBtn, saveBtn, delBtn);
      return toolbar.dom;
    }

    function refreshPresetToolbar(root) {
      const container = root.querySelector('#shipyard-preset-toolbar-wrap');
      if (container) container.replaceChildren(buildPresetToolbarDom());
      bindPresetActions(root);
    }

    function applyPreset(root, preset, hulls) {
      const hullSel = root.querySelector('#shipyard-blueprint-hull');
      const layoutSel = root.querySelector('#shipyard-blueprint-layout');
      if (hullSel) hullSel.value = preset.hull;
      // Sync hull picker visual selection
      root.querySelectorAll('.shipyard-hull-card').forEach((card) => {
        card.classList.toggle('is-selected', String(card.dataset.hullCode || '') === String(preset.hull || ''));
      });
      updateBlueprintLayoutOptions(root, hulls).then(() => {
        if (layoutSel) layoutSel.value = preset.layout;
        windowRef.setTimeout(() => {
          const groupMap = new Map();
          (Array.isArray(preset.modules) ? preset.modules : []).forEach((m) => {
            if (!groupMap.has(m.group)) groupMap.set(m.group, []);
            for (let i = 0; i < (m.quantity || 1); i++) groupMap.get(m.group).push(m.code);
          });
          root.querySelectorAll('.shipyard-module-slot').forEach((sel) => {
            const g = sel.dataset.groupCode;
            const idx = Number(sel.dataset.slotIndex || 0);
            const codes = groupMap.get(g) || [];
            if (codes[idx] !== undefined) sel.value = codes[idx];
          });
          updateStatsPreview(root);
        }, 80);
      });
    }

    function bindPresetActions(root) {
      root.querySelector('#shipyard-preset-save')?.addEventListener('click', () => {
        const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
        const layoutCode = String(root.querySelector('#shipyard-blueprint-layout')?.value || 'default');
        if (!hullCode) { showToast('Kein Hull ausgew\u00e4hlt.', 'warning'); return; }
        const nameDefault = `${fmtName(hullCode)}-${fmtName(layoutCode)}`;
        const name = (windowRef.prompt('Preset-Name:', nameDefault) || '').trim();
        if (!name) return;
        const slotModules = [];
        root.querySelectorAll('.shipyard-module-slot').forEach((sel) => {
          if (sel.value) slotModules.push({ group: sel.dataset.groupCode, code: sel.value, quantity: 1 });
        });
        savePresetToStorage(name, hullCode, layoutCode, slotModules);
        refreshPresetToolbar(root);
        showToast(`Preset gespeichert: ${name}`, 'success');
      });

      root.querySelector('#shipyard-preset-load')?.addEventListener('click', () => {
        const sel = root.querySelector('#shipyard-preset-select');
        const name = String(sel?.value || '').trim();
        if (!name) { showToast('Kein Preset ausgew\u00e4hlt.', 'warning'); return; }
        const preset = loadPresetsFromStorage().find((p) => p.name === name);
        if (!preset) { showToast('Preset nicht gefunden.', 'error'); return; }
        applyPreset(root, preset, _pendingHulls);
        showToast(`Preset geladen: ${name}`, 'info');
      });

      root.querySelector('#shipyard-preset-delete')?.addEventListener('click', () => {
        const sel = root.querySelector('#shipyard-preset-select');
        const name = String(sel?.value || '').trim();
        if (!name) { showToast('Kein Preset ausgew\u00e4hlt.', 'warning'); return; }
        deletePresetFromStorage(name);
        refreshPresetToolbar(root);
        showToast(`Preset gel\u00f6scht: ${name}`, 'info');
      });
    }

    // ── Card builders ──────────────────────────────────────────────────────

    function buildCardsDom(ships) {
      const grid = new GQUI.Div().setClass('card-grid');
      ships.forEach((ship) => {
        const card = new GQUI.Div().setClass('item-card');

        const header = new GQUI.Div().setClass('item-card-header');
        header.add(new GQUI.Span().setClass('item-name').setTextContent(fmtName(ship.type)));
        header.add(new GQUI.Span().setClass('item-level').setTextContent(ship.count + ' owned'));
        card.add(header);

        const runningCount = Number(ship.running_count || 0);
        const queuedCount  = Number(ship.queued_count  || 0);
        if (runningCount > 0 || queuedCount > 0) {
          const qDiv = new GQUI.Div().setClass('small text-muted');
          qDiv.dom.style.marginBottom = '0.35rem';
          let qText = 'Queue: ';
          if (runningCount > 0) qText += `${fmt(runningCount)} running`;
          if (runningCount > 0 && queuedCount > 0) qText += ' \u00b7 ';
          if (queuedCount > 0) qText += `${fmt(queuedCount)} queued`;
          if (ship.active_eta) qText += ` \u00b7 ETA ${countdown(ship.active_eta)}`;
          qDiv.dom.textContent = qText;
          card.add(qDiv);
        }

        const costDiv = new GQUI.Div().setClass('item-cost');
        if (ship.cost.metal)     { const s = new GQUI.Span().setClass('cost-metal').setTextContent(`\u26fe ${fmt(ship.cost.metal)}`); costDiv.add(s); }
        if (ship.cost.crystal)   { const s = new GQUI.Span().setClass('cost-crystal').setTextContent(`\ud83d\udc8e ${fmt(ship.cost.crystal)}`); costDiv.add(s); }
        if (ship.cost.deuterium) { const s = new GQUI.Span().setClass('cost-deut').setTextContent(`\u26c1 ${fmt(ship.cost.deuterium)}`); costDiv.add(s); }
        card.add(costDiv);

        const statsDiv = new GQUI.Div();
        statsDiv.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted)';
        statsDiv.dom.textContent = `\ud83d\udce6 ${fmt(ship.cargo)}   \u26a1 ${fmt(ship.speed)}`;
        card.add(statsDiv);

        const buildRow = new GQUI.Div().setClass('ship-build-row');
        const qtyInput = documentRef.createElement('input');
        qtyInput.type = 'number';
        qtyInput.className = 'ship-qty';
        qtyInput.dataset.type = String(ship.type);
        qtyInput.min = '1';
        qtyInput.value = '1';
        buildRow.dom.appendChild(qtyInput);
        const buildBtn = new GQUI.Button('Build').setClass('btn btn-primary btn-sm build-btn');
        buildBtn.dom.dataset.type = String(ship.type);
        buildRow.add(buildBtn);
        card.add(buildRow);

        grid.add(card);
      });
      return grid.dom;
    }

    function buildBlueprintCardsDom(blueprints) {
      if (!Array.isArray(blueprints) || !blueprints.length) {
        const p = documentRef.createElement('p');
        p.className = 'text-muted small';
        p.textContent = 'No blueprints created yet.';
        return p;
      }
      const grid = new GQUI.Div().setClass('card-grid');
      blueprints.forEach((bp) => {
        const card = new GQUI.Div().setClass('item-card');
        card.dom.style.cssText = 'border-color:rgba(94,133,189,0.45);background:linear-gradient(180deg, rgba(13,20,33,0.96), rgba(10,16,27,0.92));';

        const header = new GQUI.Div().setClass('item-card-header');
        header.add(new GQUI.Span().setClass('item-name').setTextContent(String(bp.name || bp.type)));
        header.add(new GQUI.Span().setClass('item-level').setTextContent(`${fmt(bp.count || 0)} owned`));
        card.add(header);

        const runningCount = Number(bp.running_count || 0);
        const queuedCount  = Number(bp.queued_count  || 0);
        if (runningCount > 0 || queuedCount > 0) {
          const qDiv = new GQUI.Div().setClass('small text-muted');
          qDiv.dom.style.marginBottom = '0.35rem';
          let qText = 'Queue: ';
          if (runningCount > 0) qText += `${fmt(runningCount)} running`;
          if (runningCount > 0 && queuedCount > 0) qText += ' \u00b7 ';
          if (queuedCount > 0) qText += `${fmt(queuedCount)} queued`;
          if (bp.active_eta) qText += ` \u00b7 ETA ${countdown(bp.active_eta)}`;
          qDiv.dom.textContent = qText;
          card.add(qDiv);
        }

        const classDiv = new GQUI.Div().setClass('small text-muted');
        classDiv.dom.style.marginBottom = '0.35rem';
        classDiv.dom.textContent = `${fmtName(bp.ship_class || 'corvette')} \u00b7 ${fmtName(bp.slot_layout_code || 'default')}`;
        card.add(classDiv);

        const costDiv = new GQUI.Div().setClass('item-cost');
        if (bp.cost?.metal)     { const s = new GQUI.Span().setClass('cost-metal').setTextContent(`\u26fe ${fmt(bp.cost.metal)}`); costDiv.add(s); }
        if (bp.cost?.crystal)   { const s = new GQUI.Span().setClass('cost-crystal').setTextContent(`\ud83d\udc8e ${fmt(bp.cost.crystal)}`); costDiv.add(s); }
        if (bp.cost?.deuterium) { const s = new GQUI.Span().setClass('cost-deut').setTextContent(`\u26c1 ${fmt(bp.cost.deuterium)}`); costDiv.add(s); }
        card.add(costDiv);

        const stats1 = new GQUI.Div();
        stats1.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted)';
        stats1.dom.textContent = `ATK ${fmt(bp.stats?.attack || 0)} \u00b7 SHD ${fmt(bp.stats?.shield || 0)} \u00b7 HULL ${fmt(bp.stats?.hull || 0)}`;
        card.add(stats1);

        const stats2 = new GQUI.Div();
        stats2.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;';
        stats2.dom.textContent = `CARGO ${fmt(bp.stats?.cargo || 0)} \u00b7 SPD ${fmt(bp.stats?.speed || 0)}`;
        card.add(stats2);

        const slotWrap = new GQUI.Div();
        slotWrap.dom.style.cssText = 'margin-top:0.45rem; display:flex; flex-wrap:wrap; gap:0.3rem;';
        slotWrap.dom.appendChild(renderSlotProfile(bp.slot_profile || {}));
        card.add(slotWrap);

        const buildRow = new GQUI.Div().setClass('ship-build-row');
        buildRow.dom.style.marginTop = '0.65rem';
        const qtyInput = documentRef.createElement('input');
        qtyInput.type = 'number';
        qtyInput.className = 'ship-qty';
        qtyInput.dataset.blueprintId = String(Number(bp.id || 0));
        qtyInput.min = '1';
        qtyInput.value = '1';
        buildRow.dom.appendChild(qtyInput);
        const buildBtn = new GQUI.Button('Build').setClass('btn btn-primary btn-sm build-blueprint-btn');
        buildBtn.dom.dataset.blueprintId = String(Number(bp.id || 0));
        buildBtn.dom.dataset.blueprintType = String(bp.type || '');
        buildBtn.dom.dataset.blueprintName = String(bp.name || bp.type || 'Blueprint');
        buildRow.add(buildBtn);

        const deleteBtn = documentRef.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'blueprint-delete-btn';
        deleteBtn.dataset.blueprintId = String(Number(bp.id || 0));
        deleteBtn.dataset.blueprintName = String(bp.name || bp.type || 'Blueprint');
        deleteBtn.title = 'Blueprint löschen';
        deleteBtn.textContent = '🗑';
        buildRow.dom.appendChild(deleteBtn);

        card.add(buildRow);

        grid.add(card);
      });
      return grid.dom;
    }

    function buildHullCatalogDom(hulls) {
      if (!Array.isArray(hulls) || !hulls.length) {
        const p = documentRef.createElement('p');
        p.className = 'text-muted small';
        p.textContent = 'No hull catalog available.';
        return p;
      }
      const grid = new GQUI.Div().setClass('card-grid');
      hulls.forEach((hull) => {
        const layouts = Object.keys(hull.slot_variations || {});
        const card = new GQUI.Div().setClass('item-card');
        card.dom.style.cssText = 'border-color:rgba(137,117,70,0.45);';

        const header = new GQUI.Div().setClass('item-card-header');
        header.add(new GQUI.Span().setClass('item-name').setTextContent(String(hull.label || hull.code)));
        header.add(new GQUI.Span().setClass('item-level').setTextContent(fmtName(hull.ship_class || hull.role || 'hull')));
        card.add(header);

        if (hull.unlocked === false) {
          const lockDiv = new GQUI.Div().setClass('small text-red');
          lockDiv.dom.style.marginBottom = '0.35rem';
          lockDiv.dom.textContent = 'Locked: ' + (hull.blockers || []).join(' | ');
          card.add(lockDiv);
        } else {
          const unlockDiv = new GQUI.Div().setClass('small');
          unlockDiv.dom.style.cssText = 'margin-bottom:0.35rem;color:#7ed7a1;';
          unlockDiv.dom.textContent = 'Unlocked';
          card.add(unlockDiv);
        }

        const tierDiv = new GQUI.Div().setClass('small text-muted');
        tierDiv.dom.style.marginBottom = '0.35rem';
        tierDiv.dom.textContent = `Tier ${fmt(hull.tier || 1)} \u00b7 ${String(hull.code || '')}`;
        card.add(tierDiv);

        const stats1 = new GQUI.Div();
        stats1.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted)';
        stats1.dom.textContent = `ATK ${fmt(hull.base_stats?.attack || 0)} \u00b7 SHD ${fmt(hull.base_stats?.shield || 0)} \u00b7 HULL ${fmt(hull.base_stats?.hull || 0)}`;
        card.add(stats1);

        const stats2 = new GQUI.Div();
        stats2.dom.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;';
        stats2.dom.textContent = `CARGO ${fmt(hull.base_stats?.cargo || 0)} \u00b7 SPD ${fmt(hull.base_stats?.speed || 0)}`;
        card.add(stats2);

        const slotWrap = new GQUI.Div();
        slotWrap.dom.style.cssText = 'margin-top:0.45rem; display:flex; flex-wrap:wrap; gap:0.3rem;';
        slotWrap.dom.appendChild(renderSlotProfile(hull.slot_profile || {}));
        card.add(slotWrap);

        const layoutsDiv = new GQUI.Div().setClass('small text-muted');
        layoutsDiv.dom.style.marginTop = '0.45rem';
        layoutsDiv.dom.textContent = 'Layouts: ' + (layouts.length
          ? layouts.map((layout) => fmtName(layout)).join(' \u00b7 ')
          : 'default only');
        card.add(layoutsDiv);

        grid.add(card);
      });
      return grid.dom;
    }

    function buildBlueprintCreatorDom(hulls) {
      const card = new GQUI.Div().setClass('system-card');
      card.dom.style.marginBottom = '1rem';

      const titleRow = new GQUI.Div().setClass('system-row');
      const titleStrong = documentRef.createElement('strong');
      titleStrong.textContent = 'Blueprint Forge';
      titleRow.dom.appendChild(titleStrong);
      card.add(titleRow);

      const desc = new GQUI.Div().setClass('small text-muted');
      desc.dom.style.marginTop = '0.3rem';
      desc.dom.textContent = 'Wähle einen Rumpf, konfiguriere Module und speichere dein Design.';
      card.add(desc);

      const presetWrap = new GQUI.Div();
      presetWrap.dom.id = 'shipyard-preset-toolbar-wrap';
      presetWrap.dom.style.marginTop = '0.65rem';
      presetWrap.dom.appendChild(buildPresetToolbarDom());
      card.add(presetWrap);

      // Name + Layout row
      const topGrid = new GQUI.Div();
      topGrid.dom.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.6rem;margin-top:0.7rem;';

      const nameLbl = documentRef.createElement('label');
      nameLbl.className = 'small';
      nameLbl.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;';
      const nameSpan = documentRef.createElement('span');
      nameSpan.textContent = 'Name';
      const nameInput = documentRef.createElement('input');
      nameInput.id = 'shipyard-blueprint-name';
      nameInput.className = 'input';
      nameInput.placeholder = 'Aegis Frigate';
      nameLbl.appendChild(nameSpan);
      nameLbl.appendChild(nameInput);
      topGrid.dom.appendChild(nameLbl);

      const layoutLbl = documentRef.createElement('label');
      layoutLbl.className = 'small';
      layoutLbl.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;';
      const layoutSpan = documentRef.createElement('span');
      layoutSpan.textContent = 'Layout';
      const layoutSel = documentRef.createElement('select');
      layoutSel.id = 'shipyard-blueprint-layout';
      layoutSel.className = 'input';
      layoutLbl.appendChild(layoutSpan);
      layoutLbl.appendChild(layoutSel);
      topGrid.dom.appendChild(layoutLbl);

      card.add(topGrid);

      // Hidden hull-code input (set by hull picker)
      const hullHidden = documentRef.createElement('input');
      hullHidden.type = 'hidden';
      hullHidden.id = 'shipyard-blueprint-hull';
      card.dom.appendChild(hullHidden);

      // Hull picker
      const hullPickerLabel = new GQUI.Div().setClass('small text-muted');
      hullPickerLabel.dom.style.marginTop = '0.7rem';
      hullPickerLabel.dom.textContent = 'Rumpfklasse wählen';
      card.add(hullPickerLabel);
      card.dom.appendChild(buildHullPickerDom(hulls));

      // Doctrine selector
      const doctrineLbl = new GQUI.Div().setClass('small text-muted');
      doctrineLbl.dom.style.marginTop = '0.55rem';
      doctrineLbl.dom.textContent = 'Doktrin';
      card.add(doctrineLbl);
      card.dom.appendChild(buildDoctrineSelector('custom'));

      const layoutPreview = new GQUI.Div().setClass('small text-muted');
      layoutPreview.dom.id = 'shipyard-blueprint-layout-preview';
      layoutPreview.dom.style.marginTop = '0.55rem';
      card.add(layoutPreview);

      const modulesDiv = new GQUI.Div();
      modulesDiv.dom.id = 'shipyard-blueprint-modules';
      modulesDiv.dom.style.marginTop = '0.65rem';
      card.add(modulesDiv);

      const statsPreview = new GQUI.Div();
      statsPreview.dom.id = 'shipyard-blueprint-stats-preview';
      statsPreview.dom.style.marginTop = '0.55rem';
      card.add(statsPreview);

      const actionsDiv = new GQUI.Div();
      actionsDiv.dom.style.cssText = 'margin-top:0.7rem; display:flex; gap:0.5rem; flex-wrap:wrap;';
      const createBtn = new GQUI.Button('Blueprint erstellen').setClass('btn');
      createBtn.dom.id = 'shipyard-create-blueprint';
      actionsDiv.add(createBtn);
      card.add(actionsDiv);

      return card.dom;
    }

    function buildHullPickerDom(hulls) {
      const picker = documentRef.createElement('div');
      picker.id = 'shipyard-hull-picker';
      picker.className = 'shipyard-hull-picker';
      const hullList = Array.isArray(hulls) ? hulls : [];
      const firstUnlockedCode = (hullList.find((h) => h.unlocked !== false) || hullList[0])?.code || '';
      hullList.forEach((hull) => {
        const card = documentRef.createElement('div');
        card.className = 'shipyard-hull-card shipyard-hull-base' + (hull.unlocked === false ? ' is-locked' : '');
        card.dataset.hullCode = String(hull.code || '');
        card.dataset.attack = String(Number(hull.base_stats?.attack || 0));
        card.dataset.shield = String(Number(hull.base_stats?.shield || 0));
        card.dataset.hull   = String(Number(hull.base_stats?.hull   || 0));
        card.dataset.cargo  = String(Number(hull.base_stats?.cargo  || 0));
        card.dataset.speed  = String(Number(hull.base_stats?.speed  || 0));
        if (String(hull.code || '') === firstUnlockedCode) card.classList.add('is-selected');

        const nameLine = documentRef.createElement('div');
        nameLine.className = 'shipyard-hull-card-name';
        nameLine.textContent = String(hull.label || hull.code || 'Hull');
        card.appendChild(nameLine);

        const badges = documentRef.createElement('div');
        badges.className = 'shipyard-hull-card-badges';

        const tierBadge = documentRef.createElement('span');
        tierBadge.className = 'shipyard-hull-card-tier';
        tierBadge.textContent = `T${hull.tier ?? 1}`;
        badges.appendChild(tierBadge);

        const roleBadge = documentRef.createElement('span');
        roleBadge.className = 'shipyard-hull-card-role';
        roleBadge.textContent = fmtName(hull.ship_class || hull.role || 'hull');
        badges.appendChild(roleBadge);

        if (hull.unlocked === false) {
          const lockBadge = documentRef.createElement('span');
          lockBadge.className = 'shipyard-hull-card-lock-badge';
          lockBadge.textContent = '🔒';
          badges.appendChild(lockBadge);
        }
        card.appendChild(badges);

        const stats = documentRef.createElement('div');
        stats.className = 'shipyard-hull-card-stats';
        stats.textContent = `⚔ ${fmt(hull.base_stats?.attack || 0)}  🛡 ${fmt(hull.base_stats?.shield || 0)}  🏠 ${fmt(hull.base_stats?.hull || 0)}`;
        card.appendChild(stats);

        const slotWrap = documentRef.createElement('div');
        slotWrap.className = 'shipyard-hull-card-slots';
        slotWrap.appendChild(renderSlotProfile(hull.slot_profile || {}));
        card.appendChild(slotWrap);

        picker.appendChild(card);
      });
      return picker;
    }

    function buildDoctrineSelector(activeDoctrine) {
      const doctrines = [
        { code: 'custom',   icon: '✏',  label: 'Custom' },
        { code: 'assault',  icon: '⚔',  label: 'Angriff' },
        { code: 'patrol',   icon: '👁',  label: 'Patrouille' },
        { code: 'defense',  icon: '🛡',  label: 'Verteidigung' },
        { code: 'carrier',  icon: '🚀',  label: 'Träger' },
        { code: 'support',  icon: '🔧',  label: 'Support' },
      ];
      const row = documentRef.createElement('div');
      row.id = 'shipyard-doctrine-selector';
      row.className = 'shipyard-doctrine-row';
      doctrines.forEach(({ code, icon, label }) => {
        const btn = documentRef.createElement('button');
        btn.type = 'button';
        btn.className = 'shipyard-doctrine-btn' + (code === (activeDoctrine || 'custom') ? ' is-active' : '');
        btn.dataset.doctrine = code;
        btn.textContent = `${icon} ${label}`;
        btn.addEventListener('click', () => {
          row.querySelectorAll('.shipyard-doctrine-btn').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
        });
        row.appendChild(btn);
      });
      return row;
    }

    function buildQueueDom(queue) {
      if (!Array.isArray(queue) || !queue.length) {
        const p = documentRef.createElement('p');
        p.className = 'text-muted small';
        p.textContent = 'No ships in production.';
        return p;
      }
      const wrap = new GQUI.Div();
      wrap.dom.style.cssText = 'display:grid;gap:0.55rem;';
      queue.forEach((entry) => {
        const running = String(entry.status || '') === 'running';
        const label = String(entry.label || entry.ship_type || 'Ship');
        const statusLabel = running ? 'Running' : `Queued #${Number(entry.position || 1)}`;

        const card = new GQUI.Div().setClass('item-card');
        card.dom.style.cssText = 'padding:0.8rem 0.9rem;';

        const header = new GQUI.Div().setClass('item-card-header');
        const nameSpan = new GQUI.Span().setClass('item-name').setTextContent(label);
        const statusSpan = new GQUI.Span().setClass('item-level').setTextContent(statusLabel);
        header.add(nameSpan, statusSpan);
        card.add(header);

        const qtyDiv = new GQUI.Div().setClass('small text-muted');
        qtyDiv.dom.style.marginBottom = '0.35rem';
        qtyDiv.dom.textContent = `${fmt(Number(entry.quantity || 1))}x ${fmtName(entry.ship_type || label)}`;
        card.add(qtyDiv);

        if (running && entry.eta) {
          const timerDiv = new GQUI.Div().setClass('item-timer');
          timerDiv.dom.textContent = '\u23f3 ';
          const etaSpan = documentRef.createElement('span');
          etaSpan.dataset.end = String(entry.eta);
          etaSpan.textContent = countdown(entry.eta);
          timerDiv.dom.appendChild(etaSpan);
          card.add(timerDiv);

          let buildProgressPct = 0;
          let buildTone = 'is-good';
          if (entry.started_at && entry.eta) {
            const now = Date.now();
            const startMs = new Date(entry.started_at).getTime();
            const endMs = new Date(entry.eta).getTime();
            const totalMs = endMs - startMs;
            if (totalMs > 0) {
              buildProgressPct = Math.min(100, Math.round(Math.max(0, (now - startMs) / totalMs * 100)));
              buildTone = buildProgressPct < 30 ? 'is-critical' : (buildProgressPct < 70 ? 'is-warning' : 'is-good');
            }
          }

          const barsDiv = new GQUI.Div().setClass('entity-bars');
          barsDiv.dom.style.marginTop = '0.2rem';
          const barRow = new GQUI.Div().setClass('entity-bar-row');
          barRow.dom.title = `Build progress ${buildProgressPct}%`;
          const barLabel = new GQUI.Span().setClass('entity-bar-label').setTextContent('Build');
          const barWrap = new GQUI.Div().setClass('bar-wrap');
          const barFill = new GQUI.Div().setClass(`bar-fill bar-integrity ${buildTone}`);
          barFill.dom.style.width = `${buildProgressPct}%`;
          barWrap.add(barFill);
          const barValue = new GQUI.Span().setClass('entity-bar-value').setTextContent(`${buildProgressPct}%`);
          barRow.add(barLabel, barWrap, barValue);
          barsDiv.add(barRow);
          card.add(barsDiv);
        } else {
          const waitDiv = new GQUI.Div().setClass('small text-muted')
            .setTextContent('Waiting for free shipyard slot.');
          card.add(waitDiv);
        }
        wrap.add(card);
      });
      return wrap.dom;
    }

    async function updateBlueprintLayoutOptions(root, hulls) {
      const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
      const hull = (Array.isArray(hulls) ? hulls : []).find((entry) => String(entry.code || '') === hullCode);
      const layoutSelect = root.querySelector('#shipyard-blueprint-layout');
      const preview = root.querySelector('#shipyard-blueprint-layout-preview');
      const modulesRoot = root.querySelector('#shipyard-blueprint-modules');
      if (!layoutSelect || !hull) {
        if (layoutSelect) {
          const defOpt = documentRef.createElement('option');
          defOpt.value = 'default';
          defOpt.textContent = 'Default';
          layoutSelect.replaceChildren(defOpt);
        }
        if (preview) preview.replaceChildren();
        if (modulesRoot) modulesRoot.replaceChildren();
        return;
      }

      const layouts = ['default', ...Object.keys(hull.slot_variations || {})];
      const newOpts = layouts.map((layoutCode) => {
        const label = layoutCode === 'default'
          ? 'Default'
          : String(hull.slot_variations?.[layoutCode]?.label || fmtName(layoutCode));
        const opt = documentRef.createElement('option');
        opt.value = layoutCode;
        opt.textContent = label;
        return opt;
      });
      layoutSelect.replaceChildren(...newOpts);

      const selectedLayout = String(layoutSelect.value || 'default');
      const profile = computeSlotProfile(hull, selectedLayout);
      if (preview) {
        const previewFrag = documentRef.createDocumentFragment();
        const classSpan = documentRef.createTextNode(
          `Class: ${fmtName(hull.ship_class || hull.role || 'hull')} \u00b7 Slots: `
        );
        previewFrag.appendChild(classSpan);
        previewFrag.appendChild(renderSlotProfile(profile));
        if (Array.isArray(hull.blockers) && hull.blockers.length) {
          const lockDiv = new GQUI.Div().setClass('text-red');
          lockDiv.dom.style.marginTop = '0.3rem';
          lockDiv.dom.textContent = 'Locked: ' + hull.blockers.join(' | ');
          previewFrag.appendChild(lockDiv.dom);
        }
        preview.replaceChildren(previewFrag);
      }

      const currentColony = getCurrentColony();
      if (modulesRoot) {
        const loadingDiv = new GQUI.Div().setClass('text-muted small')
          .setTextContent('Loading module options...');
        modulesRoot.replaceChildren(loadingDiv.dom);
      }
      try {
        const catalog = await fetchModuleCatalog(currentColony.id, hull.code, selectedLayout);
        if (modulesRoot) {
          modulesRoot.replaceChildren();
          if (catalog?.hull_unlocked === false && Array.isArray(catalog?.hull_blockers) && catalog.hull_blockers.length) {
            const gateDiv = new GQUI.Div().setClass('text-red small');
            gateDiv.dom.style.marginBottom = '0.45rem';
            gateDiv.dom.textContent = 'Hull locked: ' + catalog.hull_blockers.join(' | ');
            modulesRoot.appendChild(gateDiv.dom);
          }
          modulesRoot.appendChild(renderModuleSlotEditor(catalog));
        }
      } catch (err) {
        if (modulesRoot) {
          const errDiv = new GQUI.Div().setClass('text-red small');
          errDiv.dom.textContent = String(err?.message || 'Failed to load module options.');
          modulesRoot.replaceChildren(errDiv.dom);
        }
      }
    }

    // ── Event bindings ─────────────────────────────────────────────────────

    function bindActions(root, hulls = []) {
      root.querySelectorAll('.build-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const type = btn.dataset.type;
          const qty = parseInt(root.querySelector(`.ship-qty[data-type="${type}"]`).value, 10) || 1;
          btn.disabled = true;
          const currentColony = getCurrentColony();
          const res = await api.buildShip(currentColony.id, type, qty);
          if (res.success) {
            const queuePosition = Number(res.queue_position || 1);
            showToast(`Queued ${qty}x ${fmtName(type)}${queuePosition > 1 ? ` (#${queuePosition})` : ''}`, 'success');
            const resources = await api.resources(currentColony.id);
            if (resources.success) Object.assign(currentColony, resources.resources);
            updateResourceBar();
            await render();
          } else {
            showToast(res.error || 'Build failed', 'error');
            btn.disabled = false;
          }
        });
      });

      root.querySelectorAll('.build-blueprint-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const blueprintId = Number(btn.dataset.blueprintId || 0);
          const type = String(btn.dataset.blueprintType || '');
          const name = String(btn.dataset.blueprintName || 'Blueprint');
          const qty = parseInt(root.querySelector(`.ship-qty[data-blueprint-id="${blueprintId}"]`)?.value || '1', 10) || 1;
          btn.disabled = true;
          const currentColony = getCurrentColony();
          const res = await api.buildShip(currentColony.id, type, qty, { blueprint_id: blueprintId });
          if (res.success) {
            const queuePosition = Number(res.queue_position || 1);
            showToast(`Queued ${qty}x ${name}${queuePosition > 1 ? ` (#${queuePosition})` : ''}`, 'success');
            const resources = await api.resources(currentColony.id);
            if (resources.success) Object.assign(currentColony, resources.resources);
            updateResourceBar();
            await render();
          } else {
            showToast(res.error || 'Build failed', 'error');
            btn.disabled = false;
          }
        });
      });

      root.querySelector('#shipyard-blueprint-hull')?.addEventListener('change', async () => {
        await updateBlueprintLayoutOptions(root, hulls);
      });
      root.querySelector('#shipyard-blueprint-layout')?.addEventListener('change', async () => {
        await updateBlueprintLayoutOptions(root, hulls);
      });

      // Hull picker card clicks
      root.querySelector('#shipyard-hull-picker')?.addEventListener('click', async (e) => {
        const card = e.target.closest('.shipyard-hull-card');
        if (!card || card.classList.contains('is-locked')) return;
        const hullCode = String(card.dataset.hullCode || '');
        if (!hullCode) return;
        root.querySelectorAll('.shipyard-hull-card').forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        const hullHidden = root.querySelector('#shipyard-blueprint-hull');
        if (hullHidden) hullHidden.value = hullCode;
        await updateBlueprintLayoutOptions(root, hulls);
        updateStatsPreview(root);
      });

      root.querySelector('#shipyard-create-blueprint')?.addEventListener('click', async () => {
        const hullCode = String(root.querySelector('#shipyard-blueprint-hull')?.value || '');
        const layoutCode = String(root.querySelector('#shipyard-blueprint-layout')?.value || 'default');
        const nameInput = root.querySelector('#shipyard-blueprint-name');
        const hull = hulls.find((entry) => String(entry.code || '') === hullCode);
        if (!hull) { showToast('Kein Rumpf ausgewählt.', 'warning'); return; }
        const modules = collectBlueprintModulesFromUI(root);
        if (!modules.length) { showToast('Wähle mindestens ein Modul aus.', 'warning'); return; }
        const currentColony = getCurrentColony();
        const defaultName = `${fmtName(hull.ship_class || hull.role || 'Hull')} ${fmtName(layoutCode === 'default' ? hull.code : layoutCode)}`;
        const activeDoctrineBtn = root.querySelector('#shipyard-doctrine-selector .shipyard-doctrine-btn.is-active');
        const doctrineTag = String(activeDoctrineBtn?.dataset.doctrine || layoutCode || 'custom');
        const payload = {
          colony_id: currentColony.id,
          name: String(nameInput?.value || '').trim() || defaultName,
          hull_code: hullCode,
          slot_layout_code: layoutCode,
          doctrine_tag: doctrineTag,
          modules,
        };
        const createBtn = root.querySelector('#shipyard-create-blueprint');
        if (createBtn) createBtn.disabled = true;
        try {
          const res = await api.createBlueprint(payload);
          if (!res.success) throw new Error(res.error || 'Blueprint creation failed');
          showToast(`Blueprint erstellt: ${payload.name}`, 'success');
          if (nameInput) nameInput.value = '';
          await render();
        } catch (err) {
          showToast(String(err?.message || 'Blueprint-Erstellung fehlgeschlagen'), 'error');
          if (createBtn) createBtn.disabled = false;
        }
      });

      updateBlueprintLayoutOptions(root, hulls).catch((err) => {
        gameLog('info', 'Blueprint Layout-Optionen Update fehlgeschlagen', err);
      });

      const modsContainer = root.querySelector('#shipyard-blueprint-modules');
      if (modsContainer) {
        modsContainer.addEventListener('change', (e) => {
          if (e.target.classList.contains('shipyard-module-slot')) updateStatsPreview(root);
        });
        modsContainer.addEventListener('click', (e) => {
          const upBtn = e.target.closest('.shipyard-slot-up');
          const downBtn = e.target.closest('.shipyard-slot-down');
          const btn = upBtn || downBtn;
          if (!btn || btn.disabled) return;
          const groupCode = String(btn.dataset.groupCode || '');
          const idx = Number(btn.dataset.slotIndex || 0);
          if (upBtn) swapSlots(root, groupCode, idx, idx - 1);
          else swapSlots(root, groupCode, idx, idx + 1);
        });
      }

      bindPresetActions(root);

      root.addEventListener('click', async (e) => {
        const decommBtn = e.target.closest('.vessel-decommission-btn');
        if (decommBtn) {
          const vid = Number(decommBtn.dataset.vesselId);
          if (vid > 0) decommissionVessel(vid, root);
          return;
        }

        const deleteBtn = e.target.closest('.blueprint-delete-btn');
        if (deleteBtn) {
          const blueprintId = Number(deleteBtn.dataset.blueprintId || 0);
          const blueprintName = String(deleteBtn.dataset.blueprintName || 'Blueprint');
          if (blueprintId <= 0) return;
          if (!windowRef.confirm(`Blueprint "${blueprintName}" dauerhaft löschen?`)) return;
          deleteBtn.disabled = true;
          try {
            const res = await api.deleteBlueprint(blueprintId);
            if (!res.success) throw new Error(res.error || 'Löschen fehlgeschlagen');
            showToast(`Blueprint gelöscht: ${blueprintName}`, 'info');
            await render();
          } catch (err) {
            showToast(String(err?.message || 'Blueprint-Löschen fehlgeschlagen'), 'error');
            deleteBtn.disabled = false;
          }
        }
      });
    }

    // ── Vessels ────────────────────────────────────────────────────────────

    function renderDockedVesselsDom(vessels) {
      if (!vessels.length) return null;
      const list = new GQUI.Div().setClass('vessel-list');
      vessels.forEach((v) => {
        const hp    = v.hp_state?.hp    ?? v.stats?.hull ?? '?';
        const maxHp = v.hp_state?.max_hp ?? v.stats?.hull ?? '?';
        const hpPct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 100;
        const shieldCurrent = Number(v.hp_state?.shield ?? v.stats?.shield ?? 0);
        const shieldMax = Number(v.hp_state?.max_shield ?? v.stats?.shield ?? 0);
        const shieldPct = shieldMax > 0 ? Math.max(0, Math.min(100, Math.round((shieldCurrent / shieldMax) * 100))) : 0;
        const hpTone = hpPct < 30 ? 'is-critical' : (hpPct < 60 ? 'is-warning' : 'is-good');
        const shieldTone = shieldPct < 30 ? 'is-critical' : (shieldPct < 60 ? 'is-warning' : 'is-good');

        const card = new GQUI.Div().setClass('vessel-card');
        card.dom.dataset.vesselId = String(v.id);

        const header = new GQUI.Div().setClass('vessel-card-header');
        header.add(new GQUI.Span().setClass('vessel-card-name').setTextContent(String(v.bp_name || v.name || `Vessel #${v.id}`)));
        header.add(new GQUI.Span().setClass('vessel-card-class badge').setTextContent(`${fmtName(v.hull_class || 'unknown')} T${v.hull_tier ?? '?'}`));
        const statusSpan = new GQUI.Span().setClass('vessel-card-status vessel-status-' + String(v.status)).setTextContent(String(v.status));
        header.add(statusSpan);
        card.add(header);

        const hullLbl = new GQUI.Div().setClass('vessel-card-hull').setTextContent(String(v.hull_label || ''));
        card.add(hullLbl);

        const hpBarWrap = new GQUI.Div().setClass('vessel-hp-bar');
        const hpFill = new GQUI.Div().setClass('vessel-hp-fill ' + hpTone);
        hpFill.dom.style.width = hpPct + '%';
        hpFill.dom.title = `Hull ${hpPct}%`;
        hpBarWrap.add(hpFill);
        card.add(hpBarWrap);

        const shieldBarWrap = new GQUI.Div().setClass('vessel-shield-bar');
        const shieldFill = new GQUI.Div().setClass('vessel-shield-fill ' + shieldTone);
        shieldFill.dom.style.width = shieldPct + '%';
        shieldFill.dom.title = `Shield ${shieldPct}%`;
        shieldBarWrap.add(shieldFill);
        card.add(shieldBarWrap);

        const chipsDiv = new GQUI.Div().setClass('vessel-stat-chips');
        ['attack', 'shield', 'hull', 'cargo', 'speed'].filter((k) => v.stats?.[k] > 0).forEach((k) => {
          const chip = new GQUI.Span().setClass('vessel-stat-chip chiptype-' + k.slice(0, 3));
          chip.dom.textContent = fmtName(k) + ' ' + fmt(v.stats[k]);
          chipsDiv.add(chip);
        });
        card.add(chipsDiv);

        const actionsDiv = new GQUI.Div().setClass('vessel-card-actions');
        const decommBtn = new GQUI.Button('Decommission').setClass('btn btn-sm btn-danger vessel-decommission-btn');
        decommBtn.dom.type = 'button';
        decommBtn.dom.dataset.vesselId = String(v.id);
        decommBtn.dom.title = 'Permanently decommission this vessel';
        actionsDiv.add(decommBtn);
        card.add(actionsDiv);

        list.add(card);
      });
      return list.dom;
    }

    async function decommissionVessel(vesselId, root) {
      if (!windowRef.confirm('Permanently decommission this vessel? This cannot be undone.')) return;
      try {
        const res = await api.decommissionVessel(vesselId);
        if (res.success) {
          const card = root?.querySelector(`.vessel-card[data-vessel-id="${vesselId}"]`);
          card?.remove();
          const listEl = root?.querySelector('.vessel-list');
          if (listEl && !listEl.querySelector('.vessel-card')) {
            root?.querySelector('#shipyard-docked-vessels-card')?.remove();
          }
        } else {
          windowRef.alert(res.error || 'Decommission failed.');
        }
      } catch (err) {
        gameLog('warn', 'Blueprint decommission fehlgeschlagen', err);
        windowRef.alert('Network error.');
      }
    }

    // ── Tab layout builder ─────────────────────────────────────────────────

    function buildShipyardTabs(data, hulls, vessels) {
      const tabDefs = [
        { id: 'design',     label: '🔧 Design',     title: 'Blueprint Forge' },
        { id: 'blueprints', label: '📋 Blueprints',  title: 'Meine Designs' },
        { id: 'flotte',     label: '🚀 Flotte',      title: 'Angedockte Schiffe' },
        { id: 'queue',      label: '⏳ Bauschacht',  title: 'Produktionswarteschlange' },
        { id: 'hulls',      label: '📚 Rümpfe',      title: 'Rumpfkatalog' },
        { id: 'legacy',     label: '⚙ Klassisch',   title: 'Klassische Schiffe' },
      ];

      const root = new GQUI.Div().setClass('shipyard-tabs-root');

      // Tab bar
      const tabList = new GQUI.Div().setClass('ui-tab-list');
      tabList.dom.style.marginBottom = '0.6rem';
      tabDefs.forEach(({ id, label }, idx) => {
        const btn = documentRef.createElement('button');
        btn.type = 'button';
        btn.className = 'ui-tab-btn' + (idx === 0 ? ' is-active' : '');
        btn.dataset.tabTarget = id;
        btn.textContent = label;
        tabList.dom.appendChild(btn);
      });
      root.add(tabList);

      // Tab panels
      const panels = new Map();

      function makePanel(id, contentDom) {
        const panel = documentRef.createElement('div');
        panel.className = 'ui-tab-panel' + (id === 'design' ? ' is-active' : '');
        panel.dataset.tabId = id;
        panel.appendChild(contentDom);
        root.dom.appendChild(panel);
        panels.set(id, panel);
      }

      // Design tab
      makePanel('design', buildBlueprintCreatorDom(hulls));

      // Blueprints tab
      const bpWrap = documentRef.createElement('div');
      bpWrap.appendChild(buildBlueprintCardsDom(data.blueprints || []));
      makePanel('blueprints', bpWrap);

      // Flotte tab
      const flotteWrap = documentRef.createElement('div');
      if (vessels.length) {
        const vesselsDom = renderDockedVesselsDom(vessels);
        if (vesselsDom) {
          const badge = documentRef.createElement('span');
          badge.className = 'badge';
          badge.style.marginLeft = '0.5rem';
          badge.textContent = String(vessels.length);
          const hdr = documentRef.createElement('div');
          hdr.className = 'system-row';
          hdr.style.marginBottom = '0.55rem';
          const strong = documentRef.createElement('strong');
          strong.textContent = 'Angedockte Schiffe';
          hdr.appendChild(strong);
          hdr.appendChild(badge);
          flotteWrap.appendChild(hdr);
          flotteWrap.id = 'shipyard-docked-vessels-card';
          flotteWrap.appendChild(vesselsDom);
        }
      } else {
        const empty = documentRef.createElement('p');
        empty.className = 'text-muted small';
        empty.textContent = 'Keine Schiffe angedockt.';
        flotteWrap.appendChild(empty);
      }
      makePanel('flotte', flotteWrap);

      // Queue tab
      const queueWrap = documentRef.createElement('div');
      const queueBadge = (data.queue || []).length;
      if (queueBadge) {
        const tabBtn = tabList.dom.querySelector('[data-tab-target="queue"]');
        if (tabBtn) tabBtn.textContent = `⏳ Bauschacht (${queueBadge})`;
      }
      queueWrap.appendChild(buildQueueDom(data.queue || []));
      makePanel('queue', queueWrap);

      // Hulls tab
      const hullsWrap = documentRef.createElement('div');
      hullsWrap.appendChild(buildHullCatalogDom(hulls));
      makePanel('hulls', hullsWrap);

      // Legacy tab
      const legacyWrap = documentRef.createElement('div');
      const legacyDesc = documentRef.createElement('p');
      legacyDesc.className = 'text-muted small';
      legacyDesc.style.marginBottom = '0.5rem';
      legacyDesc.textContent = 'Klassische SHIP_STATS-Schiffe (Migration noch im Gange).';
      legacyWrap.appendChild(legacyDesc);
      legacyWrap.appendChild(buildCardsDom(data.ships || []));
      makePanel('legacy', legacyWrap);

      // Tab switching logic
      tabList.dom.addEventListener('click', (e) => {
        const btn = e.target.closest('.ui-tab-btn');
        if (!btn) return;
        const targetId = String(btn.dataset.tabTarget || '');
        tabList.dom.querySelectorAll('.ui-tab-btn').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        panels.forEach((panel, id) => {
          panel.classList.toggle('is-active', id === targetId);
        });
      });

      return root.dom;
    }

    // ── Main render ────────────────────────────────────────────────────────

    async function render() {
      const root = wm.body('shipyard');
      if (!root) return;
      const currentColony = getCurrentColony();
      if (!currentColony) {
        gqStatusMsg(root, 'Kolonie auswählen.', 'muted');
        return;
      }
      gqStatusMsg(root, 'Laden\u2026', 'muted');

      try {
        const [data, hullData, vesselData] = await Promise.all([
          api.ships(currentColony.id),
          api.shipyardHulls(currentColony.id),
          api.shipyardVessels(currentColony.id).catch(() => ({ vessels: [] })),
        ]);
        if (!data.success) {
          gqStatusMsg(root, 'Fehler beim Laden.', 'red');
          return;
        }
        const hulls   = Array.isArray(hullData?.hulls)    ? hullData.hulls    : [];
        const vessels = Array.isArray(vesselData?.vessels) ? vesselData.vessels : [];
        _pendingHulls = hulls;

        const tabsDom = buildShipyardTabs(data, hulls, vessels);

        root.replaceChildren(tabsDom);

        // Set hidden hull input to first unlocked hull
        const firstUnlocked = hulls.find((h) => h.unlocked !== false);
        if (firstUnlocked) {
          const hullHidden = root.querySelector('#shipyard-blueprint-hull');
          if (hullHidden) hullHidden.value = String(firstUnlocked.code || '');
        }

        bindActions(root, hulls);
      } catch (err) {
        gameLog('warn', 'Shipyard view laden fehlgeschlagen (renderer v1)', err);
        gqStatusMsg(root, 'Shipyard konnte nicht geladen werden.', 'red');
      }
    }

    return { render };
  }

  const api = { createShipyardController };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.GQRuntimeShipyardController = api; }
})();
