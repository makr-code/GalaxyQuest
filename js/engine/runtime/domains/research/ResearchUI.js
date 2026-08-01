/**
 * ResearchUI - Renders technology tree and research panel
 * Responsible for: UI rendering only (no business logic)
 * Uses: ResearchController for all state changes
 * Callback-based reactivity: controller.onStateChange → ui.render()
 * 
 * Sections:
 * - Tech Tree View (hierarchical view with prerequisites)
 * - Categories Tabs (propulsion, defense, offense)
 * - Active Research Progress (current research detail)
 * - Research Points Display (total, per-turn rate)
 * - Technology Cards (clickable tech cards with status indicators)
 */

export class ResearchUI {
  constructor(researchController, domTarget) {
    this.controller = researchController;
    this.domTarget = domTarget;
    this.state = {
      selectedCategory: 'all', // 'all', 'propulsion', 'defense', 'offense'
      expandedTechs: new Set(), // Tech IDs with expanded detail
    };

    if (domTarget) {
      this.container = domTarget;
      this.render();
    }

    // Subscribe to controller state changes
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  /**
   * Main render: build entire research panel
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

    const section = this.container.querySelector(`.research-section-${sectionName}`);
    if (!section) return;

    let html = '';
    switch (sectionName) {
      case 'active':
        html = this._buildActiveResearchSection();
        break;
      case 'points':
        html = this._buildPointsSection();
        break;
      case 'technologies':
        html = this._buildTechnologiesSection();
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
      <div class="research-panel">
        <div class="research-header">
          <h2>🔬 Technology Research</h2>
        </div>

        ${this._buildPointsSection()}
        ${this._buildActiveResearchSection()}
        ${this._buildCategoryTabsSection()}
        ${this._buildTechnologiesSection()}

        <div class="research-footer">
          <button class="research-btn-save" id="btn-save">💾 Save</button>
          <span class="research-status" id="research-status"></span>
        </div>
      </div>
    `;
  }

  /**
   * Build research points display section
   */
  _buildPointsSection() {
    const points = this.controller.state.get('researchPoints');
    const pointsPerTurn = this.controller.state.get('pointsPerTurn');
    const activeResearch = this.controller.state.get('activeResearch');

    let pointsDisplay = `${points} RP`;
    if (activeResearch) {
      const tech = this.controller.getTechnology(activeResearch);
      const pointsNeeded = tech.cost - points;
      const turnsRemaining = Math.ceil(pointsNeeded / pointsPerTurn);
      pointsDisplay += ` (${turnsRemaining} turns to complete)`;
    }

    return `
      <div class="research-section research-section-points">
        <div class="points-display">
          <span class="points-total">${pointsDisplay}</span>
          <span class="points-rate">+${pointsPerTurn} per turn</span>
        </div>
      </div>
    `;
  }

  /**
   * Build active research section
   */
  _buildActiveResearchSection() {
    const activeResearchId = this.controller.state.get('activeResearch');

    if (!activeResearchId) {
      return `
        <div class="research-section research-section-active">
          <h3>Active Research</h3>
          <p class="no-active">No active research. Select a technology to begin.</p>
        </div>
      `;
    }

    const tech = this.controller.getTechnology(activeResearchId);
    const points = this.controller.state.get('researchPoints');
    const progress = (points / tech.cost) * 100;

    return `
      <div class="research-section research-section-active">
        <h3>Currently Researching</h3>
        <div class="active-research-card">
          <div class="active-tech-header">
            <span class="active-tech-name">${tech.name}</span>
            <span class="active-tech-tier">Tier ${tech.tier}</span>
          </div>
          <div class="active-tech-description">${tech.description}</div>
          <div class="active-tech-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <span class="progress-text">${Math.floor(progress)}% (${points}/${tech.cost} RP)</span>
          </div>
          <div class="active-tech-actions">
            <button class="research-btn-cancel" id="btn-cancel-research">⏹ Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Build category tabs section
   */
  _buildCategoryTabsSection() {
    const categories = this.controller.state.get('categories');
    const selectedCat = this.state.selectedCategory;

    let html = `
      <div class="research-section research-section-tabs">
        <div class="category-tabs">
          <button class="tab-btn ${selectedCat === 'all' ? 'active' : ''}" data-category="all">
            All (${Object.values(categories).reduce((sum, cat) => sum + cat.total, 0)})
          </button>
    `;

    Object.entries(categories).forEach(([cat, stats]) => {
      const isActive = selectedCat === cat;
      html += `
        <button class="tab-btn ${isActive ? 'active' : ''}" data-category="${cat}">
          ${this._categoryLabel(cat)} (${stats.completed}/${stats.total})
        </button>
      `;
    });

    html += `
        </div>
      </div>
    `;
    return html;
  }

  /**
   * Build technologies section
   */
  _buildTechnologiesSection() {
    const techs = this.controller.getAllTechnologies();
    const filtered = this.state.selectedCategory === 'all'
      ? techs
      : techs.filter(t => t.category === this.state.selectedCategory);

    const byTier = {};
    filtered.forEach(tech => {
      if (!byTier[tech.tier]) byTier[tech.tier] = [];
      byTier[tech.tier].push(tech);
    });

    let html = `
      <div class="research-section research-section-technologies">
        <div class="technologies-grid">
    `;

    const tiers = Object.keys(byTier).sort((a, b) => Number(a) - Number(b));
    tiers.forEach(tier => {
      html += `<div class="tier-group"><h4>Tier ${tier}</h4>`;

      byTier[tier].forEach(tech => {
        const statusClass = `tech-${tech.status}`;
        const isExpanded = this.state.expandedTechs.has(tech.id);

        html += `
          <div class="tech-card ${statusClass}" data-tech-id="${tech.id}">
            <div class="tech-header">
              <span class="tech-name">${tech.name}</span>
              <span class="tech-status-badge">${tech.status}</span>
            </div>
            <div class="tech-description">${tech.description}</div>
            <div class="tech-cost">
              💎 ${tech.cost} RP
              ${tech.progress > 0 ? ` (${Math.floor(tech.progress)}%)` : ''}
            </div>
        `;

        if (tech.prerequisites.length > 0) {
          html += `
            <div class="tech-prerequisites">
              <small>Requires: ${tech.prerequisites.map(p => this.controller.getTechnology(p)?.name || p).join(', ')}</small>
            </div>
          `;
        }

        html += `
            <div class="tech-actions">
        `;

        if (tech.status === 'available') {
          html += `<button class="research-btn-start" data-tech-id="${tech.id}">▶ Research</button>`;
        } else if (tech.status === 'locked') {
          html += `<button class="research-btn-locked" disabled>🔒 Locked</button>`;
        } else if (tech.status === 'completed') {
          html += `<span class="tech-completed">✅ Completed</span>`;
        } else if (tech.status === 'researching') {
          html += `<span class="tech-researching">⏳ Researching...</span>`;
        }

        html += `
            </div>
          </div>
        `;
      });

      html += `</div>`;
    });

    html += `
        </div>
      </div>
    `;
    return html;
  }

  /**
   * Get category label
   */
  _categoryLabel(category) {
    const labels = {
      propulsion: '🚀 Propulsion',
      defense: '🛡️ Defense',
      offense: '⚔️ Offense',
    };
    return labels[category] || category;
  }

  /**
   * Attach event handlers to buttons and inputs
   */
  _attachEventHandlers() {
    // Category tab buttons
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const category = e.target.dataset.category;
        this.state.selectedCategory = category;

        // Update active tab
        this.container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        // Re-render technologies
        this._rerenderSection('technologies');
      });
    });

    // Start research buttons
    this.container.querySelectorAll('.research-btn-start').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const techId = e.target.dataset.techId;
        try {
          this.controller.startResearch(techId);
        } catch (err) {
          this._handleError(err);
        }
      });
    });

    // Cancel research button
    const cancelBtn = this.container.querySelector('#btn-cancel-research');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        try {
          this.controller.cancelResearch();
        } catch (err) {
          this._handleError(err);
        }
      });
    }

    // Save button
    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          this._showStatus('✅ Research state saved', 2000);
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
      case 'research-started':
        this._rerenderSection('active');
        this._rerenderSection('technologies');
        break;
      case 'research-completed':
        this._rerenderSection('active');
        this._rerenderSection('points');
        this._rerenderSection('technologies');
        break;
      case 'research-cancelled':
        this._rerenderSection('active');
        this._rerenderSection('technologies');
        break;
      case 'points-added':
        this._rerenderSection('points');
        this._rerenderSection('active');
        break;
      case 'locked':
      case 'unlocked':
        this._updateControlsState();
        break;
    }
  }

  /**
   * Update control states based on lock status
   */
  _updateControlsState() {
    const isLocked = this.controller.state.get('isLocked');
    this.container.querySelectorAll('button').forEach(btn => {
      if (!btn.classList.contains('tab-btn')) {
        btn.disabled = isLocked;
      }
    });
  }

  /**
   * Show status message
   */
  _showStatus(message, duration = 3000) {
    const statusEl = this.container.querySelector('#research-status');
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
