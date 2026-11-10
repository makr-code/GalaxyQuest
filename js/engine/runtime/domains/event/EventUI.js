/**
 * EventUI - Game event log and trigger display
 */

const SEVERITY_EMOJI = {
  critical: '🔴',
  major: '🟠',
  moderate: '🟡',
  minor: '🔵',
  positive: '🟢',
};

function createTextElement(doc, tagName, className, text) {
  const element = doc.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

export class EventUI {
  constructor(eventController, domTarget) {
    this.controller = eventController;
    this.container = domTarget;

    if (domTarget) this.render();
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  render() {
    if (!this.container) return;
    const doc = this.container.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'event-panel';
    panel.append(
      createTextElement(doc, 'h2', '', '⚡ Game Events'),
      this._buildAvailableEventsSection(),
      this._buildEventLogSection(),
    );

    const saveButton = createTextElement(doc, 'button', 'btn-save', '💾 Save');
    saveButton.id = 'btn-save';
    saveButton.addEventListener('click', async () => {
      try {
        await this.controller.save();
        alert('✅ Events saved');
      } catch (error) {
        alert(`Error: ${error.message}`);
      }
    });
    panel.append(saveButton);
    this.container.replaceChildren(panel);
  }

  _buildAvailableEventsSection() {
    const doc = this.container.ownerDocument;
    const events = this.controller.getAllEvents();
    const section = doc.createElement('div');
    section.className = 'available-events';
    section.append(createTextElement(doc, 'h3', '', 'Available Events'));

    const list = doc.createElement('div');
    list.className = 'event-list';
    events.forEach(event => {
      const eventType = String(event.type ?? '');
      const severityEmoji = Object.hasOwn(SEVERITY_EMOJI, event.severity)
        ? SEVERITY_EMOJI[event.severity]
        : '⚪';
      const card = doc.createElement('div');
      card.className = 'event-card';
      card.dataset.eventType = eventType;

      const header = doc.createElement('div');
      header.className = 'event-header';
      header.append(
        createTextElement(doc, 'span', '', `${severityEmoji} ${String(event.title ?? '')}`),
        createTextElement(doc, 'span', 'status', event.triggered ? '✅ Triggered' : '⏳ Pending'),
      );
      const description = createTextElement(doc, 'p', 'event-desc', String(event.description ?? ''));
      const triggerButton = createTextElement(doc, 'button', 'btn-trigger', '🎯 Trigger');
      triggerButton.dataset.eventType = eventType;
      triggerButton.disabled = Boolean(event.triggered);
      triggerButton.addEventListener('click', (clickEvent) => {
        const type = clickEvent.currentTarget.dataset.eventType;
        const currentEvent = this.controller.getAllEvents().find(item => String(item.type) === type);
        if (!currentEvent || currentEvent.triggered) return;
        try {
          this.controller.triggerEvent(type);
          this.render();
        } catch (error) {
          alert(`Error: ${error.message}`);
        }
      });

      card.append(header, description, triggerButton);
      list.append(card);
    });
    section.append(list);
    return section;
  }

  _buildEventLogSection() {
    const doc = this.container.ownerDocument;
    const log = this.controller.getEventLog(20);
    const section = doc.createElement('div');
    section.className = 'event-log';
    section.append(createTextElement(doc, 'h3', '', 'Event Log (Last 20)'));

    const list = doc.createElement('ul');
    if (log.length === 0) {
      list.append(createTextElement(doc, 'li', '', 'No events triggered'));
    } else {
      log.forEach(entry => {
        const item = doc.createElement('li');
        const title = createTextElement(doc, 'strong', '', String(entry.title ?? ''));
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const consequences = Array.isArray(entry.consequences) ? entry.consequences : [];
        const severity = Object.hasOwn(SEVERITY_EMOJI, entry.severity)
          ? entry.severity
          : 'unknown';
        const consequenceText = createTextElement(
          doc,
          'span',
          `severity-${severity}`,
          `Consequences: ${consequences.map(value => String(value ?? '')).join(', ')}`,
        );
        item.append(title, ` @ ${timestamp}`, doc.createElement('br'), consequenceText);
        list.append(item);
      });
    }
    section.append(list);
    return section;
  }

  handleStateChange(change) {
    if (change.type === 'event-triggered') {
      this.render();
    }
  }
}
