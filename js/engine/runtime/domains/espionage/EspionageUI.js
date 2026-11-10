/**
 * EspionageUI - Spy network and operations display
 */

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createListSection(doc, className, title, emptyMessage, items, renderItem) {
  const section = doc.createElement('div');
  section.className = className;
  const heading = doc.createElement('h3');
  heading.textContent = `${title} (${items.length})`;
  const list = doc.createElement('ul');
  if (items.length === 0) {
    const emptyItem = doc.createElement('li');
    emptyItem.textContent = emptyMessage;
    list.append(emptyItem);
  } else {
    items.forEach(item => {
      const listItem = doc.createElement('li');
      listItem.textContent = renderItem(item);
      list.append(listItem);
    });
  }
  section.append(heading, list);
  return section;
}

export class EspionageUI {
  constructor(espionageController, domTarget) {
    this.controller = espionageController;
    this.container = domTarget;

    if (domTarget) this.render();
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  render() {
    if (!this.container) return;
    const doc = this.container.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'espionage-panel';

    const heading = doc.createElement('h2');
    heading.textContent = '🕵️ Espionage';

    const spies = this.controller.getFactionSpies('player_faction');
    const intelligence = this.controller.getFactionIntelligence('player_faction');
    const operations = this.controller.getOperations();
    panel.append(
      heading,
      createListSection(doc, 'spies', 'Active Spies', 'No active spies', spies, spy => {
        const status = spy.status === 'active' ? '✅' : '❌';
        return `${status} ${String(spy.name ?? '')} → ${String(spy.targetFaction ?? '')} (Skill: ${Math.round(finiteNumber(spy.skill))})`;
      }),
      createListSection(doc, 'intelligence', 'Intelligence Reports', 'No intelligence gathered', intelligence, report => {
        const discovered = report.discovered ? '🚨 COMPROMISED' : '✅';
        return `${discovered} ${String(report.type ?? '')} from ${String(report.target ?? '')} (${Math.round(finiteNumber(report.reliability))}% reliable)`;
      }),
      createListSection(doc, 'operations', 'Sabotage Operations', 'No active operations', operations, operation => {
        const status = operation.status === 'active' ? '🔄' : '✅';
        const progress = Math.min(100, Math.max(0, finiteNumber(operation.progress)));
        return `${status} ${String(operation.targetType ?? '')} vs ${String(operation.target ?? '')} (${progress}%)`;
      }),
    );

    const saveButton = doc.createElement('button');
    saveButton.className = 'btn-save';
    saveButton.id = 'btn-save';
    saveButton.textContent = '💾 Save';
    saveButton.addEventListener('click', async () => {
      try {
        await this.controller.save();
        alert('✅ Espionage saved');
      } catch (error) {
        alert(`Error: ${error.message}`);
      }
    });
    panel.append(saveButton);
    this.container.replaceChildren(panel);
  }

  handleStateChange(change) {
    if (['spy-deployed', 'intelligence-gathered', 'sabotage-launched'].includes(change.type)) {
      this.render();
    }
  }
}
