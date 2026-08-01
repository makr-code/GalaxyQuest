/**
 * EspionageUI - Spy network and operations display
 */

export class EspionageUI {
  constructor(espionageController, domTarget) {
    this.controller = espionageController;
    this.container = domTarget;

    if (domTarget) this.render();
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = this._buildHtml();
    this._attachEventHandlers();
  }

  _buildHtml() {
    return `
      <div class="espionage-panel">
        <h2>🕵️ Espionage</h2>
        ${this._buildSpiesSection()}
        ${this._buildIntelligenceSection()}
        ${this._buildOperationsSection()}
        <button class="btn-save" id="btn-save">💾 Save</button>
      </div>
    `;
  }

  _buildSpiesSection() {
    const spies = this.controller.getFactionSpies('player_faction');
    let html = `<div class="spies"><h3>Active Spies (${spies.length})</h3><ul>`;

    if (spies.length === 0) {
      html += `<li>No active spies</li>`;
    } else {
      spies.forEach(spy => {
        const status = spy.status === 'active' ? '✅' : '❌';
        html += `<li>${status} ${spy.name} → ${spy.targetFaction} (Skill: ${Math.round(spy.skill)})</li>`;
      });
    }

    html += `</ul></div>`;
    return html;
  }

  _buildIntelligenceSection() {
    const intel = this.controller.getFactionIntelligence('player_faction');
    let html = `<div class="intelligence"><h3>Intelligence Reports (${intel.length})</h3><ul>`;

    if (intel.length === 0) {
      html += `<li>No intelligence gathered</li>`;
    } else {
      intel.forEach(i => {
        const discovered = i.discovered ? '🚨 COMPROMISED' : '✅';
        html += `<li>${discovered} ${i.type} from ${i.target} (${Math.round(i.reliability)}% reliable)</li>`;
      });
    }

    html += `</ul></div>`;
    return html;
  }

  _buildOperationsSection() {
    const operations = this.controller.getOperations();
    let html = `<div class="operations"><h3>Sabotage Operations (${operations.length})</h3><ul>`;

    if (operations.length === 0) {
      html += `<li>No active operations</li>`;
    } else {
      operations.forEach(op => {
        const statusEmoji = op.status === 'active' ? '🔄' : '✅';
        html += `<li>${statusEmoji} ${op.targetType} vs ${op.target} (${op.progress}%)</li>`;
      });
    }

    html += `</ul></div>`;
    return html;
  }

  _attachEventHandlers() {
    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          alert('✅ Espionage saved');
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    }
  }

  handleStateChange(change) {
    if (['spy-deployed', 'intelligence-gathered', 'sabotage-launched'].includes(change.type)) {
      this.render();
    }
  }
}
