/**
 * ColonizationUI - Renders colonies and colonization panel
 * Responsible for: UI rendering only (no business logic)
 * Uses: ColonizationController for all state changes
 */

export class ColonizationUI {
  constructor(colonizationController, domTarget) {
    this.controller = colonizationController;
    this.domTarget = domTarget;
    this.state = {
      selectedColonyId: null, // Currently selected colony
    };

    if (domTarget) {
      this.container = domTarget;
      this.render();
    }

    // Subscribe to controller state changes
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  /**
   * Main render: build entire colonization panel
   */
  render() {
    if (!this.container) return;

    const html = this._buildHtml();
    this.container.innerHTML = html;
    this._attachEventHandlers();
  }

  /**
   * Re-render specific section (optimized)
   */
  _rerenderSection(sectionName) {
    if (!this.container) return;

    const section = this.container.querySelector(`.colonization-section-${sectionName}`);
    if (!section) return;

    let html = '';
    switch (sectionName) {
      case 'overview':
        html = this._buildOverviewSection();
        break;
      case 'colonies':
        html = this._buildColoniesSection();
        break;
      case 'details':
        html = this._buildDetailsSection();
        break;
    }

    section.innerHTML = html;
    this._attachEventHandlers();
  }

  /**
   * Build complete HTML structure
   */
  _buildHtml() {
    return `
      <div class="colonization-panel">
        <div class="colonization-header">
          <h2>🏗️ Colonization</h2>
        </div>

        ${this._buildOverviewSection()}
        ${this._buildColoniesSection()}
        ${this._buildDetailsSection()}

        <div class="colonization-footer">
          <button class="colonization-btn-save" id="btn-save">💾 Save</button>
          <span class="colonization-status" id="colonization-status"></span>
        </div>
      </div>
    `;
  }

  /**
   * Build overview section
   */
  _buildOverviewSection() {
    const totalPopulation = this.controller.state.get('totalPopulation');
    const totalColonies = this.controller.state.get('totalColonies');

    return `
      <div class="colonization-section colonization-section-overview">
        <div class="overview-stats">
          <div class="stat-card">
            <span class="stat-label">Total Population</span>
            <span class="stat-value">${totalPopulation.toLocaleString()}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Colonies</span>
            <span class="stat-value">${totalColonies}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Build colonies list section
   */
  _buildColoniesSection() {
    const colonies = this.controller.getAllColonies();

    let html = `
      <div class="colonization-section colonization-section-colonies">
        <h3>Colonies (${colonies.length})</h3>
        ${colonies.length === 0 ? '<p class="empty-message">No colonies yet. Colonize a planet to begin.</p>' : ''}
        <div class="colonies-list">
    `;

    colonies.forEach(colony => {
      const isSelected = this.state.selectedColonyId === colony.id;
      const growth = colony.population / colony.populationCap * 100;

      html += `
        <div class="colony-card ${isSelected ? 'selected' : ''}" data-colony-id="${colony.id}">
          <div class="colony-header">
            <span class="colony-name">${colony.name}</span>
            <span class="colony-status status-${colony.status}">${colony.status}</span>
          </div>
          <div class="colony-stats">
            <span>👥 ${colony.population.toLocaleString()} / ${colony.populationCap.toLocaleString()}</span>
            <div class="population-bar">
              <div class="population-fill" style="width: ${growth}%"></div>
            </div>
          </div>
          <div class="colony-resources">
            <span>💰 ${colony.resources.credits}</span>
            <span>⛏️ ${colony.resources.minerals}</span>
            <span>⚡ ${colony.resources.energy}</span>
            <span>🌾 ${colony.resources.food}</span>
          </div>
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
   * Build colony details section
   */
  _buildDetailsSection() {
    if (!this.state.selectedColonyId) {
      return `
        <div class="colonization-section colonization-section-details">
          <p class="empty-message">Select a colony to view details</p>
        </div>
      `;
    }

    const colony = this.controller.getColony(this.state.selectedColonyId);
    if (!colony) {
      return `
        <div class="colonization-section colonization-section-details">
          <p class="error-message">Colony not found</p>
        </div>
      `;
    }

    const buildingTypes = this.controller.state.get('buildingTypes');

    let html = `
      <div class="colonization-section colonization-section-details">
        <h3>Colony Details: ${colony.name}</h3>
        <div class="details-grid">
          <div class="details-section">
            <h4>Population</h4>
            <p>Current: ${colony.population.toLocaleString()}</p>
            <p>Capacity: ${colony.populationCap.toLocaleString()}</p>
            <p>Growth Rate: ${(colony.growthRate * 100).toFixed(1)}%</p>
          </div>

          <div class="details-section">
            <h4>Resources</h4>
            <ul>
              <li>💰 Credits: ${colony.resources.credits}</li>
              <li>⛏️ Minerals: ${colony.resources.minerals}</li>
              <li>⚡ Energy: ${colony.resources.energy}</li>
              <li>🌾 Food: ${colony.resources.food}</li>
            </ul>
          </div>

          <div class="details-section">
            <h4>Buildings (${Object.values(colony.buildings).reduce((sum, b) => sum + b.count, 0)})</h4>
            <ul>
    `;

    Object.entries(colony.buildings).forEach(([buildingType, building]) => {
      const buildingDef = buildingTypes[buildingType];
      html += `<li>${buildingDef?.name || buildingType}: ${building.count}</li>`;
    });

    html += `
            </ul>
          </div>

          <div class="details-section">
            <h4>Build New Building</h4>
            <div class="build-options">
    `;

    Object.values(buildingTypes).forEach(building => {
      html += `
        <button class="build-btn" data-colony-id="${colony.id}" data-building-type="${building.id}">
          + ${building.name}
        </button>
      `;
    });

    html += `
            </div>
          </div>
        </div>
      </div>
    `;
    return html;
  }

  /**
   * Attach event handlers to buttons and inputs
   */
  _attachEventHandlers() {
    // Colony selection
    this.container.querySelectorAll('.colony-card').forEach(card => {
      card.addEventListener('click', () => {
        const colonyId = card.dataset.colonyId;
        this.state.selectedColonyId = colonyId;

        // Update visual
        this.container.querySelectorAll('.colony-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        // Re-render details
        this._rerenderSection('details');
      });
    });

    // Build buttons
    this.container.querySelectorAll('.build-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const colonyId = e.target.dataset.colonyId;
        const buildingType = e.target.dataset.buildingType;

        try {
          this.controller.addBuilding(colonyId, buildingType, 1);
          this._rerenderSection('details');
          this._rerenderSection('colonies');
        } catch (err) {
          this._handleError(err);
        }
      });
    });

    // Save button
    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          this._showStatus('✅ Colony state saved', 2000);
        } catch (err) {
          this._handleError(err);
        }
      });
    }
  }

  /**
   * Handle state changes from controller
   */
  handleStateChange(change) {
    switch (change.type) {
      case 'colonized':
        this._rerenderSection('overview');
        this._rerenderSection('colonies');
        break;
      case 'building-added':
        this._rerenderSection('colonies');
        this._rerenderSection('details');
        break;
    }
  }

  /**
   * Show status message
   */
  _showStatus(message, duration = 3000) {
    const statusEl = this.container.querySelector('#colonization-status');
    if (statusEl) {
      statusEl.textContent = message;
      setTimeout(() => {
        statusEl.textContent = '';
      }, duration);
    }
  }

  /**
   * Handle error from controller
   */
  _handleError(error) {
    const message = error?.message || 'Unknown error';
    this._showStatus(`❌ ${message}`, 4000);
    if (this.controller.onError) {
      this.controller.onError(error);
    }
  }
}
