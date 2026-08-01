/**
 * WarUI - Renders war/diplomacy panel
 * Responsible for: UI rendering only (no business logic)
 * Uses: WarController for all state changes
 * Callback-based reactivity: controller.onStateChange → ui.render()
 * 
 * Sections:
 * - Conflicts List (active wars, status, combatants)
 * - Peace Treaties (signed treaties, duration remaining)
 * - War Goals (objectives, progress, rewards)
 * - Faction Relations (diplomatic stance matrix)
 * - Casualty Report (losses by faction)
 */

export class WarUI {
  constructor(warController, domTarget) {
    this.controller = warController;
    this.domTarget = domTarget;
    this.state = {}; // Local UI state for rendering

    if (domTarget) {
      this.container = domTarget;
      this.render();
    }

    // Subscribe to controller state changes
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  /**
   * Main render: build entire war panel
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

    const section = this.container.querySelector(`.war-section-${sectionName}`);
    if (!section) return;

    let html = '';
    switch (sectionName) {
      case 'conflicts':
        html = this._buildConflictsSection();
        break;
      case 'treaties':
        html = this._buildTreatiesSection();
        break;
      case 'goals':
        html = this._buildGoalsSection();
        break;
      case 'relations':
        html = this._buildRelationsSection();
        break;
      case 'casualties':
        html = this._buildCasualtiesSection();
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
      <div class="war-panel">
        <div class="war-header">
          <h2>⚔️ War & Diplomacy</h2>
          <div class="war-controls">
            <button class="war-btn-declare" id="btn-declare-war">Declare War</button>
            <button class="war-btn-negotiate" id="btn-negotiate-peace">Negotiate Peace</button>
          </div>
        </div>

        ${this._buildConflictsSection()}
        ${this._buildTreatiesSection()}
        ${this._buildGoalsSection()}
        ${this._buildRelationsSection()}
        ${this._buildCasualtiesSection()}

        <div class="war-footer">
          <button class="war-btn-save" id="btn-save">💾 Save</button>
          <span class="war-status" id="war-status"></span>
        </div>
      </div>
    `;
  }

  /**
   * Build conflicts section
   */
  _buildConflictsSection() {
    const conflicts = this.controller.getActiveConflicts();

    let html = `
      <div class="war-section war-section-conflicts">
        <h3>Active Conflicts (${conflicts.length})</h3>
        ${conflicts.length === 0 ? '<p class="empty-message">No active conflicts</p>' : ''}
        <div class="conflicts-list">
    `;

    conflicts.forEach(conflict => {
      const duration = ((Date.now() - conflict.startDate) / (1000 * 60 * 60 * 24)).toFixed(1);
      html += `
        <div class="conflict-card">
          <div class="conflict-header">
            <span class="conflict-title">${conflict.factionA} vs ${conflict.factionB}</span>
            <span class="conflict-duration">${duration} days</span>
          </div>
          <div class="conflict-details">
            <p><strong>Status:</strong> ${conflict.status}</p>
            <p><strong>Reason:</strong> ${conflict.reason}</p>
          </div>
          <div class="conflict-actions">
            <button class="action-btn" data-conflict-id="${conflict.id}" id="btn-peace-${conflict.id}">
              Negotiate Peace
            </button>
            <button class="action-btn" data-conflict-id="${conflict.id}" id="btn-view-${conflict.id}">
              View Details
            </button>
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
   * Build peace treaties section
   */
  _buildTreatiesSection() {
    const treaties = Object.values(this.controller.state.get('peaceTreaties') || {});

    let html = `
      <div class="war-section war-section-treaties">
        <h3>Peace Treaties (${treaties.length})</h3>
        ${treaties.length === 0 ? '<p class="empty-message">No active treaties</p>' : ''}
        <div class="treaties-list">
    `;

    treaties.forEach(treaty => {
      const daysLeft = (treaty.duration - ((Date.now() - treaty.startDate) / (1000 * 60 * 60 * 24))).toFixed(1);
      html += `
        <div class="treaty-card">
          <div class="treaty-header">
            <span class="treaty-factions">${treaty.factions.join(' ↔ ')}</span>
            <span class="treaty-days-left">${daysLeft}d remaining</span>
          </div>
          <div class="treaty-terms">
            <p><strong>Reparations:</strong> ${treaty.terms.reparations} credits</p>
            <p><strong>Tribute:</strong> ${treaty.terms.tribute}%</p>
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
   * Build war goals section
   */
  _buildGoalsSection() {
    const goals = Object.values(this.controller.state.get('warGoals') || {});
    const activeGoals = goals.filter(g => g.status === 'active');

    let html = `
      <div class="war-section war-section-goals">
        <h3>War Goals (${activeGoals.length})</h3>
        ${activeGoals.length === 0 ? '<p class="empty-message">No active war goals</p>' : ''}
        <div class="goals-list">
    `;

    activeGoals.forEach(goal => {
      html += `
        <div class="goal-card">
          <div class="goal-header">
            <span class="goal-type">${goal.type}</span>
            <span class="goal-reward">+${goal.reward} points</span>
          </div>
          <div class="goal-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${goal.progress}%"></div>
            </div>
            <span class="progress-text">${goal.progress}%</span>
          </div>
          <div class="goal-target">Target: ${goal.target}</div>
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
   * Build faction relations section
   */
  _buildRelationsSection() {
    // Simplified: show relations matrix for all known factions
    const allConflicts = this.controller.getAllConflicts();
    const allFactions = new Set();

    allConflicts.forEach(c => {
      allFactions.add(c.factionA);
      allFactions.add(c.factionB);
    });

    const factionArray = Array.from(allFactions).sort();

    let html = `
      <div class="war-section war-section-relations">
        <h3>Faction Relations</h3>
        <div class="relations-matrix">
          <table class="relations-table">
            <thead>
              <tr>
                <th>Faction</th>
                ${factionArray.map(f => `<th>${f}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
    `;

    factionArray.forEach(factionA => {
      html += `<tr><td><strong>${factionA}</strong></td>`;
      factionArray.forEach(factionB => {
        if (factionA === factionB) {
          html += `<td class="relation-self">—</td>`;
        } else {
          const relations = this.controller.getFactionRelations(factionA);
          const relation = relations[factionB] || 'neutral';
          const relationClass = relation === 'war' ? 'relation-war' : relation === 'peace_treaty' ? 'relation-peace' : 'relation-neutral';
          html += `<td class="${relationClass}">${relation}</td>`;
        }
      });
      html += `</tr>`;
    });

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;
    return html;
  }

  /**
   * Build casualty report section
   */
  _buildCasualtiesSection() {
    const casualtiesByFaction = this.controller.state.get('casualtiesByFaction') || {};
    const factionIds = Object.keys(casualtiesByFaction).sort();

    let html = `
      <div class="war-section war-section-casualties">
        <h3>Casualty Report</h3>
        ${factionIds.length === 0 ? '<p class="empty-message">No casualties reported</p>' : ''}
        <div class="casualties-list">
          <table class="casualties-table">
            <thead>
              <tr>
                <th>Faction</th>
                <th>Ships Lost</th>
                <th>Ground Forces</th>
                <th>Economic Loss</th>
              </tr>
            </thead>
            <tbody>
    `;

    factionIds.forEach(factionId => {
      const cas = casualtiesByFaction[factionId];
      html += `
        <tr>
          <td><strong>${factionId}</strong></td>
          <td>${cas.ships}</td>
          <td>${cas.ground}</td>
          <td>${cas.economy}</td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;
    return html;
  }

  /**
   * Attach event handlers to buttons and inputs
   */
  _attachEventHandlers() {
    // Declare war button
    const declareBtn = this.container.querySelector('#btn-declare-war');
    if (declareBtn) {
      declareBtn.addEventListener('click', () => this._handleDeclareWar());
    }

    // Negotiate peace button
    const negotiateBtn = this.container.querySelector('#btn-negotiate-peace');
    if (negotiateBtn) {
      negotiateBtn.addEventListener('click', () => this._handleNegotiatePeace());
    }

    // Peace negotiation buttons per conflict
    this.container.querySelectorAll('[id^="btn-peace-"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const conflictId = e.target.dataset.conflictId;
        const conflict = this.controller.getConflict(conflictId);
        if (conflict) {
          try {
            this.controller.signPeaceTreaty(conflict.factionA, conflict.factionB);
          } catch (err) {
            this._handleError(err);
          }
        }
      });
    });

    // Save button
    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          this._showStatus('✅ War state saved', 2000);
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
      case 'conflict-declared':
        this._rerenderSection('conflicts');
        this._rerenderSection('relations');
        break;
      case 'peace-signed':
        this._rerenderSection('conflicts');
        this._rerenderSection('treaties');
        this._rerenderSection('relations');
        break;
      case 'war-goal-added':
        this._rerenderSection('goals');
        break;
      case 'locked':
      case 'unlocked':
        this._updateControlsState();
        break;
    }
  }

  /**
   * Handle declare war action
   */
  _handleDeclareWar() {
    // Simplified: would be form modal in production
    const factionA = prompt('Attacking faction:', 'PlayerFaction');
    if (!factionA) return;

    const factionB = prompt('Defending faction:', 'NPCFaction');
    if (!factionB) return;

    const reason = prompt('War reason:', 'Territorial dispute');
    if (reason === null) return;

    try {
      this.controller.declareWar(factionA, factionB, reason);
    } catch (err) {
      this._handleError(err);
    }
  }

  /**
   * Handle negotiate peace action
   */
  _handleNegotiatePeace() {
    const activeConflicts = this.controller.getActiveConflicts();
    if (activeConflicts.length === 0) {
      this._showStatus('No active conflicts to negotiate', 2000);
      return;
    }

    // Simplified: would be form modal in production
    const conflictIdx = prompt(`Select conflict (0-${activeConflicts.length - 1}):`, '0');
    if (conflictIdx === null) return;

    const conflict = activeConflicts[parseInt(conflictIdx)];
    if (conflict) {
      try {
        this.controller.signPeaceTreaty(conflict.factionA, conflict.factionB);
      } catch (err) {
        this._handleError(err);
      }
    }
  }

  /**
   * Update control states based on lock status
   */
  _updateControlsState() {
    const isLocked = this.controller.state.get('isLocked');
    this.container.querySelectorAll('button').forEach(btn => {
      btn.disabled = isLocked;
    });
  }

  /**
   * Show status message
   */
  _showStatus(message, duration = 3000) {
    const statusEl = this.container.querySelector('#war-status');
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
