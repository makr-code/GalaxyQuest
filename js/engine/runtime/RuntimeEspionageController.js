'use strict';

/**
 * RuntimeEspionageController
 *
 * Agent list, active mission list, and "Assign Mission" form for the
 * espionage sub-system.
 * Referenz: docs/gamedesign/EMPIRE_CATEGORIES.md
 *           api/espionage.php
 */
(function () {
  const MISSION_TYPES = [
    'sabotage',
    'steal_resources',
    'steal_research',
    'assassinate_governor',
    'gather_intel',
    'destabilize',
  ];

  function createEspionageController(opts = {}) {
    const wm  = opts.wm;
    const api = opts.api;
    const esc = opts.esc || ((v) => String(v ?? ''));
    const uiKitSkeletonHTML  = opts.uiKitSkeletonHTML  || (() => '<p class="text-muted">Loading…</p>');
    const uiKitEmptyStateHTML = opts.uiKitEmptyStateHTML || (() => '');
    const gameLog   = typeof opts.gameLog   === 'function' ? opts.gameLog   : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});

    // ── HTML helpers ─────────────────────────────────────────────────────────

    function statusBadge(status) {
      const colors = {
        idle:     '#4f8cff',
        on_mission: '#f0b429',
        injured:  '#e05c5c',
        retired:  '#6b7a9a',
      };
      const c = colors[status] || '#9fb0ce';
      return `<span style="font-size:11px;padding:2px 6px;border-radius:10px;background:${c}22;color:${c};border:1px solid ${c}44;">${esc(status || '—')}</span>`;
    }

    function agentRow(agent) {
      return `<tr>
        <td style="padding:6px 8px;">${esc(agent.name || '—')}</td>
        <td style="padding:6px 8px;text-align:center;">${esc(String(agent.skill_level ?? '—'))}</td>
        <td style="padding:6px 8px;">${esc(agent.specialization || '—')}</td>
        <td style="padding:6px 8px;">${statusBadge(agent.status)}</td>
      </tr>`;
    }

    function missionRow(m) {
      return `<tr>
        <td style="padding:6px 8px;">${esc(String(m.id ?? '—'))}</td>
        <td style="padding:6px 8px;">${esc(m.mission_type || '—')}</td>
        <td style="padding:6px 8px;">${esc(String(m.target_user_id ?? '—'))}</td>
        <td style="padding:6px 8px;">${statusBadge(m.status)}</td>
        <td style="padding:6px 8px;font-size:11px;color:#9fb0ce;">${esc(m.resolves_at || '—')}</td>
      </tr>`;
    }

    function tableStyle() {
      return 'width:100%;border-collapse:collapse;font-size:13px;color:#c8d8f0;';
    }

    function thStyle() {
      return 'padding:6px 8px;text-align:left;font-size:11px;color:#9fb0ce;border-bottom:1px solid #2a3550;';
    }

    // ── Controller class ─────────────────────────────────────────────────────

    class EspionageController {
      constructor() {
        this.state = { agents: [], missions: [] };
        this.isBusy = false;
      }

      async loadData() {
        const [agentsRes, missionsRes] = await Promise.all([
          api.getEspionageStatus ? api.getEspionageStatus() : Promise.resolve(null),
          api.getActiveEspionageMissions ? api.getActiveEspionageMissions() : Promise.resolve(null),
        ]);
        this.state.agents   = (agentsRes  && Array.isArray(agentsRes.agents))   ? agentsRes.agents   : [];
        this.state.missions = (missionsRes && Array.isArray(missionsRes.missions)) ? missionsRes.missions : [];
      }

      renderHtml() {
        const { agents, missions } = this.state;

        const agentRows = agents.length
          ? agents.map(agentRow).join('')
          : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7a9a;">No agents hired yet.</td></tr>`;

        const missionRows = missions.length
          ? missions.map(missionRow).join('')
          : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7a9a;">No active missions.</td></tr>`;

        const missionTypeOptions = MISSION_TYPES
          .map((t) => `<option value="${esc(t)}">${esc(t)}</option>`)
          .join('');

        return `<div style="padding:16px;color:#c8d8f0;font-family:sans-serif;">
          <h3 style="margin:0 0 12px;color:#e3efff;font-size:16px;">Espionage</h3>

          <!-- Agents -->
          <div style="margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h4 style="margin:0;font-size:14px;color:#9fb0ce;">Agents</h4>
              <button id="gq-espionage-hire-btn"
                style="padding:4px 12px;font-size:12px;background:#1f2e50;border:1px solid #4f8cff;color:#4f8cff;border-radius:4px;cursor:pointer;">
                + Hire Agent
              </button>
            </div>
            <table style="${tableStyle()}">
              <thead><tr>
                <th style="${thStyle()}">Name</th>
                <th style="${thStyle()}">Skill</th>
                <th style="${thStyle()}">Spec.</th>
                <th style="${thStyle()}">Status</th>
              </tr></thead>
              <tbody>${agentRows}</tbody>
            </table>
          </div>

          <!-- Active Missions -->
          <div style="margin-bottom:20px;">
            <h4 style="margin:0 0 8px;font-size:14px;color:#9fb0ce;">Active Missions</h4>
            <table style="${tableStyle()}">
              <thead><tr>
                <th style="${thStyle()}">#</th>
                <th style="${thStyle()}">Type</th>
                <th style="${thStyle()}">Target</th>
                <th style="${thStyle()}">Status</th>
                <th style="${thStyle()}">Resolves</th>
              </tr></thead>
              <tbody>${missionRows}</tbody>
            </table>
          </div>

          <!-- Assign Mission Form -->
          <div>
            <h4 style="margin:0 0 8px;font-size:14px;color:#9fb0ce;">Assign Mission</h4>
            <form id="gq-espionage-assign-form" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
              <div style="display:flex;flex-direction:column;gap:3px;">
                <label style="font-size:11px;color:#9fb0ce;">Agent ID</label>
                <input id="gq-esp-agent-id" type="number" min="1" placeholder="Agent ID"
                  style="width:90px;padding:4px 8px;background:#1a2235;border:1px solid #2a3550;border-radius:4px;color:#e3efff;font-size:13px;"/>
              </div>
              <div style="display:flex;flex-direction:column;gap:3px;">
                <label style="font-size:11px;color:#9fb0ce;">Target User ID</label>
                <input id="gq-esp-target-id" type="number" min="1" placeholder="User ID"
                  style="width:90px;padding:4px 8px;background:#1a2235;border:1px solid #2a3550;border-radius:4px;color:#e3efff;font-size:13px;"/>
              </div>
              <div style="display:flex;flex-direction:column;gap:3px;">
                <label style="font-size:11px;color:#9fb0ce;">Mission Type</label>
                <select id="gq-esp-mission-type"
                  style="padding:4px 8px;background:#1a2235;border:1px solid #2a3550;border-radius:4px;color:#e3efff;font-size:13px;">
                  ${missionTypeOptions}
                </select>
              </div>
              <button type="submit"
                style="padding:5px 14px;background:#1f2e50;border:1px solid #4f8cff;color:#4f8cff;border-radius:4px;cursor:pointer;font-size:13px;">
                Assign
              </button>
            </form>
            <p id="gq-espionage-form-msg" style="margin:8px 0 0;font-size:12px;min-height:18px;"></p>
          </div>
        </div>`;
      }

      attachEventListeners(root) {
        const hireBtn = root.querySelector('#gq-espionage-hire-btn');
        if (hireBtn) {
          hireBtn.addEventListener('click', async () => {
            if (this.isBusy) return;
            this.isBusy = true;
            hireBtn.disabled = true;
            try {
              const res = await (api.hireEspionageAgent ? api.hireEspionageAgent({}) : Promise.resolve({ success: false, error: 'API unavailable' }));
              if (res && res.success) {
                showToast('Agent hired!', 'success');
                await this.render();
              } else {
                showToast(res?.error || 'Hire failed', 'error');
              }
            } catch (err) {
              gameLog('warn', 'hireEspionageAgent failed', err);
              showToast('Hire request failed', 'error');
            } finally {
              this.isBusy = false;
              hireBtn.disabled = false;
            }
          });
        }

        const form = root.querySelector('#gq-espionage-assign-form');
        if (form) {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (this.isBusy) return;
            const agentId  = parseInt(root.querySelector('#gq-esp-agent-id')?.value || '0', 10);
            const targetId = parseInt(root.querySelector('#gq-esp-target-id')?.value || '0', 10);
            const mType    = root.querySelector('#gq-esp-mission-type')?.value || '';
            const msgEl    = root.querySelector('#gq-espionage-form-msg');
            if (!agentId || !targetId || !mType) {
              if (msgEl) msgEl.textContent = 'Please fill in all fields.';
              return;
            }
            this.isBusy = true;
            try {
              const res = await (api.assignEspionageMission
                ? api.assignEspionageMission({ agent_id: agentId, target_user_id: targetId, mission_type: mType })
                : Promise.resolve({ success: false, error: 'API unavailable' }));
              if (res && res.success) {
                showToast('Mission assigned!', 'success');
                if (msgEl) msgEl.textContent = '';
                await this.render();
              } else {
                const msg = res?.error || 'Assignment failed';
                if (msgEl) msgEl.textContent = msg;
                showToast(msg, 'error');
              }
            } catch (err) {
              gameLog('warn', 'assignEspionageMission failed', err);
              if (root.querySelector('#gq-espionage-form-msg')) root.querySelector('#gq-espionage-form-msg').textContent = 'Request failed';
            } finally {
              this.isBusy = false;
            }
          });
        }
      }

      async render() {
        const root = wm.body('espionage');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();
        try {
          await this.loadData();
          root.innerHTML = this.renderHtml();
          this.attachEventListeners(root);
        } catch (err) {
          gameLog('warn', 'EspionageController load failed', err);
          root.innerHTML = '<p style="color:#e05c5c;padding:16px;">Failed to load espionage data.</p>';
        }
      }
    }

    return new EspionageController();
  }

  const api = {
    createEspionageController,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeEspionageController = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
