/**
 * EventUI - Game event log and trigger display
 */

export class EventUI {
  constructor(eventController, domTarget) {
    this.controller = eventController;
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
      <div class="event-panel">
        <h2>⚡ Game Events</h2>
        ${this._buildAvailableEventsSection()}
        ${this._buildEventLogSection()}
        <button class="btn-save" id="btn-save">💾 Save</button>
      </div>
    `;
  }

  _buildAvailableEventsSection() {
    const events = this.controller.getAllEvents();
    let html = `<div class="available-events"><h3>Available Events</h3><div class="event-list">`;

    events.forEach(event => {
      const triggered = event.triggered ? '✅ Triggered' : '⏳ Pending';
      const severityEmoji = {
        'critical': '🔴',
        'major': '🟠',
        'moderate': '🟡',
        'minor': '🔵',
        'positive': '🟢'
      }[event.severity] || '⚪';

      html += `
        <div class="event-card" data-event-type="${event.type}">
          <div class="event-header">
            <span>${severityEmoji} ${event.title}</span>
            <span class="status">${triggered}</span>
          </div>
          <p class="event-desc">${event.description}</p>
          <button class="btn-trigger" data-event-type="${event.type}" ${event.triggered ? 'disabled' : ''}>
            🎯 Trigger
          </button>
        </div>
      `;
    });

    html += `</div></div>`;
    return html;
  }

  _buildEventLogSection() {
    const log = this.controller.getEventLog(20);
    let html = `<div class="event-log"><h3>Event Log (Last 20)</h3><ul>`;

    if (log.length === 0) {
      html += `<li>No events triggered</li>`;
    } else {
      log.forEach(entry => {
        const timeStr = new Date(entry.timestamp).toLocaleTimeString();
        html += `
          <li>
            <strong>${entry.title}</strong> @ ${timeStr}
            <br>
            <span class="severity-${entry.severity}">Consequences: ${entry.consequences.join(', ')}</span>
          </li>
        `;
      });
    }

    html += `</ul></div>`;
    return html;
  }

  _attachEventHandlers() {
    const triggerButtons = this.container.querySelectorAll('.btn-trigger');
    triggerButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const eventType = e.target.dataset.eventType;
        try {
          this.controller.triggerEvent(eventType);
          this.render();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    });

    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          alert('✅ Events saved');
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    }
  }

  handleStateChange(change) {
    if (change.type === 'event-triggered') {
      this.render();
    }
  }
}
