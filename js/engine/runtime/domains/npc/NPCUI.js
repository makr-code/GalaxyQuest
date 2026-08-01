/**
 * NPCUI - NPC faction and quest display
 */

export class NPCUI {
  constructor(npcController, domTarget) {
    this.controller = npcController;
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
      <div class="npc-panel">
        <h2>👾 NPC Factions</h2>
        ${this._buildNPCsSection()}
        ${this._buildQuestsSection()}
        <button class="btn-save" id="btn-save">💾 Save</button>
      </div>
    `;
  }

  _buildNPCsSection() {
    const npcs = this.controller.getAllNPCs();
    let html = `<div class="npcs"><h3>Active Factions (${npcs.length})</h3><div class="npc-grid">`;

    npcs.forEach(npc => {
      const powerLevel = this.controller.calculations.calculatePowerLevel(npc);
      html += `
        <div class="npc-card">
          <h4>${npc.name}</h4>
          <p>Personality: ${npc.personality}</p>
          <p>Alignment: ${npc.alignment}</p>
          <p>Treasury: 💰 ${npc.treasury}</p>
          <p>Military: ⚔️ ${npc.military}</p>
          <p>Technology: 🔬 ${npc.technology}</p>
          <p>Power: ⚡ ${powerLevel.toFixed(1)}</p>
        </div>
      `;
    });

    html += `</div></div>`;
    return html;
  }

  _buildQuestsSection() {
    const activeQuests = this.controller.getActiveQuests();
    let html = `<div class="quests"><h3>Active Quests (${activeQuests.length})</h3><ul>`;

    if (activeQuests.length === 0) {
      html += `<li>No active quests</li>`;
    } else {
      activeQuests.forEach(quest => {
        html += `
          <li>
            <strong>${quest.title}</strong>
            <br>From: ${quest.owner}
            <br>Reward: 💰 ${quest.reward.credits} | 🏆 ${quest.reward.reputation}
          </li>
        `;
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
          alert('✅ NPC state saved');
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    }
  }

  handleStateChange(change) {
    if (['npc-turn', 'quest-generated', 'quest-completed'].includes(change.type)) {
      this.render();
    }
  }
}
