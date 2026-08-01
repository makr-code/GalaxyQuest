/**
 * FleetUI - Rendering layer for fleet domain
 * 
 * Responsibility: DOM rendering, user interaction handlers
 * Not responsible for: Business logic, state validation
 * 
 * Pattern: Callback-based (controller notifies UI of changes)
 */

class FleetUI {
  constructor(controller, domTarget) {
    this.controller = controller;
    this.target = domTarget;
    this.state = {};
    this.selectedFleetId = null;

    // Listen to controller state changes
    this.controller.onStateChange((change) => {
      this._handleStateChange(change);
    });

    // Listen to errors
    this.controller.onError((error) => {
      this._handleError(error);
    });

    // Initial render
    this.render();
  }

  /**
   * Render entire fleet panel
   */
  render() {
    this.state = this.controller.getState();
    this.target.innerHTML = this._buildHtml();
    this._attachEventHandlers();
  }

  /**
   * Re-render specific section
   * @private
   */
  _rerenderSection(section) {
    const sectionEl = this.target.querySelector(`[data-section="${section}"]`);
    if (!sectionEl) return;

    switch (section) {
      case 'fleet-list':
        sectionEl.innerHTML = this._buildFleetListSection();
        break;
      case 'fleet-details':
        sectionEl.innerHTML = this._buildFleetDetailsSection();
        break;
      case 'ships':
        sectionEl.innerHTML = this._buildShipsSection();
        break;
    }

    this._attachEventHandlers();
  }

  // Private methods

  /**
   * Build complete HTML structure
   * @private
   */
  _buildHtml() {
    return `
      <div class="fleet-panel">
        <header class="fleet-panel__header">
          <h2>Fleet Management</h2>
          <span class="fleet-panel__stats">
            Total Ships: <strong>${this.state.totalShips}</strong> | 
            Total Strength: <strong>${Math.round(this.state.totalStrength)}</strong>
          </span>
        </header>

        <div class="fleet-panel__tabs">
          <button class="tab-button tab-button--fleets active" data-tab="fleets">
            Fleets
          </button>
          <button class="tab-button tab-button--ships" data-tab="ships">
            Ships
          </button>
          <button class="tab-button tab-button--formations" data-tab="formations">
            Formations
          </button>
        </div>

        <div class="fleet-panel__content">
          <div data-section="fleet-list" class="fleet-section fleet-section--list">
            ${this._buildFleetListSection()}
          </div>

          <div data-section="fleet-details" class="fleet-section fleet-section--details">
            ${this._buildFleetDetailsSection()}
          </div>

          <div data-section="ships" class="fleet-section fleet-section--ships">
            ${this._buildShipsSection()}
          </div>
        </div>

        <footer class="fleet-panel__footer">
          <button class="btn btn-primary" data-action="create-fleet">
            + New Fleet
          </button>
          <button class="btn btn-secondary" data-action="save">
            Save
          </button>
        </footer>
      </div>
    `;
  }

