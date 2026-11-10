/**
 * ColonizationUI - Renders colonies and colonization panel
 * Responsible for: UI rendering only (no business logic)
 * Uses: ColonizationController for all state changes
 */

const COLONY_STATUSES = new Set(['active', 'growing', 'struggling', 'abandoned']);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return finiteNumber(value).toLocaleString();
}

export class ColonizationUI {
  constructor(colonizationController, domTarget) {
    this.controller = colonizationController;
    this.domTarget = domTarget;
    this.state = {
      selectedColonyId: null,
    };

    if (domTarget) {
      this.container = domTarget;
      this.render();
    }

    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  render() {
    if (!this.container) return;
    this.container.replaceChildren(this._buildHtml());
  }

  _rerenderSection(sectionName) {
    if (!this.container) return;

    const section = this.container.querySelector(`.colonization-section-${sectionName}`);
    if (!section) return;

    let updatedSection = null;
    switch (sectionName) {
      case 'overview':
        updatedSection = this._buildOverviewSection();
        break;
      case 'colonies':
        updatedSection = this._buildColoniesSection();
        break;
      case 'details':
        updatedSection = this._buildDetailsSection();
        break;
    }

    if (updatedSection) section.replaceWith(updatedSection);
  }

  _buildHtml() {
    const doc = this.container.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'colonization-panel';

    const header = doc.createElement('div');
    header.className = 'colonization-header';
    const title = doc.createElement('h2');
    title.textContent = '🏗️ Colonization';
    header.append(title);

    const footer = doc.createElement('div');
    footer.className = 'colonization-footer';
    const saveButton = doc.createElement('button');
    saveButton.className = 'colonization-btn-save';
    saveButton.id = 'btn-save';
    saveButton.textContent = '💾 Save';
    saveButton.addEventListener('click', async () => {
      try {
        await this.controller.save();
        this._showStatus('✅ Colony state saved', 2000);
      } catch (error) {
        this._handleError(error);
      }
    });

    const status = doc.createElement('span');
    status.className = 'colonization-status';
    status.id = 'colonization-status';
    footer.append(saveButton, status);

    panel.append(
      header,
      this._buildOverviewSection(),
      this._buildColoniesSection(),
      this._buildDetailsSection(),
      footer,
    );
    return panel;
  }

  _buildOverviewSection() {
    const doc = this.container.ownerDocument;
    const section = doc.createElement('div');
    section.className = 'colonization-section colonization-section-overview';

    const stats = doc.createElement('div');
    stats.className = 'overview-stats';
    [
      ['Total Population', formatNumber(this.controller.state.get('totalPopulation'))],
      ['Colonies', formatNumber(this.controller.state.get('totalColonies'))],
    ].forEach(([label, value]) => {
      const card = doc.createElement('div');
      card.className = 'stat-card';
      const statLabel = doc.createElement('span');
      statLabel.className = 'stat-label';
      statLabel.textContent = label;
      const statValue = doc.createElement('span');
      statValue.className = 'stat-value';
      statValue.textContent = value;
      card.append(statLabel, statValue);
      stats.append(card);
    });

    section.append(stats);
    return section;
  }

  _buildColoniesSection() {
    const doc = this.container.ownerDocument;
    const colonies = this.controller.getAllColonies();
    const section = doc.createElement('div');
    section.className = 'colonization-section colonization-section-colonies';

    const heading = doc.createElement('h3');
    heading.textContent = `Colonies (${colonies.length})`;
    const list = doc.createElement('div');
    list.className = 'colonies-list';
    section.append(heading, list);

    if (colonies.length === 0) {
      const emptyMessage = doc.createElement('p');
      emptyMessage.className = 'empty-message';
      emptyMessage.textContent = 'No colonies yet. Colonize a planet to begin.';
      section.insertBefore(emptyMessage, list);
      return section;
    }

    colonies.forEach(colony => {
      const colonyId = String(colony.id ?? '');
      const population = finiteNumber(colony.population);
      const populationCap = finiteNumber(colony.populationCap);
      const growth = populationCap > 0
        ? Math.min(100, Math.max(0, population / populationCap * 100))
        : 0;
      const resources = colony.resources ?? {};
      const status = COLONY_STATUSES.has(colony.status) ? colony.status : 'unknown';

      const card = doc.createElement('div');
      card.className = `colony-card${this.state.selectedColonyId === colonyId ? ' selected' : ''}`;
      card.addEventListener('click', () => {
        this.state.selectedColonyId = colonyId;
        this.container.querySelectorAll('.colony-card').forEach(item => item.classList.remove('selected'));
        card.classList.add('selected');
        this._rerenderSection('details');
      });

      const colonyHeader = doc.createElement('div');
      colonyHeader.className = 'colony-header';
      const name = doc.createElement('span');
      name.className = 'colony-name';
      name.textContent = String(colony.name ?? '');
      const statusLabel = doc.createElement('span');
      statusLabel.className = `colony-status status-${status}`;
      statusLabel.textContent = status;
      colonyHeader.append(name, statusLabel);

      const stats = doc.createElement('div');
      stats.className = 'colony-stats';
      const populationLabel = doc.createElement('span');
      populationLabel.textContent = `👥 ${formatNumber(population)} / ${formatNumber(populationCap)}`;
      const populationBar = doc.createElement('div');
      populationBar.className = 'population-bar';
      const populationFill = doc.createElement('div');
      populationFill.className = 'population-fill';
      populationFill.style.width = `${growth}%`;
      populationBar.append(populationFill);
      stats.append(populationLabel, populationBar);

      const resourceSummary = doc.createElement('div');
      resourceSummary.className = 'colony-resources';
      [
        ['💰', resources.credits],
        ['⛏️', resources.minerals],
        ['⚡', resources.energy],
        ['🌾', resources.food],
      ].forEach(([icon, amount]) => {
        const resource = doc.createElement('span');
        resource.textContent = `${icon} ${formatNumber(amount)}`;
        resourceSummary.append(resource);
      });

      card.append(colonyHeader, stats, resourceSummary);
      list.append(card);
    });

    return section;
  }

  _buildDetailsSection() {
    const doc = this.container.ownerDocument;
    const section = doc.createElement('div');
    section.className = 'colonization-section colonization-section-details';

    if (!this.state.selectedColonyId) {
      const emptyMessage = doc.createElement('p');
      emptyMessage.className = 'empty-message';
      emptyMessage.textContent = 'Select a colony to view details';
      section.append(emptyMessage);
      return section;
    }

    const colony = this.controller.getColony(this.state.selectedColonyId);
    if (!colony) {
      const errorMessage = doc.createElement('p');
      errorMessage.className = 'error-message';
      errorMessage.textContent = 'Colony not found';
      section.append(errorMessage);
      return section;
    }

    const buildingTypes = this.controller.state.get('buildingTypes') ?? {};
    const buildings = colony.buildings ?? {};
    const resources = colony.resources ?? {};
    const detailsGrid = doc.createElement('div');
    detailsGrid.className = 'details-grid';

    const heading = doc.createElement('h3');
    heading.textContent = `Colony Details: ${String(colony.name ?? '')}`;
    section.append(heading, detailsGrid);

    const populationSection = doc.createElement('div');
    populationSection.className = 'details-section';
    const populationHeading = doc.createElement('h4');
    populationHeading.textContent = 'Population';
    populationSection.append(
      populationHeading,
      this._createParagraph(doc, `Current: ${formatNumber(colony.population)}`),
      this._createParagraph(doc, `Capacity: ${formatNumber(colony.populationCap)}`),
      this._createParagraph(doc, `Growth Rate: ${(finiteNumber(colony.growthRate) * 100).toFixed(1)}%`),
    );

    const resourceSection = doc.createElement('div');
    resourceSection.className = 'details-section';
    const resourceHeading = doc.createElement('h4');
    resourceHeading.textContent = 'Resources';
    const resourceList = doc.createElement('ul');
    [
      ['💰 Credits', resources.credits],
      ['⛏️ Minerals', resources.minerals],
      ['⚡ Energy', resources.energy],
      ['🌾 Food', resources.food],
    ].forEach(([label, amount]) => {
      const item = doc.createElement('li');
      item.textContent = `${label}: ${formatNumber(amount)}`;
      resourceList.append(item);
    });
    resourceSection.append(resourceHeading, resourceList);

    const buildingEntries = Object.entries(buildings);
    const buildingSection = doc.createElement('div');
    buildingSection.className = 'details-section';
    const buildingHeading = doc.createElement('h4');
    const buildingCount = buildingEntries.reduce((sum, [, building]) => sum + finiteNumber(building?.count), 0);
    buildingHeading.textContent = `Buildings (${buildingCount})`;
    const buildingList = doc.createElement('ul');
    buildingEntries.forEach(([buildingType, building]) => {
      const item = doc.createElement('li');
      item.textContent = `${String(buildingTypes[buildingType]?.name ?? buildingType)}: ${formatNumber(building?.count)}`;
      buildingList.append(item);
    });
    buildingSection.append(buildingHeading, buildingList);

    const buildSection = doc.createElement('div');
    buildSection.className = 'details-section';
    const buildHeading = doc.createElement('h4');
    buildHeading.textContent = 'Build New Building';
    const buildOptions = doc.createElement('div');
    buildOptions.className = 'build-options';
    Object.values(buildingTypes).forEach(building => {
      const button = doc.createElement('button');
      button.className = 'build-btn';
      button.textContent = `+ ${String(building.name ?? '')}`;
      button.addEventListener('click', () => {
        try {
          this.controller.addBuilding(String(colony.id ?? ''), String(building.id ?? ''), 1);
          this._rerenderSection('details');
          this._rerenderSection('colonies');
        } catch (error) {
          this._handleError(error);
        }
      });
      buildOptions.append(button);
    });
    buildSection.append(buildHeading, buildOptions);

    detailsGrid.append(populationSection, resourceSection, buildingSection, buildSection);
    return section;
  }

  _createParagraph(doc, text) {
    const paragraph = doc.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  }

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

  _showStatus(message, duration = 3000) {
    const statusEl = this.container.querySelector('#colonization-status');
    if (statusEl) {
      statusEl.textContent = message;
      setTimeout(() => {
        statusEl.textContent = '';
      }, duration);
    }
  }

  _handleError(error) {
    const message = error?.message || 'Unknown error';
    this._showStatus(`❌ ${message}`, 4000);
    if (this.controller.onError) {
      this.controller.onError(error);
    }
  }
}
