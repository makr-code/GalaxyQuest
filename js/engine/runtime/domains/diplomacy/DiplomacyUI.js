/**
 * DiplomacyUI - Simple relation matrix
 */

export class DiplomacyUI {
  constructor(diplomacyController, domTarget) {
    this.controller = diplomacyController;
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
      <div class="diplomacy-panel">
        <h2>🤝 Diplomacy</h2>
        ${this._buildRelationsMatrix()}
        ${this._buildIncidentsSection()}
        <button class="btn-save" id="btn-save">💾 Save</button>
      </div>
    `;
  }

  _buildRelationsMatrix() {
    const relations = this.controller.getAllRelations();
    let html = `<div class="relations-matrix"><h3>Relations</h3><table>`;

    relations.forEach(rel => {
      const statusColor = { ally: 'green', enemy: 'red', neutral: 'gray' }[rel.status];
      html += `
        <tr>
          <td>${rel.factions[0]} ↔ ${rel.factions[1]}</td>
          <td><div class="relation-bar">
            <div class="relation-fill" style="width:${rel.score}%; background:${statusColor}"></div>
          </div></td>
          <td>${rel.status}</td>
          <td>${rel.score}/100</td>
        </tr>
      `;
    });

    html += `</table></div>`;
    return html;
  }

  _buildIncidentsSection() {
    const incidents = this.controller.getIncidents();
    let html = `<div class="incidents"><h3>Incidents</h3>`;

    if (incidents.length === 0) {
      html += `<p>No incidents reported</p>`;
    } else {
      html += `<ul>`;
      incidents.forEach(inc => {
        html += `<li>${inc.between.join(' vs ')} - ${inc.type} (${inc.severity})</li>`;
      });
      html += `</ul>`;
    }

    html += `</div>`;
    return html;
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
