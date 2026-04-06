/**
 * ShipyardBlueprintForge.js — Interactive blueprint creation & editing UI
 *
 * Integrates IsometricModuleRenderer with shipyard API to provide:
 *  • Real-time module selection with visual preview
 *  • Slot editor with drag-and-drop support
 *  • Live stats calculation (cost, performance, efficiency)
 *  • Module comparison dialogs
 *  • Loadout presets & favorites
 *  • Faction affinity tracking
 *
 * Architecture:
 *   InventoryLoader → loads hulls/modules from API
 *   SlotManager → manages active slot configuration
 *   StatsCalculator → computes blueprint performance
 *   VisualizerPool → manages IsometricModuleRenderer instances
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ShipyardBlueprintForge {
  /**
   * @param {object} opts
   * @param {HTMLElement} [opts.container] — root UI container
   * @param {number} [opts.colonyId] — colony being configured
   * @param {string} [opts.apiBase] — API endpoint base (default: /api)
   * @param {function} [opts.onBlueprintSave] — callback when blueprint saved
   */
  constructor(opts = {}) {
    this.container = opts.container || document.body;
    this.colonyId = opts.colonyId || 0;
    this.apiBase = opts.apiBase || '/api';
    this.onBlueprintSave = opts.onBlueprintSave || null;

    // State
    this.currentHull = null;
    this.currentSlots = new Map(); // slotId → module
    this.currentStats = {};
    this.availableHulls = [];
    this.availableModules = {};
    this.factionAffinities = {};

    // UI components
    this._visualizers = new Map();
    this._statsCache = new Map();
    this._presets = this._loadPresetsFromStorage() || {};
    this._selectedPresetName = '';
    this._blueprintDraftName = '';
    this._resizeBound = false;

    // Loading state
    this.isLoading = false;
    this.lastError = null;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Initialize UI and load data from server.
   */
  async init() {
    this.isLoading = true;
    try {
      await this._loadInventory();
      this._renderUI();
      this.isLoading = false;
      return true;
    } catch (err) {
      this.lastError = err.message;
      console.error('[ShipyardBlueprintForge] Init failed:', err);
      this.isLoading = false;
      return false;
    }
  }

  /**
   * Load existing blueprint by ID.
   */
  async loadBlueprint(blueprintId) {
    try {
      const resp = await fetch(
        `${this.apiBase}/shipyard.php?action=list_blueprints&colony_id=${this.colonyId}`
      );
      if (!resp.ok) throw new Error('Failed to load blueprints');

      const data = await resp.json();
      const blueprint = (data.blueprints || []).find(b => b.id === blueprintId);
      if (!blueprint) throw new Error('Blueprint not found');

      // Set hull and slots
      this.currentHull = this.availableHulls.find(h => h.code === blueprint.hull_code);
      if (!this.currentHull) throw new Error('Hull not found');

      this.currentSlots.clear();
      if (blueprint.modules && Array.isArray(blueprint.modules)) {
        blueprint.modules.forEach(mod => {
          this.currentSlots.set(mod.slot_id, mod);
        });
      }

      this._updateStatsPreview();
      this._renderSlots();
      return true;
    } catch (err) {
      console.error('[ShipyardBlueprintForge] Load blueprint failed:', err);
      return false;
    }
  }

  /**
   * Save current configuration as blueprint.
   */
  async saveBlueprint(name) {
    if (!this.currentHull || !name) return false;

    try {
      const modules = Array.from(this.currentSlots.entries())
        .filter(([_, mod]) => mod !== null)
        .map(([slotId, mod]) => ({
          slot_id: slotId,
          module_id: mod.id,
          module_code: mod.code,
        }));

      const resp = await fetch(`${this.apiBase}/shipyard.php?action=create_blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colony_id: this.colonyId,
          name,
          hull_code: this.currentHull.code,
          slot_layout_code: 'default',
          modules,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to save blueprint');
      }

      const result = await resp.json();
      if (this.onBlueprintSave) {
        this.onBlueprintSave(result);
      }
      return result;
    } catch (err) {
      console.error('[ShipyardBlueprintForge] Save failed:', err);
      this.lastError = err.message;
      return false;
    }
  }

  /**
   * Build ship from current blueprint.
   */
  async buildShip() {
    if (!this.currentHull || this.currentSlots.size === 0) {
      this.lastError = 'Invalid blueprint configuration';
      return false;
    }

    try {
      const modules = this._getFilledModules().map(([slotId, mod]) => ({
        slot_id: slotId,
        module_id: mod.id,
      }));

      if (modules.length === 0) {
        this.lastError = 'Invalid blueprint configuration';
        return false;
      }

      const resp = await fetch(`${this.apiBase}/shipyard.php?action=build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colony_id: this.colonyId,
          hull_code: this.currentHull.code,
          modules,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Build failed');
      }

      return await resp.json();
    } catch (err) {
      console.error('[ShipyardBlueprintForge] Build failed:', err);
      this.lastError = err.message;
      return false;
    }
  }

  /**
   * Get current configuration as JSON.
   */
  export() {
    return {
      hull: this.currentHull,
      slots: Object.fromEntries(this.currentSlots),
      stats: this.currentStats,
      timestamp: Date.now(),
    };
  }

  /**
   * Set configuration from JSON (used for presets).
   */
  import(config) {
    if (!config.hull) return false;
    this.currentHull = config.hull;
    this.currentSlots.clear();
    Object.entries(config.slots || {}).forEach(([slotId, mod]) => {
      this.currentSlots.set(slotId, mod);
    });
    this._updateStatsPreview();
    this._renderSlots();
    return true;
  }

  saveCurrentAsPreset(name) {
    if (!name || !this.currentHull) return false;

    this._presets[name] = {
      hullCode: this.currentHull.code,
      slots: this._getFilledModules().map(([slotId, mod]) => ({
        slotId,
        moduleId: mod.id,
      })),
      savedAt: Date.now(),
    };

    this._savePresetsToStorage();
    return true;
  }

  applyPreset(name) {
    const preset = this._presets[name];
    if (!preset) return false;

    const hull = this.availableHulls.find((h) => h.code === preset.hullCode);
    if (!hull) return false;

    this.currentHull = hull;
    this._initializeSlots();

    (preset.slots || []).forEach((entry) => {
      const mod = this._findModuleById(entry.moduleId);
      if (mod && this.currentSlots.has(entry.slotId)) {
        this.currentSlots.set(entry.slotId, mod);
      }
    });

    this._updateStatsPreview();
    this._renderUI();
    return true;
  }

  deletePreset(name) {
    if (!this._presets[name]) return false;
    delete this._presets[name];
    this._savePresetsToStorage();
    return true;
  }

  listPresetNames() {
    return Object.keys(this._presets).sort((a, b) => a.localeCompare(b));
  }

  // =========================================================================
  // Private: Data Loading
  // =========================================================================

  async _loadInventory() {
    // Load hulls
    const hullResp = await fetch(
      `${this.apiBase}/shipyard.php?action=list_hulls&colony_id=${this.colonyId}`
    );
    if (!hullResp.ok) throw new Error('Failed to load hulls');
    const hullData = await hullResp.json();
    this.availableHulls = hullData.hulls || [];

    // Load modules
    const modResp = await fetch(
      `${this.apiBase}/shipyard.php?action=list_modules&colony_id=${this.colonyId}&hull_code=${this.availableHulls[0]?.code || ''}`
    );
    if (!modResp.ok) throw new Error('Failed to load modules');
    const modData = await modResp.json();
    this.availableModules = modData.modules_by_group || {};

    // Load faction affinities
    this.factionAffinities = hullData.faction_affinities || {};

    // Set default hull
    if (this.availableHulls.length > 0) {
      this.currentHull = this.availableHulls[0];
      this._initializeSlots();
    }
  }

  _initializeSlots() {
    if (!this.currentHull) return;

    const profile = JSON.parse(this.currentHull.slot_profile_json || '{}');
    this.currentSlots.clear();

    Object.entries(profile).forEach(([group, count]) => {
      for (let i = 0; i < count; i++) {
        const slotId = `${group}_${i}`;
        this.currentSlots.set(slotId, null);
      }
    });

    this._updateStatsPreview();
  }

  _loadPresetsFromStorage() {
    try {
      const saved = localStorage.getItem('gq-shipyard-presets');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }

  _savePresetsToStorage() {
    try {
      localStorage.setItem('gq-shipyard-presets', JSON.stringify(this._presets));
    } catch {
      // Fail silently
    }
  }

  _findModuleById(moduleId) {
    for (const groupModules of Object.values(this.availableModules || {})) {
      const found = (groupModules || []).find((mod) => mod.id === moduleId);
      if (found) return found;
    }
    return null;
  }

  _getFilledModules() {
    return Array.from(this.currentSlots.entries()).filter(([_, mod]) => {
      return mod !== null && mod !== undefined && mod.id !== undefined;
    });
  }

  // =========================================================================
  // Private: Stats Calculation
  // =========================================================================

  _updateStatsPreview() {
    if (!this.currentHull) {
      this.currentStats = {};
      this._fireStatsChangeEvent();
      return;
    }

    // Base stats from hull
    let stats = {
      cost: parseInt(this.currentHull.base_cost || 0),
      cargo: parseInt(this.currentHull.base_cargo || 0),
      speed: parseFloat(this.currentHull.base_speed || 0),
      attack: parseInt(this.currentHull.base_attack || 0),
      shield: parseInt(this.currentHull.base_shield || 0),
      hull: parseInt(this.currentHull.base_hull || 0),
      mass: parseFloat(this.currentHull.base_mass || 1),
      energyOutput: parseInt(this.currentHull.base_energy_output || 100),
      energyCapacity: parseInt(this.currentHull.base_energy_capacity || 100),
      energyUpkeep: parseInt(this.currentHull.base_energy_upkeep || 10),
    };

    // Aggregate from modules
    let totalModuleCost = 0;
    let energyUsed = 0;
    let moduleMass = 0;

    this.currentSlots.forEach((mod) => {
      if (!mod) return;

      stats.attack += parseInt(mod.bonus_attack || 0);
      stats.shield += parseInt(mod.bonus_shield || 0);
      stats.speed += parseFloat(mod.bonus_speed || 0);
      stats.cargo += parseInt(mod.bonus_cargo || 0);
      totalModuleCost += parseInt(mod.cost || 0);
      energyUsed += parseInt(mod.energy_upkeep || 0);
      moduleMass += parseFloat(mod.mass || 0);
    });

    stats.cost += totalModuleCost;
    stats.mass += moduleMass;
    stats.energyUpkeep += energyUsed;

    // Derived calculations
    stats.energyEfficiency = stats.energyOutput > 0 
      ? ((stats.energyOutput - stats.energyUpkeep) / stats.energyOutput * 100).toFixed(1)
      : 0;
    stats.massRatio = stats.mass > 0
      ? (stats.attack / stats.mass).toFixed(2)
      : 0;

    this.currentStats = stats;
    this._fireStatsChangeEvent();
  }

  _fireStatsChangeEvent() {
    const ev = new CustomEvent('gq:blueprint-stats-changed', {
      detail: this.currentStats,
    });
    window.dispatchEvent(ev);
  }

  // =========================================================================
  // Private: UI Rendering
  // =========================================================================

  _renderUI() {
    this.container.innerHTML = '';

    // Header
    this._renderHeader();

    // Main grid: hull selector + slot editor
    const mainGrid = document.createElement('div');
    mainGrid.style.display = 'grid';
    mainGrid.style.gridTemplateColumns = '1fr 2fr';
    mainGrid.style.gap = '20px';
    mainGrid.style.marginTop = '20px';

    const leftPanel = document.createElement('div');
    this._renderHullSelector(leftPanel);
    mainGrid.appendChild(leftPanel);

    const rightPanel = document.createElement('div');
    this._renderSlots();
    rightPanel.id = 'slot-editor-container';
    mainGrid.appendChild(rightPanel);

    this.container.appendChild(mainGrid);

    // Stats preview
    this._renderStatsPreview();

    // Actions
    this._renderActions();
  }

  _renderHeader() {
    const header = document.createElement('div');
    header.style.marginBottom = '20px';

    const title = document.createElement('h2');
    title.style.margin = '0 0 8px';
    title.style.fontSize = '20px';
    title.style.color = '#e9f0ff';
    title.textContent = 'Blueprint Forge';
    header.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.style.margin = '0';
    subtitle.style.color = '#7a8ca0';
    subtitle.style.fontSize = '12px';
    subtitle.textContent = 'Design your vessel configuration by selecting a hull and equipping modules.';
    header.appendChild(subtitle);

    this.container.appendChild(header);
  }

  _renderHullSelector(container) {
    const panel = document.createElement('div');
    panel.style.padding = '16px';
    panel.style.border = '1px solid rgba(100, 150, 200, 0.2)';
    panel.style.borderRadius = '8px';
    panel.style.background = 'rgba(13, 20, 33, 0.4)';

    const label = document.createElement('h3');
    label.style.margin = '0 0 12px';
    label.style.fontSize = '14px';
    label.style.color = '#a8c5dd';
    label.textContent = 'Select Hull';
    panel.appendChild(label);

    this.availableHulls.forEach((hull) => {
      const item = document.createElement('div');
      item.style.padding = '10px';
      item.style.marginBottom = '8px';
      item.style.border = '1px solid rgba(100, 150, 200, 0.25)';
      item.style.borderRadius = '6px';
      item.style.background = this.currentHull?.id === hull.id 
        ? 'rgba(100, 180, 255, 0.2)' 
        : 'rgba(10, 16, 28, 0.5)';
      item.style.cursor = 'pointer';
      item.style.transition = 'all 150ms';

      const hullName = document.createElement('div');
      hullName.style.fontWeight = '600';
      hullName.style.color = '#d6ecff';
      hullName.textContent = hull.label || hull.code;
      item.appendChild(hullName);

      const hullClass = document.createElement('div');
      hullClass.style.fontSize = '11px';
      hullClass.style.color = '#7a8ca0';
      hullClass.textContent = `Class: ${hull.ship_class || 'unknown'} | Cost: ${hull.base_cost || 0}`;
      item.appendChild(hullClass);

      item.addEventListener('click', () => {
        this.currentHull = hull;
        this._initializeSlots();
        this._renderUI();
      });

      item.addEventListener('mouseenter', () => {
        if (this.currentHull?.id !== hull.id) {
          item.style.borderColor = 'rgba(100, 200, 255, 0.5)';
          item.style.background = 'rgba(30, 50, 80, 0.5)';
        }
      });

      item.addEventListener('mouseleave', () => {
        if (this.currentHull?.id !== hull.id) {
          item.style.borderColor = 'rgba(100, 150, 200, 0.25)';
          item.style.background = 'rgba(10, 16, 28, 0.5)';
        }
      });

      panel.appendChild(item);
    });

    container.appendChild(panel);
  }

  _renderSlots() {
    const container = document.getElementById('slot-editor-container') 
      || (this.container.querySelector('[data-role="slot-editor"]') ||
          document.createElement('div'));

    container.innerHTML = '';
    container.id = 'slot-editor-container';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '16px';

    if (!this.currentHull) return;

    // Group slots by type
    const slotsByGroup = new Map();
    this.currentSlots.forEach((mod, slotId) => {
      const group = slotId.split('_')[0];
      if (!slotsByGroup.has(group)) {
        slotsByGroup.set(group, []);
      }
      slotsByGroup.get(group).push({ slotId, mod });
    });

    // Render each group
    slotsByGroup.forEach((slots, group) => {
      const groupPanel = document.createElement('div');
      groupPanel.style.padding = '12px';
      groupPanel.style.border = '1px solid rgba(100, 150, 200, 0.2)';
      groupPanel.style.borderRadius = '8px';
      groupPanel.style.background = 'rgba(13, 20, 33, 0.3)';

      const groupLabel = document.createElement('div');
      groupLabel.style.fontWeight = '600';
      groupLabel.style.fontSize = '12px';
      groupLabel.style.color = '#a8c5dd';
      groupLabel.style.marginBottom = '10px';
      groupLabel.style.textTransform = 'uppercase';
      groupLabel.style.letterSpacing = '0.05em';
      groupLabel.textContent = group;
      groupPanel.appendChild(groupLabel);

      const slotsGrid = document.createElement('div');
      slotsGrid.style.display = 'grid';
      slotsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))';
      slotsGrid.style.gap = '10px';

      slots.forEach(({ slotId, mod }) => {
        const slotCard = this._createSlotCard(slotId, mod);
        slotsGrid.appendChild(slotCard);
      });

      groupPanel.appendChild(slotsGrid);
      container.appendChild(groupPanel);
    });

    this.container.appendChild(container);
  }

  _createSlotCard(slotId, currentMod) {
    const card = document.createElement('div');
    card.dataset.slotId = slotId;
    card.style.padding = '10px';
    card.style.border = '1px solid rgba(100, 150, 200, 0.2)';
    card.style.borderRadius = '6px';
    card.style.background = 'rgba(10, 16, 28, 0.5)';
    card.style.cursor = 'pointer';
    card.style.transition = 'all 150ms';
    card.style.minHeight = '120px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'center';
    card.style.justifyContent = 'center';

    if (currentMod) {
      // Show current module
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 80;

      const { IsometricModuleRenderer, ModuleType } = window.GQIsometricModuleRenderer || {};
      if (IsometricModuleRenderer) {
        const renderer = new IsometricModuleRenderer(canvas, { scale: 1.2 });
        const typeMap = {
          laser: ModuleType.WEAPON,
          beam: ModuleType.WEAPON,
          missile: ModuleType.WEAPON,
          reactor: ModuleType.ENERGY,
          battery: ModuleType.ENERGY,
          shield: ModuleType.SHIELD,
          armor: ModuleType.ARMOR,
          thruster: ModuleType.PROPULSION,
        };
        const moduleType = typeMap[currentMod.module_type?.toLowerCase()] || ModuleType.AUXILIARY;
        renderer.render({
          moduleType,
          tier: currentMod.tier || 1,
        });
        this._visualizers.set(canvas, renderer);
        card.appendChild(canvas);
      }

      const modName = document.createElement('div');
      modName.style.fontSize = '11px';
      modName.style.fontWeight = '600';
      modName.style.color = '#d6ecff';
      modName.style.marginTop = '6px';
      modName.style.textAlign = 'center';
      modName.textContent = currentMod.label || currentMod.code || slotId;
      card.appendChild(modName);

      const statLine = document.createElement('div');
      statLine.style.fontSize = '10px';
      statLine.style.color = '#7a8ca0';
      statLine.style.marginTop = '3px';
      statLine.textContent = `ATK +${currentMod.bonus_attack || 0} | SHD +${currentMod.bonus_shield || 0}`;
      card.appendChild(statLine);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.style.marginTop = '6px';
      removeBtn.style.padding = '4px 8px';
      removeBtn.style.fontSize = '10px';
      removeBtn.style.border = '1px solid rgba(220, 70, 70, 0.3)';
      removeBtn.style.borderRadius = '4px';
      removeBtn.style.background = 'rgba(50, 20, 20, 0.4)';
      removeBtn.style.color = '#ff8888';
      removeBtn.style.cursor = 'pointer';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentSlots.set(slotId, null);
        this._updateStatsPreview();
        this._renderSlots();
      });
      card.appendChild(removeBtn);
    } else {
      // Empty slot - show "Click to select"
      const placeholder = document.createElement('div');
      placeholder.style.fontSize = '12px';
      placeholder.style.color = '#7a8ca0';
      placeholder.style.textAlign = 'center';
      placeholder.textContent = 'Click to select module';
      card.appendChild(placeholder);
    }

    card.addEventListener('click', () => {
      this._openModuleSelector(slotId);
    });

    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'rgba(100, 200, 255, 0.5)';
      card.style.background = 'rgba(30, 50, 80, 0.5)';
    });

    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'rgba(100, 150, 200, 0.2)';
      card.style.background = 'rgba(10, 16, 28, 0.5)';
    });

    return card;
  }

  _openModuleSelector(slotId) {
    const slotGroup = slotId.split('_')[0];
    const modulesForGroup = this.availableModules[slotGroup] || [];
    const currentMod = this.currentSlots.get(slotId);

    // Create modal
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0, 0, 0, 0.7)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '10000';

    const dialog = document.createElement('div');
    dialog.style.background = 'rgba(13, 20, 33, 0.9)';
    dialog.style.border = '1px solid rgba(100, 150, 200, 0.3)';
    dialog.style.borderRadius = '12px';
    dialog.style.padding = '20px';
    dialog.style.maxWidth = '600px';
    dialog.style.maxHeight = '80vh';
    dialog.style.overflowY = 'auto';

    const title = document.createElement('h3');
    title.style.margin = '0 0 16px';
    title.style.fontSize = '16px';
    title.style.color = '#e9f0ff';
    title.textContent = `Select Module for ${slotGroup.toUpperCase()} Slot`;
    dialog.appendChild(title);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
    grid.style.gap = '12px';

    const comparePanel = document.createElement('div');
    comparePanel.style.marginTop = '14px';
    comparePanel.style.padding = '10px';
    comparePanel.style.border = '1px solid rgba(120, 160, 220, 0.25)';
    comparePanel.style.borderRadius = '8px';
    comparePanel.style.background = 'rgba(10, 18, 30, 0.45)';
    comparePanel.style.display = 'none';

    modulesForGroup.forEach((mod) => {
      const cell = document.createElement('div');
      cell.style.padding = '8px';
      cell.style.border = '1px solid rgba(100, 150, 200, 0.2)';
      cell.style.borderRadius = '6px';
      cell.style.background = 'rgba(10, 16, 28, 0.5)';
      cell.style.cursor = 'pointer';
      cell.style.textAlign = 'center';
      cell.style.transition = 'all 120ms';

      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;

      const { IsometricModuleRenderer, ModuleType } = window.GQIsometricModuleRenderer || {};
      if (IsometricModuleRenderer) {
        const renderer = new IsometricModuleRenderer(canvas, { scale: 1.2 });
        const typeMap = {
          laser: ModuleType.WEAPON,
          beam: ModuleType.WEAPON,
          missile: ModuleType.WEAPON,
          reactor: ModuleType.ENERGY,
          battery: ModuleType.ENERGY,
          shield: ModuleType.SHIELD,
          armor: ModuleType.ARMOR,
          thruster: ModuleType.PROPULSION,
        };
        const moduleType = typeMap[mod.module_type?.toLowerCase()] || ModuleType.AUXILIARY;
        renderer.render({
          moduleType,
          tier: mod.tier || 1,
        });
        cell.appendChild(canvas);
      }

      const modLabel = document.createElement('div');
      modLabel.style.fontSize = '10px';
      modLabel.style.fontWeight = '600';
      modLabel.style.color = '#a8c5dd';
      modLabel.style.marginTop = '4px';
      modLabel.textContent = mod.label || mod.code;
      cell.appendChild(modLabel);

      const statText = document.createElement('div');
      statText.style.fontSize = '10px';
      statText.style.color = '#7a8ca0';
      statText.style.marginTop = '4px';
      statText.textContent = `ATK +${mod.bonus_attack || 0} | SHD +${mod.bonus_shield || 0}`;
      cell.appendChild(statText);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      actions.style.marginTop = '8px';
      actions.style.justifyContent = 'center';

      const selectBtn = document.createElement('button');
      selectBtn.textContent = 'Select';
      selectBtn.style.padding = '4px 8px';
      selectBtn.style.fontSize = '10px';
      selectBtn.style.border = '1px solid rgba(100, 200, 255, 0.45)';
      selectBtn.style.borderRadius = '4px';
      selectBtn.style.background = 'rgba(35, 70, 120, 0.6)';
      selectBtn.style.color = '#a8d8ff';
      selectBtn.style.cursor = 'pointer';
      selectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentSlots.set(slotId, mod);
        this._updateStatsPreview();
        this._renderSlots();
        modal.remove();
      });
      actions.appendChild(selectBtn);

      const compareBtn = document.createElement('button');
      compareBtn.textContent = 'Compare';
      compareBtn.style.padding = '4px 8px';
      compareBtn.style.fontSize = '10px';
      compareBtn.style.border = '1px solid rgba(190, 170, 100, 0.45)';
      compareBtn.style.borderRadius = '4px';
      compareBtn.style.background = 'rgba(90, 70, 30, 0.55)';
      compareBtn.style.color = '#e5cc93';
      compareBtn.style.cursor = 'pointer';
      compareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._renderInlineModuleComparison(comparePanel, slotId, mod, currentMod);
      });
      actions.appendChild(compareBtn);

      cell.appendChild(actions);

      cell.addEventListener('click', () => {
        this.currentSlots.set(slotId, mod);
        this._updateStatsPreview();
        this._renderSlots();
        modal.remove();
      });

      cell.addEventListener('mouseenter', () => {
        cell.style.borderColor = 'rgba(100, 200, 255, 0.5)';
        cell.style.background = 'rgba(30, 50, 80, 0.6)';
      });

      cell.addEventListener('mouseleave', () => {
        cell.style.borderColor = 'rgba(100, 150, 200, 0.2)';
        cell.style.background = 'rgba(10, 16, 28, 0.5)';
      });

      grid.appendChild(cell);
    });

    dialog.appendChild(grid);
  dialog.appendChild(comparePanel);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '16px';
    closeBtn.style.padding = '8px 16px';
    closeBtn.style.border = '1px solid rgba(100, 150, 200, 0.3)';
    closeBtn.style.borderRadius = '6px';
    closeBtn.style.background = 'rgba(30, 45, 70, 0.6)';
    closeBtn.style.color = '#a8c5dd';
    closeBtn.style.cursor = 'pointer';
    closeBtn.addEventListener('click', () => modal.remove());
    dialog.appendChild(closeBtn);

    modal.appendChild(dialog);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  _calculateModuleDelta(currentMod, candidateMod) {
    const stats = ['bonus_attack', 'bonus_shield', 'bonus_speed', 'bonus_cargo', 'energy_upkeep', 'cost', 'mass'];
    const delta = {};

    stats.forEach((key) => {
      const currentValue = Number(currentMod?.[key] || 0);
      const candidateValue = Number(candidateMod?.[key] || 0);
      delta[key] = candidateValue - currentValue;
    });

    return delta;
  }

  _renderInlineModuleComparison(target, slotId, candidateMod, currentMod) {
    if (!target) return;

    const metrics = [
      ['bonus_attack', 'Attack'],
      ['bonus_shield', 'Shield'],
      ['bonus_speed', 'Speed'],
      ['bonus_cargo', 'Cargo'],
      ['energy_upkeep', 'Energy Use'],
      ['cost', 'Cost'],
      ['mass', 'Mass'],
    ];

    const delta = this._calculateModuleDelta(currentMod, candidateMod);
    target.style.display = 'block';
    target.innerHTML = '';

    const title = document.createElement('div');
    title.style.fontSize = '12px';
    title.style.color = '#c5d8f0';
    title.style.marginBottom = '8px';
    title.style.fontWeight = '600';
    title.textContent = `Compare in ${slotId}: ${currentMod?.label || 'Empty'} -> ${candidateMod?.label || 'Candidate'}`;
    target.appendChild(title);

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '11px';

    metrics.forEach(([key, label]) => {
      const tr = document.createElement('tr');

      const tdLabel = document.createElement('td');
      tdLabel.style.padding = '4px 6px';
      tdLabel.style.borderBottom = '1px solid rgba(90, 120, 170, 0.2)';
      tdLabel.style.color = '#9eb7d4';
      tdLabel.textContent = label;
      tr.appendChild(tdLabel);

      const tdCurrent = document.createElement('td');
      tdCurrent.style.padding = '4px 6px';
      tdCurrent.style.borderBottom = '1px solid rgba(90, 120, 170, 0.2)';
      tdCurrent.style.color = '#7a8ca0';
      tdCurrent.style.textAlign = 'right';
      tdCurrent.textContent = String(Number(currentMod?.[key] || 0));
      tr.appendChild(tdCurrent);

      const tdCandidate = document.createElement('td');
      tdCandidate.style.padding = '4px 6px';
      tdCandidate.style.borderBottom = '1px solid rgba(90, 120, 170, 0.2)';
      tdCandidate.style.color = '#d6ecff';
      tdCandidate.style.textAlign = 'right';
      tdCandidate.textContent = String(Number(candidateMod?.[key] || 0));
      tr.appendChild(tdCandidate);

      const tdDelta = document.createElement('td');
      tdDelta.style.padding = '4px 6px';
      tdDelta.style.borderBottom = '1px solid rgba(90, 120, 170, 0.2)';
      tdDelta.style.textAlign = 'right';
      const d = Number(delta[key] || 0);
      tdDelta.style.color = d >= 0 ? '#8bdc8b' : '#f1a2a2';
      tdDelta.textContent = d >= 0 ? `+${d}` : `${d}`;
      tr.appendChild(tdDelta);

      table.appendChild(tr);
    });

    target.appendChild(table);
  }

  _renderStatsPreview() {
    const section = document.createElement('div');
    section.style.marginTop = '20px';
    section.style.padding = '16px';
    section.style.border = '1px solid rgba(80, 130, 220, 0.25)';
    section.style.borderRadius = '8px';
    section.style.background = 'rgba(10, 18, 32, 0.4)';

    const label = document.createElement('h3');
    label.style.margin = '0 0 12px';
    label.style.fontSize = '12px';
    label.style.color = '#7a8ca0';
    label.style.textTransform = 'uppercase';
    label.textContent = 'Stats Preview';
    section.appendChild(label);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(100px, 1fr))';
    grid.style.gap = '12px';

    const statMap = {
      cost: { label: 'Cost', unit: 'credits' },
      attack: { label: 'Attack', unit: '' },
      shield: { label: 'Shield', unit: 'HP' },
      speed: { label: 'Speed', unit: 'ly/t' },
      cargo: { label: 'Cargo', unit: 'kt' },
      energyEfficiency: { label: 'Energy', unit: '%' },
    };

    Object.entries(statMap).forEach(([key, info]) => {
      const value = this.currentStats[key];
      if (value === undefined) return;

      const chip = document.createElement('div');
      chip.style.padding = '8px 12px';
      chip.style.border = '1px solid rgba(100, 150, 200, 0.25)';
      chip.style.borderRadius = '6px';
      chip.style.background = 'rgba(20, 35, 60, 0.5)';
      chip.style.fontSize = '11px';

      const chipLabel = document.createElement('div');
      chipLabel.style.color = '#7a8ca0';
      chipLabel.style.marginBottom = '4px';
      chipLabel.textContent = info.label;
      chip.appendChild(chipLabel);

      const chipValue = document.createElement('div');
      chipValue.style.fontSize = '13px';
      chipValue.style.fontWeight = '600';
      chipValue.style.color = '#d6ecff';
      chipValue.textContent = `${value} ${info.unit}`.trim();
      chip.appendChild(chipValue);

      grid.appendChild(chip);
    });

    section.appendChild(grid);
    this.container.appendChild(section);
  }

  _showToast(message, type = 'info') {
    if (!message) return;

    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.right = '18px';
    toast.style.bottom = '18px';
    toast.style.zIndex = '10050';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 10px 24px rgba(0,0,0,0.35)';

    if (type === 'success') {
      toast.style.background = 'rgba(22, 70, 44, 0.95)';
      toast.style.border = '1px solid rgba(100, 220, 150, 0.55)';
      toast.style.color = '#baf5ce';
    } else if (type === 'error') {
      toast.style.background = 'rgba(82, 30, 30, 0.95)';
      toast.style.border = '1px solid rgba(255, 130, 130, 0.55)';
      toast.style.color = '#ffd0d0';
    } else {
      toast.style.background = 'rgba(30, 42, 72, 0.95)';
      toast.style.border = '1px solid rgba(130, 170, 230, 0.45)';
      toast.style.color = '#cfe0ff';
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 2200);
  }

  _getActionToolbarColumns(width = window.innerWidth) {
    if (width <= 760) {
      return 'repeat(2, minmax(140px, 1fr))';
    }
    if (width <= 1080) {
      return 'repeat(4, minmax(140px, 1fr))';
    }
    if (width <= 1400) {
      return 'minmax(220px, 1fr) minmax(220px, 1fr) repeat(4, auto)';
    }
    return 'minmax(220px, 1.2fr) minmax(220px, 1fr) repeat(6, auto)';
  }

  _applyActionToolbarLayout(section, width = window.innerWidth) {
    if (!section) return;
    section.style.gridTemplateColumns = this._getActionToolbarColumns(width);

    if (width <= 760) {
      section.style.position = 'sticky';
      section.style.bottom = this._getStickyBottomOffset();
      section.style.zIndex = '30';
      section.style.boxShadow = '0 12px 26px rgba(0, 0, 0, 0.35)';
    } else {
      section.style.position = 'static';
      section.style.bottom = '';
      section.style.zIndex = '';
      section.style.boxShadow = '';
    }

    this._applyActionToolbarItemLayout(section, width);
  }

  _getStickyBottomOffset() {
    return 'calc(10px + env(safe-area-inset-bottom, 0px))';
  }

  _applyActionToolbarItemLayout(section, width = window.innerWidth) {
    if (!section) return;

    const isMobile = width <= 760;
    const controls = section.querySelectorAll('[data-role^="forge-action-"]');

    controls.forEach((el) => {
      const isButton = el.tagName === 'BUTTON';
      el.style.minHeight = isMobile ? '44px' : '38px';
      el.style.fontSize = isMobile ? '13px' : '12px';
      el.style.padding = isMobile ? '10px 12px' : '10px 12px';
      if (isButton) {
        el.style.fontWeight = '600';
      }

      if (isMobile) {
        const role = el.getAttribute('data-role');
        if (role === 'forge-action-blueprint-name' || role === 'forge-action-preset-name' || role === 'forge-action-preset-select') {
          el.style.gridColumn = '1 / -1';
        } else if (role === 'forge-action-build' || role === 'forge-action-save-blueprint') {
          el.style.gridColumn = 'span 1';
        } else {
          el.style.gridColumn = 'span 1';
        }
      } else {
        el.style.gridColumn = '';
      }
    });
  }

  _ensureResponsiveBindings() {
    if (this._resizeBound) return;
    this._resizeBound = true;

    window.addEventListener('resize', () => {
      const toolbar = this.container.querySelector('[data-role="forge-actions"]');
      this._applyActionToolbarLayout(toolbar);
    });
  }

  _renderActions() {
    const section = document.createElement('div');
    section.setAttribute('data-role', 'forge-actions');
    section.style.marginTop = '20px';
    section.style.display = 'grid';
    section.style.alignItems = 'center';
    section.style.gap = '10px';
    section.style.padding = '12px';
    section.style.border = '1px solid rgba(95, 130, 190, 0.25)';
    section.style.borderRadius = '8px';
    section.style.background = 'rgba(12, 20, 34, 0.52)';
    this._applyActionToolbarLayout(section);
    this._ensureResponsiveBindings();

    const blueprintNameInput = document.createElement('input');
    blueprintNameInput.setAttribute('data-role', 'forge-action-blueprint-name');
    blueprintNameInput.type = 'text';
    blueprintNameInput.placeholder = 'Blueprint name';
    blueprintNameInput.value = this._blueprintDraftName;
    blueprintNameInput.style.padding = '10px 12px';
    blueprintNameInput.style.border = '1px solid rgba(120, 150, 200, 0.35)';
    blueprintNameInput.style.borderRadius = '6px';
    blueprintNameInput.style.background = 'rgba(18, 26, 42, 0.6)';
    blueprintNameInput.style.color = '#cbdaf0';
    blueprintNameInput.addEventListener('input', () => {
      this._blueprintDraftName = blueprintNameInput.value.trim();
    });
    section.appendChild(blueprintNameInput);

    const presetNameInput = document.createElement('input');
    presetNameInput.setAttribute('data-role', 'forge-action-preset-name');
    presetNameInput.type = 'text';
    presetNameInput.placeholder = 'Preset name';
    presetNameInput.value = this._selectedPresetName;
    presetNameInput.style.padding = '10px 12px';
    presetNameInput.style.border = '1px solid rgba(120, 150, 200, 0.35)';
    presetNameInput.style.borderRadius = '6px';
    presetNameInput.style.background = 'rgba(18, 26, 42, 0.6)';
    presetNameInput.style.color = '#cbdaf0';
    presetNameInput.addEventListener('input', () => {
      this._selectedPresetName = presetNameInput.value.trim();
    });
    section.appendChild(presetNameInput);

    const presetSelect = document.createElement('select');
    presetSelect.setAttribute('data-role', 'forge-action-preset-select');
    presetSelect.style.padding = '10px 12px';
    presetSelect.style.border = '1px solid rgba(120, 150, 200, 0.35)';
    presetSelect.style.borderRadius = '6px';
    presetSelect.style.background = 'rgba(18, 26, 42, 0.6)';
    presetSelect.style.color = '#cbdaf0';
    presetSelect.style.minWidth = '170px';

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'Select preset';
    presetSelect.appendChild(emptyOpt);

    this.listPresetNames().forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      presetSelect.appendChild(opt);
    });
    if (this._selectedPresetName) {
      presetSelect.value = this._selectedPresetName;
    }
    presetSelect.addEventListener('change', () => {
      this._selectedPresetName = presetSelect.value;
      if (this._selectedPresetName) {
        presetNameInput.value = this._selectedPresetName;
      }
    });
    section.appendChild(presetSelect);

    const saveBtn = document.createElement('button');
    saveBtn.setAttribute('data-role', 'forge-action-save-blueprint');
    saveBtn.textContent = 'Save Blueprint';
    saveBtn.style.padding = '10px 16px';
    saveBtn.style.border = '1px solid rgba(80, 200, 100, 0.4)';
    saveBtn.style.borderRadius = '6px';
    saveBtn.style.background = 'rgba(30, 80, 50, 0.6)';
    saveBtn.style.color = '#88dd88';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.fontWeight = '600';
    saveBtn.addEventListener('click', async () => {
      const name = (blueprintNameInput.value || '').trim();
      if (!name) {
        this.lastError = 'Blueprint name is required';
        this._showToast(this.lastError, 'error');
        return;
      }
      const result = await this.saveBlueprint(name);
      if (result) {
        this._blueprintDraftName = name;
        this._showToast(`Blueprint saved: ${name}`, 'success');
      } else {
        this._showToast(this.lastError || 'Failed to save blueprint', 'error');
      }
    });
    section.appendChild(saveBtn);

    const buildBtn = document.createElement('button');
    buildBtn.setAttribute('data-role', 'forge-action-build');
    buildBtn.textContent = 'Build Ship';
    buildBtn.style.padding = '10px 16px';
    buildBtn.style.border = '1px solid rgba(100, 180, 255, 0.4)';
    buildBtn.style.borderRadius = '6px';
    buildBtn.style.background = 'rgba(30, 60, 100, 0.6)';
    buildBtn.style.color = '#88d0ff';
    buildBtn.style.cursor = 'pointer';
    buildBtn.style.fontWeight = '600';
    buildBtn.addEventListener('click', async () => {
      const result = await this.buildShip();
      if (result) {
        this._showToast('Ship build started successfully', 'success');
      } else {
        this._showToast(this.lastError || 'Build failed', 'error');
      }
    });
    section.appendChild(buildBtn);

    const exportBtn = document.createElement('button');
    exportBtn.setAttribute('data-role', 'forge-action-export');
    exportBtn.textContent = 'Export Config';
    exportBtn.style.padding = '10px 16px';
    exportBtn.style.border = '1px solid rgba(180, 150, 80, 0.4)';
    exportBtn.style.borderRadius = '6px';
    exportBtn.style.background = 'rgba(80, 60, 30, 0.5)';
    exportBtn.style.color = '#ddaa88';
    exportBtn.style.cursor = 'pointer';
    exportBtn.addEventListener('click', () => {
      const data = this.export();
      console.log(JSON.stringify(data, null, 2));
      this._showToast('Configuration exported to console', 'info');
    });
    section.appendChild(exportBtn);

    const savePresetBtn = document.createElement('button');
    savePresetBtn.setAttribute('data-role', 'forge-action-save-preset');
    savePresetBtn.textContent = 'Save Preset';
    savePresetBtn.style.padding = '10px 16px';
    savePresetBtn.style.border = '1px solid rgba(155, 140, 255, 0.45)';
    savePresetBtn.style.borderRadius = '6px';
    savePresetBtn.style.background = 'rgba(65, 45, 120, 0.55)';
    savePresetBtn.style.color = '#c9b9ff';
    savePresetBtn.style.cursor = 'pointer';

    savePresetBtn.addEventListener('click', () => {
      const name = (presetNameInput.value || '').trim();
      if (!name) {
        this.lastError = 'Preset name is required';
        this._showToast(this.lastError, 'error');
        return;
      }
      this.saveCurrentAsPreset(name);
      this._selectedPresetName = name;
      this._showToast(`Preset saved: ${name}`, 'success');
      this._renderUI();
    });
    section.appendChild(savePresetBtn);

    const loadPresetBtn = document.createElement('button');
    loadPresetBtn.setAttribute('data-role', 'forge-action-load-preset');
    loadPresetBtn.textContent = 'Load Preset';
    loadPresetBtn.style.padding = '10px 16px';
    loadPresetBtn.style.border = '1px solid rgba(130, 170, 230, 0.4)';
    loadPresetBtn.style.borderRadius = '6px';
    loadPresetBtn.style.background = 'rgba(45, 60, 100, 0.6)';
    loadPresetBtn.style.color = '#9ec4ff';
    loadPresetBtn.style.cursor = 'pointer';
    loadPresetBtn.addEventListener('click', () => {
      const selected = (presetSelect.value || '').trim();
      if (!selected) {
        this.lastError = 'No presets available';
        this._showToast(this.lastError, 'error');
        return;
      }
      if (this.applyPreset(selected)) {
        this._showToast(`Preset loaded: ${selected}`, 'success');
      } else {
        this._showToast('Failed to load preset', 'error');
      }
    });
    section.appendChild(loadPresetBtn);

    const deletePresetBtn = document.createElement('button');
    deletePresetBtn.setAttribute('data-role', 'forge-action-delete-preset');
    deletePresetBtn.textContent = 'Delete Preset';
    deletePresetBtn.style.padding = '10px 16px';
    deletePresetBtn.style.border = '1px solid rgba(220, 110, 110, 0.4)';
    deletePresetBtn.style.borderRadius = '6px';
    deletePresetBtn.style.background = 'rgba(90, 35, 35, 0.55)';
    deletePresetBtn.style.color = '#ffb2b2';
    deletePresetBtn.style.cursor = 'pointer';
    deletePresetBtn.addEventListener('click', () => {
      const selected = (presetSelect.value || '').trim();
      if (!selected) {
        this.lastError = 'No presets available';
        this._showToast(this.lastError, 'error');
        return;
      }
      this.deletePreset(selected);
      this._selectedPresetName = '';
      this._showToast(`Preset deleted: ${selected}`, 'success');
      this._renderUI();
    });
    section.appendChild(deletePresetBtn);

    this.container.appendChild(section);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShipyardBlueprintForge };
} else {
  window.GQShipyardBlueprintForge = { ShipyardBlueprintForge };
}
