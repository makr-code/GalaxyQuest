/**
 * GalaxyUI - Renders 3D galaxy and star system list
 * Responsible for: 3D rendering, star selection, camera control UI
 * Uses: GalaxyController for all state changes
 */

export class GalaxyUI {
  constructor(galaxyController, domTarget) {
    this.controller = galaxyController;
    this.domTarget = domTarget;
    this.state = {
      selectedStarId: null,
    };

    if (domTarget) {
      this.container = domTarget;
      this.render();
    }

    // Subscribe to controller state changes
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  /**
   * Main render
   */
  render() {
    if (!this.container) return;

    const html = this._buildHtml();
    this.container.innerHTML = html;
    this._attachEventHandlers();
  }

  /**
   * Re-render section (optimized)
   */
  _rerenderSection(sectionName) {
    if (!this.container) return;

    const section = this.container.querySelector(`.galaxy-section-${sectionName}`);
    if (!section) return;

    let html = '';
    switch (sectionName) {
      case 'starlist':
        html = this._buildStarListSection();
        break;
      case 'details':
        html = this._buildDetailsSection();
        break;
      case 'controls':
        html = this._buildControlsSection();
        break;
    }

    section.innerHTML = html;
    this._attachEventHandlers();
  }

  /**
   * Build complete HTML
   */
  _buildHtml() {
    return `
      <div class="galaxy-panel">
        <div class="galaxy-header">
          <h2>🌌 Galaxy</h2>
        </div>

        <div class="galaxy-content">
          <div class="galaxy-main">
            ${this._buildCanvasSection()}
            ${this._buildControlsSection()}
          </div>

          <div class="galaxy-sidebar">
            ${this._buildStarListSection()}
            ${this._buildDetailsSection()}
          </div>
        </div>

        <div class="galaxy-footer">
          <button class="galaxy-btn-save" id="btn-save">💾 Save</button>
          <span class="galaxy-status" id="galaxy-status"></span>
        </div>
      </div>
    `;
  }

  /**
   * Build 3D canvas section
   */
  _buildCanvasSection() {
    return `
      <div class="galaxy-section galaxy-section-canvas">
        <canvas id="galaxy-viewport" class="galaxy-viewport"></canvas>
        <div class="galaxy-hud">
          <div class="hud-zoom">
            Zoom: <span id="hud-zoom-level">1.0x</span>
          </div>
          <div class="hud-camera">
            Pos: <span id="hud-camera-pos">0, 0, 0</span>
          </div>
          <div class="hud-selected">
            Selected: <span id="hud-selected-star">None</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Build controls section
   */
  _buildControlsSection() {
    return `
      <div class="galaxy-section galaxy-section-controls">
        <h3>Camera Controls</h3>
        <div class="controls-group">
          <button class="control-btn" id="btn-zoom-in">🔍+ Zoom In</button>
          <button class="control-btn" id="btn-zoom-out">🔍- Zoom Out</button>
          <button class="control-btn" id="btn-reset-view">🎯 Reset View</button>
        </div>
        <div class="view-mode-toggle">
          <label>
            <input type="radio" name="viewMode" value="galaxy" checked>
            Galaxy View
          </label>
          <label>
            <input type="radio" name="viewMode" value="sector">
            Sector View
          </label>
        </div>
      </div>
    `;
  }

  /**
   * Build star list section
   */
  _buildStarListSection() {
    const stars = this.controller.getAllStars();

    let html = `
      <div class="galaxy-section galaxy-section-starlist">
        <h3>Star Systems (${stars.length})</h3>
        <div class="star-list">
    `;

    stars.forEach(star => {
      const isSelected = this.state.selectedStarId === star.id;
      const tierEmoji = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'][star.tier - 1] || '⭐';

      html += `
        <div class="star-card ${isSelected ? 'selected' : ''}" data-star-id="${star.id}">
          <div class="star-name">${star.name}</div>
          <div class="star-info">
            <span class="star-tier">${tierEmoji}</span>
            <span class="star-type">${star.type}</span>
          </div>
          <div class="star-coords">
            ${star.x.toFixed(1)}, ${star.y.toFixed(1)}, ${star.z.toFixed(1)}
          </div>
          ${star.factions.length > 0 ? `<div class="star-factions">👥 ${star.factions.join(', ')}</div>` : ''}
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
    return html;
  }

  /**
   * Build details section
   */
  _buildDetailsSection() {
    const selectedStarId = this.controller.state.get('selectedStarId');
    if (!selectedStarId) {
      return `
        <div class="galaxy-section galaxy-section-details">
          <p class="empty-message">Select a star to view details</p>
        </div>
      `;
    }

    const star = this.controller.getStar(selectedStarId);
    if (!star) {
      return `
        <div class="galaxy-section galaxy-section-details">
          <p class="error-message">Star not found</p>
        </div>
      `;
    }

    return `
      <div class="galaxy-section galaxy-section-details">
        <h3>${star.name}</h3>
        <div class="details-grid">
          <div class="detail-item">
            <span class="label">Type:</span>
            <span class="value">${star.type}</span>
          </div>
          <div class="detail-item">
            <span class="label">Tier:</span>
            <span class="value">${star.tier}</span>
          </div>
          <div class="detail-item">
            <span class="label">Position:</span>
            <span class="value">${star.x.toFixed(1)}, ${star.y.toFixed(1)}, ${star.z.toFixed(1)}</span>
          </div>
          <div class="detail-item">
            <span class="label">Resources:</span>
            <ul>
              <li>💰 Credits: ${star.resources.credits}</li>
              <li>⛏️ Minerals: ${star.resources.minerals}</li>
              <li>⚡ Energy: ${star.resources.energy}</li>
            </ul>
          </div>
          <div class="detail-item">
            <span class="label">Planets:</span>
            <span class="value">${star.planets?.length || 0}</span>
          </div>
        </div>
        <div class="action-buttons">
          <button class="action-btn" id="btn-view-star">👁️ View</button>
          <button class="action-btn" id="btn-send-fleet">🚀 Send Fleet</button>
        </div>
      </div>
    `;
  }

  /**
   * Attach event handlers
   */
  _attachEventHandlers() {
    // Star selection
    this.container.querySelectorAll('.star-card').forEach(card => {
      card.addEventListener('click', () => {
        const starId = card.dataset.starId;
        this.state.selectedStarId = starId;

        try {
          this.controller.selectStar(starId);

          // Update visuals
          this.container.querySelectorAll('.star-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');

          // Re-render details
          this._rerenderSection('details');
        } catch (err) {
          this._handleError(err);
        }
      });
    });

    // Camera controls
    const zoomInBtn = this.container.querySelector('#btn-zoom-in');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        const currentZoom = this.controller.state.get('zoom');
        this.controller.setZoom(currentZoom * 1.2);
      });
    }

    const zoomOutBtn = this.container.querySelector('#btn-zoom-out');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        const currentZoom = this.controller.state.get('zoom');
        this.controller.setZoom(currentZoom / 1.2);
      });
    }

    const resetBtn = this.container.querySelector('#btn-reset-view');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const sol = this.controller.getStar('sol');
        if (sol) {
          this.controller.moveCamera(sol.x, sol.y, sol.z + 50, sol.x, sol.y, sol.z);
          this.controller.setZoom(1.0);
        }
      });
    }

    // View star button
    const viewBtn = this.container.querySelector('#btn-view-star');
    if (viewBtn) {
      viewBtn.addEventListener('click', () => {
        const starId = this.controller.state.get('selectedStarId');
        const star = this.controller.getStar(starId);
        if (star) {
          this.controller.moveCamera(star.x, star.y, star.z + 30, star.x, star.y, star.z, 1500);
          this._showStatus('📍 Navigating to ' + star.name, 2000);
        }
      });
    }

    // Save button
    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          this._showStatus('✅ Galaxy saved', 2000);
        } catch (err) {
          this._handleError(err);
        }
      });
    }

    // View mode toggle
    this.container.querySelectorAll('input[name="viewMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.controller.state.set('viewMode', e.target.value);
      });
    });
  }

  /**
   * Handle state changes
   */
  handleStateChange(change) {
    switch (change.type) {
      case 'star-selected':
        this._rerenderSection('details');
        this._updateHUD();
        break;
    }
  }

  /**
   * Update HUD display
   */
  _updateHUD() {
    const zoomEl = this.container.querySelector('#hud-zoom-level');
    if (zoomEl) {
      zoomEl.textContent = this.controller.state.get('zoom').toFixed(1) + 'x';
    }

    const posEl = this.container.querySelector('#hud-camera-pos');
    if (posEl) {
      const pos = this.controller.state.get('cameraPosition');
      posEl.textContent = `${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`;
    }

    const selectedEl = this.container.querySelector('#hud-selected-star');
    if (selectedEl) {
      const starId = this.controller.state.get('selectedStarId');
      const star = this.controller.getStar(starId);
      selectedEl.textContent = star ? star.name : 'None';
    }
  }

  /**
   * Show status message
   */
  _showStatus(message, duration = 3000) {
    const statusEl = this.container.querySelector('#galaxy-status');
    if (statusEl) {
      statusEl.textContent = message;
      setTimeout(() => {
        statusEl.textContent = '';
      }, duration);
    }
  }

  /**
   * Handle error
   */
  _handleError(error) {
    const message = error?.message || 'Unknown error';
    this._showStatus(`❌ ${message}`, 4000);
    if (this.controller.onError) {
      this.controller.onError(error);
    }
  }
}
