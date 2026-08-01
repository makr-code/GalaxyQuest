/**
 * EconomyUI - Rendering layer for economy domain
 * 
 * Responsibility: Render UI, handle user interactions, trigger controller actions
 * Not responsible for: Business logic, state validation, persistence
 * 
 * Pattern: Callback-based (no direct controller state access)
 */

class EconomyUI {
  constructor(controller, domTarget) {
    this.controller = controller;
    this.target = domTarget;
    this.state = {};

    // Listen to controller state changes
    this.controller.onStateChange((change) => {
      this._handleStateChange(change);
    });

    // Listen to controller errors
    this.controller.onError((error) => {
      this._handleError(error);
    });

    // Initial render
    this.render();
  }

  /**
   * Render entire economy panel
   */
  render() {
    this.state = this.controller.getState();
    this.target.innerHTML = this._buildHtml();
    this._attachEventHandlers();
  }

  /**
   * Re-render specific section (optimized)
   * @private
   */
  _rerenderSection(section) {
    const sectionEl = this.target.querySelector(`[data-section="${section}"]`);
    if (!sectionEl) return;

    switch (section) {
      case 'tax':
        sectionEl.innerHTML = this._buildTaxSection();
        break;
      case 'subsidy':
        sectionEl.innerHTML = this._buildSubsidySection();
        break;
      case 'demands':
        sectionEl.innerHTML = this._buildDemandsSection();
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
      <div class="economy-panel">
        <header class="economy-panel__header">
          <h2>Economy</h2>
          <span class="economy-panel__status ${this.state.isLocked ? 'locked' : 'active'}">
            ${this.state.isLocked ? 'Locked' : 'Active'}
          </span>
        </header>

        <div class="economy-panel__tabs">
          <button 
            class="tab-button tab-button--overview ${this.state._activeTab === 'overview' ? 'active' : ''}"
            data-tab="overview"
          >
            Overview
          </button>
          <button 
            class="tab-button tab-button--taxes ${this.state._activeTab === 'taxes' ? 'active' : ''}"
            data-tab="taxes"
          >
            Taxes
          </button>
          <button 
            class="tab-button tab-button--demands ${this.state._activeTab === 'demands' ? 'active' : ''}"
            data-tab="demands"
          >
            Demands
          </button>
        </div>

        <div class="economy-panel__content">
          <div data-section="tax" class="economy-section economy-section--tax">
            ${this._buildTaxSection()}
          </div>

          <div data-section="subsidy" class="economy-section economy-section--subsidy">
            ${this._buildSubsidySection()}
          </div>

          <div data-section="demands" class="economy-section economy-section--demands">
            ${this._buildDemandsSection()}
          </div>
        </div>

        <footer class="economy-panel__footer">
          <small>Last modified: ${this.state.lastModified || 'Never'}</small>
          <button 
            class="btn btn-primary" 
            data-action="save"
            ${!this.state.isDirty ? 'disabled' : ''}
          >
            Save Changes
          </button>
        </footer>
      </div>
    `;
  }

  /**
   * Build tax section HTML
   * @private
   */
  _buildTaxSection() {
    const rate = this.state.taxRate;

    return `
      <div class="economy-control">
        <label for="tax-slider">Tax Rate: <strong>${rate}%</strong></label>
        <input 
          id="tax-slider"
          type="range" 
          min="0" 
          max="100" 
          value="${rate}"
          step="1"
          class="slider"
          data-control="tax"
          ${this.state.isLocked ? 'disabled' : ''}
        />
        <div class="slider-labels">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    `;
  }

  /**
   * Build subsidy section HTML
   * @private
   */
  _buildSubsidySection() {
    const rate = this.state.subsidyRate;

    return `
      <div class="economy-control">
        <label for="subsidy-slider">Subsidy Rate: <strong>${rate}%</strong></label>
        <input 
          id="subsidy-slider"
          type="range" 
          min="0" 
          max="100" 
          value="${rate}"
          step="1"
          class="slider"
          data-control="subsidy"
          ${this.state.isLocked ? 'disabled' : ''}
        />
        <div class="slider-labels">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    `;
  }

  /**
   * Build demands section HTML
   * @private
   */
  _buildDemandsSection() {
    const demands = this.state.demands || {};

    return `
      <div class="economy-demands">
        <table class="demands-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Demand</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            ${['food', 'minerals', 'energy', 'credit']
              .map(resource => `
                <tr>
                  <td>${this._capitalizeResource(resource)}</td>
                  <td>${demands[resource] || 0}</td>
                  <td><span class="trend trend--${Math.random() > 0.5 ? 'up' : 'down'}">
                    ${Math.random() > 0.5 ? '↑' : '↓'}
                  </span></td>
                </tr>
              `)
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Attach event handlers to DOM
   * @private
   */
  _attachEventHandlers() {
    // Tax slider
    const taxSlider = this.target.querySelector('[data-control="tax"]');
    if (taxSlider) {
      taxSlider.addEventListener('input', (e) => {
        try {
          this.controller.setTaxRate(Number(e.target.value));
        } catch (error) {
          this._handleError(error);
        }
      });
    }

    // Subsidy slider
    const subsidySlider = this.target.querySelector('[data-control="subsidy"]');
    if (subsidySlider) {
      subsidySlider.addEventListener('input', (e) => {
        try {
          this.controller.setSubsidyRate(Number(e.target.value));
        } catch (error) {
          this._handleError(error);
        }
      });
    }

    // Tab buttons
    this.target.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.state._activeTab = e.target.dataset.tab;
        this.render();
      });
    });

    // Save button
    const saveBtn = this.target.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          this._showNotification('Economy saved successfully', 'success');
        } catch (error) {
          this._handleError(error);
        }
      });
    }
  }

  /**
   * Handle state change from controller
   * @private
   */
  _handleStateChange(change) {
    const { path, newValue, oldValue } = change;

    // Update local state cache
    this.state[path] = newValue;

    // Re-render affected section
    if (path === 'taxRate') {
      this._rerenderSection('tax');
    } else if (path === 'subsidyRate') {
      this._rerenderSection('subsidy');
    } else if (path === 'demands') {
      this._rerenderSection('demands');
    }
  }

  /**
   * Handle error from controller
   * @private
   */
  _handleError(error) {
    console.error('[EconomyUI] Error:', error);
    this._showNotification(error.message, 'error');
  }

  /**
   * Show user-facing notification
   * @private
   */
  _showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification--${type}`;
    notification.textContent = message;

    this.target.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  /**
   * Capitalize resource name for display
   * @private
   */
  _capitalizeResource(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
}

export default EconomyUI;
