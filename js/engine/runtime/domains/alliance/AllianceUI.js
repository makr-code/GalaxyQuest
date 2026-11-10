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
    this.container.replaceChildren(this._buildHtml());
    this._attachEventHandlers();
  }

  _rerenderSection(sectionName) {
    if (!this.container) return;
    const section = this.container.querySelector(`.alliance-section-${sectionName}`);
    if (!section) return;

    let updatedSection = null;
    switch (sectionName) {
      case 'list':
        updatedSection = this._buildListSection();
        break;
      case 'details':
        updatedSection = this._buildDetailsSection();
        break;
    }

    if (!updatedSection) return;
    section.replaceWith(updatedSection);
  }

  _buildHtml() {
    const doc = this.container.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'alliance-panel';

    const header = doc.createElement('div');
    header.className = 'alliance-header';
    const title = doc.createElement('h2');
    title.textContent = '🏛️ Alliances';
    header.append(title);

    const footer = doc.createElement('div');
    footer.className = 'alliance-footer';

    const createButton = doc.createElement('button');
    createButton.className = 'alliance-btn-create';
    createButton.id = 'btn-create';
    createButton.textContent = '✨ Create Alliance';

    const saveButton = doc.createElement('button');
    saveButton.className = 'alliance-btn-save';
    saveButton.id = 'btn-save';
    saveButton.textContent = '💾 Save';
    footer.append(createButton, saveButton);

    panel.append(header, this._buildListSection(), this._buildDetailsSection(), footer);
    return panel;
  }

  _buildListSection() {
    const doc = this.container.ownerDocument;
    const alliances = this.controller.getAllAlliances();
    const section = doc.createElement('div');
    section.className = 'alliance-section alliance-section-list';

    const heading = doc.createElement('h3');
    heading.textContent = `Alliances (${alliances.length})`;
    const list = doc.createElement('div');
    list.className = 'alliance-list';
    section.append(heading, list);

    alliances.forEach(alliance => {
      const allianceId = String(alliance.id ?? '');
      const members = Array.isArray(alliance.members) ? alliance.members : [];
      const treasury = alliance.treasury ?? {};
      const card = doc.createElement('div');
      card.className = `alliance-card${this.state.selectedAllianceId === allianceId ? ' selected' : ''}`;

      const name = doc.createElement('div');
      name.className = 'alliance-name';
      name.textContent = String(alliance.name ?? '');

      const info = doc.createElement('div');
      info.className = 'alliance-info';
      const memberCount = doc.createElement('span');
      memberCount.textContent = `👥 ${members.length} members`;
      const credits = doc.createElement('span');
      credits.textContent = `💰 ${String(treasury.credits ?? '')}`;
      info.append(memberCount, credits);
      card.append(name, info);

      card.addEventListener('click', () => {
        this.state.selectedAllianceId = allianceId;
        this.container.querySelectorAll('.alliance-card').forEach(item => item.classList.remove('selected'));
        card.classList.add('selected');
        this._rerenderSection('details');
      });
      list.append(card);
    });

    return section;
  }

  _buildDetailsSection() {
    const doc = this.container.ownerDocument;
    const section = doc.createElement('div');
    section.className = 'alliance-section alliance-section-details';

    if (!this.state.selectedAllianceId) {
      const emptyMessage = doc.createElement('p');
      emptyMessage.className = 'empty-message';
      emptyMessage.textContent = 'Select an alliance to view details';
      section.append(emptyMessage);
      return section;
    }

    const alliance = this.controller.getAlliance(this.state.selectedAllianceId);
    if (!alliance) {
      const errorMessage = doc.createElement('p');
      errorMessage.className = 'error-message';
      errorMessage.textContent = 'Alliance not found';
      section.append(errorMessage);
      return section;
    }

    const members = Array.isArray(alliance.members) ? alliance.members : [];
    const treasury = alliance.treasury ?? {};
    const heading = doc.createElement('h3');
    heading.textContent = String(alliance.name ?? '');

    const details = doc.createElement('div');
    details.className = 'details';
    const leader = doc.createElement('p');
    const leaderLabel = doc.createElement('strong');
    leaderLabel.textContent = 'Leader:';
    leader.append(leaderLabel, ` ${String(alliance.leader ?? '')}`);

    const membersLabel = doc.createElement('p');
    const membersHeading = doc.createElement('strong');
    membersHeading.textContent = `Members (${members.length}):`;
    membersLabel.append(membersHeading);

    const memberList = doc.createElement('ul');
    members.forEach(member => {
      const item = doc.createElement('li');
      item.textContent = String(member ?? '');
      memberList.append(item);
    });

    const treasuryLabel = doc.createElement('p');
    const treasuryHeading = doc.createElement('strong');
    treasuryHeading.textContent = 'Treasury:';
    treasuryLabel.append(treasuryHeading);

    const treasuryList = doc.createElement('ul');
    [
      ['💰', treasury.credits],
      ['⛏️', treasury.minerals],
      ['⚡', treasury.energy],
    ].forEach(([icon, amount]) => {
      const item = doc.createElement('li');
      item.textContent = `${icon} ${String(amount ?? '')}`;
      treasuryList.append(item);
    });

    details.append(leader, membersLabel, memberList, treasuryLabel, treasuryList);
    section.append(heading, details);
    return section;
  }

  _attachEventHandlers() {
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
