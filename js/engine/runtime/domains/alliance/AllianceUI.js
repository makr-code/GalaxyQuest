/**
 * AllianceUI - Renders alliance information and member management
 */

export class AllianceUI {
  constructor(allianceController, domTarget) {
    this.controller = allianceController;
    this.container = domTarget;
    this.state = { selectedAllianceId: null };

    if (domTarget) {
      this.render();
    }

    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = this._buildHtml();
    this._attachEventHandlers();
  }

  _rerenderSection(sectionName) {
    if (!this.container) return;
    const section = this.container.querySelector(`.alliance-section-${sectionName}`);
    if (!section) return;

    let html = '';
    switch (sectionName) {
      case 'list':
        html = this._buildListSection();
        break;
      case 'details':
        html = this._buildDetailsSection();
        break;
    }

    section.innerHTML = html;
    this._attachEventHandlers();
  }

  _buildHtml() {
    return `
      <div class="alliance-panel">
        <div class="alliance-header">
          <h2>🏛️ Alliances</h2>
        </div>

        ${this._buildListSection()}
        ${this._buildDetailsSection()}

        <div class="alliance-footer">
          <button class="alliance-btn-create" id="btn-create">✨ Create Alliance</button>
          <button class="alliance-btn-save" id="btn-save">💾 Save</button>
        </div>
      </div>
    `;
  }

  _buildListSection() {
    const alliances = this.controller.getAllAlliances();

    let html = `
      <div class="alliance-section alliance-section-list">
        <h3>Alliances (${alliances.length})</h3>
        <div class="alliance-list">
    `;

    alliances.forEach(alliance => {
      const isSelected = this.state.selectedAllianceId === alliance.id;
      html += `
        <div class="alliance-card ${isSelected ? 'selected' : ''}" data-alliance-id="${alliance.id}">
          <div class="alliance-name">${alliance.name}</div>
          <div class="alliance-info">
            <span>👥 ${alliance.members.length} members</span>
            <span>💰 ${alliance.treasury.credits}</span>
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

  _buildDetailsSection() {
    if (!this.state.selectedAllianceId) {
      return `
        <div class="alliance-section alliance-section-details">
          <p class="empty-message">Select an alliance to view details</p>
        </div>
      `;
    }

    const alliance = this.controller.getAlliance(this.state.selectedAllianceId);
    if (!alliance) {
      return `
        <div class="alliance-section alliance-section-details">
          <p class="error-message">Alliance not found</p>
        </div>
      `;
    }

    return `
      <div class="alliance-section alliance-section-details">
        <h3>${alliance.name}</h3>
        <div class="details">
          <p><strong>Leader:</strong> ${alliance.leader}</p>
          <p><strong>Members (${alliance.members.length}):</strong></p>
          <ul>
            ${alliance.members.map(m => `<li>${m}</li>`).join('')}
          </ul>
          <p><strong>Treasury:</strong></p>
          <ul>
            <li>💰 ${alliance.treasury.credits}</li>
            <li>⛏️ ${alliance.treasury.minerals}</li>
            <li>⚡ ${alliance.treasury.energy}</li>
          </ul>
        </div>
      </div>
    `;
  }

  _attachEventHandlers() {
    this.container.querySelectorAll('.alliance-card').forEach(card => {
      card.addEventListener('click', () => {
        this.state.selectedAllianceId = card.dataset.allianceId;
        this.container.querySelectorAll('.alliance-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this._rerenderSection('details');
      });
    });

    const createBtn = this.container.querySelector('#btn-create');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        const name = prompt('Alliance name:');
        if (name) {
          try {
            this.controller.createAlliance(name, 'player_faction');
            this._rerenderSection('list');
          } catch (err) {
            alert(`Error: ${err.message}`);
          }
        }
      });
    }

    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          alert('✅ Alliances saved');
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    }
  }

  handleStateChange(change) {
    if (change.type === 'alliance-created') {
      this._rerenderSection('list');
    }
  }
}
