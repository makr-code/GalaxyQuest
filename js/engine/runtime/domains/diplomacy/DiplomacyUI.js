/**
 * DiplomacyUI - Simple relation matrix
 */

function boundedScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
}

export class DiplomacyUI {
  constructor(diplomacyController, domTarget) {
    this.controller = diplomacyController;
    this.container = domTarget;
    if (domTarget) this.render();
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  render() {
    if (!this.container) return;
    const doc = this.container.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'diplomacy-panel';

    const title = doc.createElement('h2');
    title.textContent = '🤝 Diplomacy';
    panel.append(title, this._buildRelationsMatrix(), this._buildIncidentsSection());

    const saveButton = doc.createElement('button');
    saveButton.className = 'btn-save';
    saveButton.id = 'btn-save';
    saveButton.textContent = '💾 Save';
    panel.append(saveButton);
    this.container.replaceChildren(panel);
    this._attachEventHandlers();
  }

  _buildRelationsMatrix() {
    const doc = this.container.ownerDocument;
    const relations = this.controller.getAllRelations();
    const matrix = doc.createElement('div');
    matrix.className = 'relations-matrix';
    const heading = doc.createElement('h3');
    heading.textContent = 'Relations';
    const table = doc.createElement('table');
    matrix.append(heading, table);

    relations.forEach(rel => {
      const statusColors = { ally: 'green', enemy: 'red', neutral: 'gray' };
      const status = Object.hasOwn(statusColors, rel.status) ? rel.status : 'neutral';
      const statusColor = statusColors[status];
      const score = boundedScore(rel.score);
      const factions = Array.isArray(rel.factions) ? rel.factions : [];
      const row = doc.createElement('tr');
      const factionsCell = doc.createElement('td');
      factionsCell.textContent = `${String(factions[0] ?? '')} ↔ ${String(factions[1] ?? '')}`;

      const barCell = doc.createElement('td');
      const bar = doc.createElement('div');
      bar.className = 'relation-bar';
      const fill = doc.createElement('div');
      fill.className = 'relation-fill';
      fill.style.width = `${score}%`;
      fill.style.background = statusColor;
      bar.append(fill);
      barCell.append(bar);

      const statusCell = doc.createElement('td');
      statusCell.textContent = status;
      const scoreCell = doc.createElement('td');
      scoreCell.textContent = `${score}/100`;
      row.append(factionsCell, barCell, statusCell, scoreCell);
      table.append(row);
    });

    return matrix;
  }

  _buildIncidentsSection() {
    const doc = this.container.ownerDocument;
    const incidents = this.controller.getIncidents();
    const section = doc.createElement('div');
    section.className = 'incidents';
    const heading = doc.createElement('h3');
    heading.textContent = 'Incidents';
    section.append(heading);

    if (incidents.length === 0) {
      const emptyState = doc.createElement('p');
      emptyState.textContent = 'No incidents reported';
      section.append(emptyState);
    } else {
      const list = doc.createElement('ul');
      incidents.forEach(inc => {
        const factions = Array.isArray(inc.between) ? inc.between : [];
        const item = doc.createElement('li');
        item.textContent = `${factions.map(value => String(value ?? '')).join(' vs ')} - ${String(inc.type ?? '')} (${String(inc.severity ?? '')})`;
        list.append(item);
      });
      section.append(list);
    }

    return section;
  }

  _attachEventHandlers() {
    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          alert('✅ Diplomacy saved');
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    }
  }

  handleStateChange(change) {
    if (['relation-changed', 'incident-reported', 'treaty-signed'].includes(change.type)) {
      this.render();
    }
  }
}
