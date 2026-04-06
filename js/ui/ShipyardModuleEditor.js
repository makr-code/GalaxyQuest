/**
 * ShipyardModuleEditor.js — Integration of IsometricModuleRenderer with shipyard UI
 *
 * Provides component methods for rendering modules in the shipyard blueprint forge,
 * including slot preview, module selection dialogs, and equipment configuration UI.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ShipyardModuleEditor {
  /**
   * @param {object} opts
   * @param {HTMLElement} [opts.container] — root container for module UI
   * @param {object} [opts.moduleTypes] — custom module type mappings
   * @param {function} [opts.onModuleSelect] — callback when module is selected
   */
  constructor(opts = {}) {
    this.container = opts.container;
    this.onModuleSelect = opts.onModuleSelect || null;
    this.selectedModule = null;
    this.activeSlots = new Map(); // slotId -> { moduleType, tier, damageState }
    this._renderers = new Map(); // canvasElement -> IsometricModuleRenderer
  }

  /**
   * Render a single module in a given container (canvas or div).
   *
   * @param {HTMLElement} element
   * @param {object} modularConfig
   * @returns {boolean} success
   */
  renderModule(element, modularConfig = {}) {
    if (!element) return false;

    // Create or reuse canvas
    let canvas = element.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 120;
      canvas.style.display = 'block';
      element.appendChild(canvas);
    }

    // Get or create renderer
    let renderer = this._renderers.get(canvas);
    if (!renderer) {
      const { IsometricModuleRenderer } = window.GQIsometricModuleRenderer || {};
      if (!IsometricModuleRenderer) {
        console.warn('[ShipyardModuleEditor] IsometricModuleRenderer not loaded');
        return false;
      }
      renderer = new IsometricModuleRenderer(canvas, { scale: 1.5 });
      this._renderers.set(canvas, renderer);
    }

    // Render module
    return renderer.render({
      moduleType: modularConfig.moduleType || 'ENERGY',
      tier: modularConfig.tier || 1,
      damageState: modularConfig.damageState || 'intact',
      upgraded: modularConfig.upgraded || false,
      highlighted: modularConfig.highlighted || false,
      rotation: modularConfig.rotation || 0,
    });
  }

  /**
   * Render a grid of modules (e.g., for slot selection dialog).
   *
   * @param {HTMLElement} container
   * @param {Array<object>} modules
   * @returns {boolean} success
   */
  renderModuleGrid(container, modules) {
    if (!container || !Array.isArray(modules)) return false;

    // Create fixed canvas in grid layout
    container.innerHTML = '';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
    container.style.gap = '12px';
    container.style.padding = '12px';

    modules.forEach((mod, idx) => {
      const cell = document.createElement('div');
      cell.className = 'module-grid-cell';
      cell.style.cursor = 'pointer';
      cell.style.border = '1px solid rgba(100, 150, 200, 0.3)';
      cell.style.borderRadius = '8px';
      cell.style.padding = '8px';
      cell.style.backgroundColor = 'rgba(10, 16, 28, 0.5)';
      cell.style.transition = 'all 150ms';

      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;

      const { IsometricModuleRenderer } = window.GQIsometricModuleRenderer || {};
      if (IsometricModuleRenderer) {
        const renderer = new IsometricModuleRenderer(canvas, { scale: 1.2 });
        renderer.render({
          moduleType: mod.moduleType || 'ENERGY',
          tier: mod.tier || 1,
          damageState: mod.damageState || 'intact',
        });
      }

      cell.appendChild(canvas);

      // Label
      const label = document.createElement('div');
      label.style.fontSize = '11px';
      label.style.color = '#a8c5dd';
      label.style.marginTop = '6px';
      label.style.textAlign = 'center';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.textContent = mod.label || mod.moduleType || 'Unknown';
      cell.appendChild(label);

      // Click handler
      cell.addEventListener('click', () => {
        this._selectModule(mod, cell);
        if (this.onModuleSelect) this.onModuleSelect(mod);
      });

      cell.addEventListener('mouseenter', () => {
        cell.style.borderColor = 'rgba(100, 200, 255, 0.6)';
        cell.style.backgroundColor = 'rgba(30, 50, 80, 0.7)';
        cell.style.boxShadow = '0 0 12px rgba(100, 180, 255, 0.4)';
      });

      cell.addEventListener('mouseleave', () => {
        if (this.selectedModule !== mod) {
          cell.style.borderColor = 'rgba(100, 150, 200, 0.3)';
          cell.style.backgroundColor = 'rgba(10, 16, 28, 0.5)';
          cell.style.boxShadow = 'none';
        }
      });

      container.appendChild(cell);
    });

    return true;
  }

  /**
   * Create a module slot preview panel (used in blueprint editor).
   *
   * @param {HTMLElement} container
   * @param {string} slotId
   * @param {object} slotConfig
   * @returns {HTMLElement} the slot panel
   */
  createSlotPanel(container, slotId, slotConfig = {}) {
    const panel = document.createElement('div');
    panel.className = 'module-slot-panel';
    panel.dataset.slotId = slotId;
    panel.style.display = 'grid';
    panel.style.gridTemplateColumns = '120px 1fr';
    panel.style.gap = '12px';
    panel.style.padding = '12px';
    panel.style.border = '1px solid rgba(100, 150, 200, 0.25)';
    panel.style.borderRadius = '8px';
    panel.style.backgroundColor = 'rgba(13, 20, 33, 0.4)';
    panel.style.alignItems = 'start';

    // Module preview canvas
    const previewDiv = document.createElement('div');
    previewDiv.style.width = '120px';
    previewDiv.style.height = '120px';
    panel.appendChild(previewDiv);

    // Module info
    const infoDiv = document.createElement('div');
    infoDiv.style.display = 'flex';
    infoDiv.style.flexDirection = 'column';
    infoDiv.style.gap = '8px';

    // Title
    const title = document.createElement('div');
    title.style.fontSize = '13px';
    title.style.fontWeight = '700';
    title.style.color = '#e9f0ff';
    title.textContent = slotConfig.label || 'Module Slot';
    infoDiv.appendChild(title);

    // Stats chips
    const statsDiv = document.createElement('div');
    statsDiv.style.display = 'flex';
    statsDiv.style.flexWrap = 'wrap';
    statsDiv.style.gap = '6px';

    const tier = slotConfig.tier || 1;
    const tierChip = this._createStatChip('Tier', tier, `var(--tier-${tier}-color, #ffcc00)`);
    statsDiv.appendChild(tierChip);

    if (slotConfig.damageState && slotConfig.damageState !== 'intact') {
      const dmgChip = this._createStatChip('Status', slotConfig.damageState, '#ff6644');
      statsDiv.appendChild(dmgChip);
    }

    infoDiv.appendChild(statsDiv);

    // Action buttons
    const actionDiv = document.createElement('div');
    actionDiv.style.display = 'flex';
    actionDiv.style.gap = '6px';
    actionDiv.style.marginTop = '8px';

    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'module-btn-replace';
    replaceBtn.textContent = 'Replace';
    replaceBtn.style.flex = '1';
    replaceBtn.style.padding = '6px 12px';
    replaceBtn.style.border = '1px solid rgba(100, 150, 200, 0.3)';
    replaceBtn.style.borderRadius = '6px';
    replaceBtn.style.background = 'rgba(30, 45, 70, 0.7)';
    replaceBtn.style.color = '#a8c5dd';
    replaceBtn.style.cursor = 'pointer';
    replaceBtn.style.fontSize = '11px';
    replaceBtn.addEventListener('click', () => this._openModuleSelector(slotId, previewDiv));
    actionDiv.appendChild(replaceBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'module-btn-remove';
    removeBtn.textContent = '✕';
    removeBtn.style.width = '32px';
    removeBtn.style.padding = '6px';
    removeBtn.style.border = '1px solid rgba(220, 70, 70, 0.3)';
    removeBtn.style.borderRadius = '6px';
    removeBtn.style.background = 'rgba(50, 20, 20, 0.5)';
    removeBtn.style.color = '#ff8888';
    removeBtn.style.cursor = 'pointer';
    removeBtn.addEventListener('click', () => this._clearSlot(slotId));
    actionDiv.appendChild(removeBtn);

    infoDiv.appendChild(actionDiv);
    panel.appendChild(infoDiv);

    // Render module if provided
    if (slotConfig.moduleType) {
      this.renderModule(previewDiv, slotConfig);
    }

    container.appendChild(panel);
    this.activeSlots.set(slotId, slotConfig);

    return panel;
  }

  /**
   * Create uniform stat chips for display.
   * @private
   */
  _createStatChip(label, value, color) {
    const chip = document.createElement('div');
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.style.gap = '4px';
    chip.style.padding = '4px 8px';
    chip.style.fontSize = '11px';
    chip.style.border = `1px solid ${color || '#888'}`;
    chip.style.borderRadius = '999px';
    chip.style.backgroundColor = `rgba(200, 100, 100, 0.15)`;
    chip.style.color = color || '#aaa';
    chip.innerHTML = `<strong>${label}:</strong> ${value}`;
    return chip;
  }

  /**
   * Open module selector dialog for a slot.
   * @private
   */
  _openModuleSelector(slotId, targetContainer) {
    // This would be called from the shipyard to let user pick a module
    // Emit event or callback for the outer UI to handle
    const ev = new CustomEvent('gq:module-selector-request', {
      detail: { slotId, targetContainer },
    });
    window.dispatchEvent(ev);
  }

  /**
   * Clear a module slot.
   * @private
   */
  _clearSlot(slotId) {
    this.activeSlots.delete(slotId);
    const panel = document.querySelector(`[data-slot-id="${slotId}"]`);
    if (panel) panel.remove();
  }

  /**
   * Select a module (visual feedback).
   * @private
   */
  _selectModule(mod, element) {
    document.querySelectorAll('.module-grid-cell').forEach(cell => {
      cell.style.borderColor = 'rgba(100, 150, 200, 0.3)';
      cell.style.backgroundColor = 'rgba(10, 16, 28, 0.5)';
      cell.style.boxShadow = 'none';
    });

    element.style.borderColor = 'rgba(100, 200, 255, 0.8)';
    element.style.backgroundColor = 'rgba(30, 60, 100, 0.8)';
    element.style.boxShadow = '0 0 16px rgba(100, 180, 255, 0.5)';

    this.selectedModule = mod;
  }

  /**
   * Export current slots as JSON for save.
   */
  exportSlots() {
    const slots = {};
    this.activeSlots.forEach((config, slotId) => {
      slots[slotId] = {
        moduleType: config.moduleType,
        tier: config.tier,
        damageState: config.damageState,
        upgraded: config.upgraded,
      };
    });
    return slots;
  }

  /**
   * Import slots from JSON.
   */
  importSlots(container, slotsObj) {
    if (!slotsObj || typeof slotsObj !== 'object') return false;
    Object.entries(slotsObj).forEach(([slotId, config]) => {
      this.createSlotPanel(container, slotId, config);
    });
    return true;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShipyardModuleEditor };
} else {
  window.GQShipyardModuleEditor = { ShipyardModuleEditor };
}