  /**
   * Build fleet list section
   * @private
   */
  _buildFleetListSection() {
    const fleets = this.state.fleets || {};
    const fleetList = Object.values(fleets);

    if (fleetList.length === 0) {
      return '<p class="empty-state">No fleets. Create one to get started.</p>';
    }

    return `
      <table class="fleet-table">
        <thead>
          <tr>
            <th>Fleet Name</th>
            <th>Ships</th>
            <th>Strength</th>
            <th>Formation</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${fleetList.map(fleet => `
            <tr class="fleet-row ${this.selectedFleetId === fleet.id ? 'selected' : ''}">
              <td>
                <button class="fleet-name" data-fleet-id="${fleet.id}">
                  ${fleet.name}
                </button>
              </td>
              <td>${fleet.ships.length}</td>
              <td>${Math.round(this.controller.calculateFleetStrength(fleet.id))}</td>
              <td>${fleet.formation}</td>
              <td>
                <button class="btn-icon" data-action="edit-fleet" data-fleet-id="${fleet.id}">
                  ✎
                </button>
                <button class="btn-icon" data-action="delete-fleet" data-fleet-id="${fleet.id}">
                  🗑
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  /**
   * Build fleet details section
   * @private
   */
  _buildFleetDetailsSection() {
    if (!this.selectedFleetId) {
      return '<p class="empty-state">Select a fleet to view details.</p>';
    }

    try {
      const fleet = this.controller.getFleet(this.selectedFleetId);

      return `
        <div class="fleet-details">
          <h3>${fleet.name}</h3>
          
          <div class="detail-grid">
            <div class="detail-item">
              <label>Formation</label>
              <select data-action="change-formation" data-fleet-id="${fleet.id}">
                <option value="line" ${fleet.formation === 'line' ? 'selected' : ''}>Line</option>
                <option value="wedge" ${fleet.formation === 'wedge' ? 'selected' : ''}>Wedge</option>
                <option value="sphere" ${fleet.formation === 'sphere' ? 'selected' : ''}>Sphere</option>
                <option value="box" ${fleet.formation === 'box' ? 'selected' : ''}>Box</option>
                <option value="scattered" ${fleet.formation === 'scattered' ? 'selected' : ''}>Scattered</option>
              </select>
            </div>

            <div class="detail-item">
              <label>Total Strength</label>
              <strong>${Math.round(this.controller.calculateFleetStrength(this.selectedFleetId))}</strong>
            </div>

            <div class="detail-item">
              <label>Ships</label>
              <strong>${fleet.ships.length}</strong>
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      return `<p class="error-state">Error loading fleet: ${error.message}</p>`;
    }
  }

  /**
   * Build ships section
   * @private
   */
  _buildShipsSection() {
    if (!this.selectedFleetId) {
      return '<p class="empty-state">Select a fleet to view ships.</p>';
    }

    try {
      const fleet = this.controller.getFleet(this.selectedFleetId);
      const ships = fleet.ships || [];

      if (ships.length === 0) {
        return `
          <p class="empty-state">No ships in this fleet.</p>
          <button class="btn btn-primary" data-action="add-ship" data-fleet-id="${fleet.id}">
            + Add Ship
          </button>
        `;
      }

      return `
        <div class="ships-list">
          <table class="ships-table">
            <thead>
              <tr>
                <th>Ship</th>
                <th>Class</th>
                <th>Status</th>
                <th>Health</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${ships.map(ship => `
                <tr class="ship-row">
                  <td>${ship.type || 'Unknown'}</td>
                  <td>${ship.class}</td>
                  <td>
                    <span class="status status--${ship.status}">
                      ${ship.status}
                    </span>
                  </td>
                  <td>
                    <div class="health-bar">
                      <div class="health-fill" style="width: ${ship.health || 100}%"></div>
                    </div>
                    ${ship.health || 100}%
                  </td>
                  <td>
                    <button class="btn-icon" data-action="remove-ship" 
                      data-fleet-id="${fleet.id}" data-ship-id="${ship.id}">
                      🗑
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <button class="btn btn-primary" data-action="add-ship" data-fleet-id="${fleet.id}">
            + Add Ship
          </button>
        </div>
      `;
    } catch (error) {
      return `<p class="error-state">Error loading ships: ${error.message}</p>`;
    }
  }

  /**
   * Attach event handlers to DOM
   * @private
   */
  _attachEventHandlers() {
    // Fleet selection
    this.target.querySelectorAll('.fleet-name').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.selectedFleetId = e.target.dataset.fleetId;
        this._rerenderSection('fleet-details');
        this._rerenderSection('ships');
      });
    });

    // Formation change
    this.target.querySelectorAll('[data-action="change-formation"]').forEach(select => {
      select.addEventListener('change', (e) => {
        try {
          this.controller.setFormation(
            e.target.dataset.fleetId,
            e.target.value
          );
        } catch (error) {
          this._handleError(error);
        }
      });
    });

    // Remove ship
    this.target.querySelectorAll('[data-action="remove-ship"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        try {
          this.controller.removeShip(
            e.target.dataset.fleetId,
            e.target.dataset.shipId
          );
        } catch (error) {
          this._handleError(error);
        }
      });
    });

    // Add ship
    this.target.querySelectorAll('[data-action="add-ship"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const fleetId = e.target.dataset.fleetId;
        try {
          this.controller.addShip(fleetId, {
            type: 'Corvette',
            class: 'corvette',
            status: 'active',
            health: 100
          });
          this._showNotification('Ship added!', 'success');
        } catch (error) {
          this._handleError(error);
        }
      });
    });

    // Save button
    this.target.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
      try {
        await this.controller.save();
        this._showNotification('Fleet saved!', 'success');
      } catch (error) {
        this._handleError(error);
      }
    });

    // Create fleet button
    this.target.querySelector('[data-action="create-fleet"]')?.addEventListener('click', () => {
      try {
        const fleetId = this.controller.createFleet({
          name: `Fleet ${Date.now()}`,
          colonyId: 'colony_1',
          ships: [
            { type: 'Fighter', class: 'fighter', health: 100 },
            { type: 'Corvette', class: 'corvette', health: 100 }
          ]
        });
        this.selectedFleetId = fleetId;
        this._showNotification('Fleet created!', 'success');
        this.render();
      } catch (error) {
        this._handleError(error);
      }
    });
  }

  /**
   * Handle state changes
   * @private
   */
  _handleStateChange(change) {
    const { path } = change;

    if (path === 'fleets') {
      this._rerenderSection('fleet-list');
    } else if (path === 'totalShips' || path === 'totalStrength') {
      // Update header stats
      const header = this.target.querySelector('.fleet-panel__stats');
      if (header) {
        header.innerHTML = `
          Total Ships: <strong>${this.state.totalShips}</strong> | 
          Total Strength: <strong>${Math.round(this.state.totalStrength)}</strong>
        `;
      }
    }
  }

  /**
   * Handle error display
   * @private
   */
  _handleError(error) {
    console.error('[FleetUI] Error:', error);
    this._showNotification(error.message, 'error');
  }

  /**
   * Show notification
   * @private
   */
  _showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification--${type}`;
    notification.textContent = message;

    this.target.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
  }
}

export default FleetUI;
