'use strict';
/**
 * RuntimeDiplomacyPanel.js
 *
 * Shows all faction agreements for the current user in the faction detail area.
 * Victoria 3-inspired: agreement-type tabs, active-contract chips, standing meter.
 *
 * Exposed as window.GQRuntimeDiplomacyPanel.
 */
(function () {
  function createDiplomacyPanel(opts = {}) {
    const API      = opts.api;
    const esc      = opts.esc      || ((v) => String(v ?? ''));
    const showToast = opts.showToast || (() => {});
    const dataModel = opts.dataModel
      || (typeof window !== 'undefined' && window.GQRuntimeDiplomacyDataModel)
      || null;
    const onNegotiate = typeof opts.onNegotiate === 'function' ? opts.onNegotiate : () => {};

    // ── HTML builders ──────────────────────────────────────────────────────

    function _agreementTypeTabsHTML(activeCode) {
      return dataModel.getTypes().map((t) => `
        <button
          class="gq-contract-type-tab${t.code === activeCode ? ' active' : ''}"
          data-tab="${esc(t.code)}"
          style="--tab-color:${esc(t.color)}"
          title="${esc(t.label)}"
        >${esc(t.icon)} <span>${esc(t.label)}</span></button>
      `).join('');
    }

    function _agreementCardHTML(ag, standing) {
      const type   = dataModel.getType(ag.agreement_type);
      const icon   = esc(type?.icon   ?? '📋');
      const label  = esc(type?.label  ?? ag.agreement_type);
      const color  = esc(type?.color  ?? '#888');
      const status = dataModel.statusClass(ag.status);
      const playerTerms  = (ag.player_offer   || []).map((t) => `<li>${esc(t.label || t.term || '')}</li>`).join('');
      const factionTerms = (ag.faction_demand  || []).map((t) => `<li>${esc(t.label || t.term || '')}</li>`).join('');

      const expiresLabel = ag.expires_at
        ? `Expires ${esc(new Date(ag.expires_at).toLocaleDateString())}`
        : 'Permanent';

      const canCancel   = ag.status === 'active';
      const canActivate = ag.status === 'proposed';

      return `
        <div class="gq-contract-panel gq-contract-status--${status}" style="--faction-color:${esc(ag.faction_color || '#888')}">
          <div class="gq-contract-panel__header">
            <span class="gq-contract-panel__type-icon" style="color:${color}">${icon}</span>
            <span class="gq-contract-panel__type-label">${label}</span>
            <span class="gq-contract-chip gq-contract-chip--${status}">${esc(ag.status)}</span>
            <span class="gq-contract-panel__faction">${esc(ag.faction_icon ?? '')} ${esc(ag.faction_name ?? '')}</span>
          </div>

          <div class="gq-contract-cols">
            <div class="gq-contract-col gq-contract-col--player">
              <div class="gq-contract-col__title">🧑 You offer</div>
              <ul class="gq-contract-terms">${playerTerms || '<li class="text-muted">No terms</li>'}</ul>
            </div>
            <div class="gq-contract-col gq-contract-col--faction">
              <div class="gq-contract-col__title">🦎 They require</div>
              <ul class="gq-contract-terms">${factionTerms || '<li class="text-muted">No demands</li>'}</ul>
            </div>
          </div>

          ${ag.status === 'proposed' && dataModel
            ? dataModel.acceptanceBarHTML(ag.ai_acceptance_pct)
            : ''}

          ${ag.status === 'active' && standing !== undefined
            ? dataModel.standingMeterHTML(standing, 0)
            : ''}

          <div class="gq-contract-panel__footer">
            <span class="gq-contract-panel__duration">${esc(expiresLabel)}</span>
            ${canActivate ? `<button class="btn btn-sm gq-contract-respond-btn" data-id="${esc(String(ag.id))}">Request AI Response</button>` : ''}
            ${canCancel   ? `<button class="btn btn-sm btn-warning gq-contract-cancel-btn"  data-id="${esc(String(ag.id))}">Cancel Agreement</button>` : ''}
          </div>
        </div>`;
    }

    function _emptyStateHTML(typeCode) {
      const t = dataModel.getType(typeCode);
      return `
        <div class="gq-contract-empty">
          <span class="gq-contract-empty__icon">${esc(t?.icon ?? '📋')}</span>
          <p>No ${esc(t?.label ?? typeCode)} agreements yet.</p>
          <button class="btn btn-sm gq-contract-new-btn" data-type="${esc(typeCode)}">
            + Propose ${esc(t?.label ?? typeCode)}
          </button>
        </div>`;
    }

    // ── Public render ──────────────────────────────────────────────────────

    async function render(containerEl, faction) {
      if (!containerEl || !faction) return;
      containerEl.innerHTML = '<div class="gq-contract-loading">Loading agreements…</div>';

      let agreements = [];
      try {
        const res = await API.factionAgreementsList(faction.id);
        agreements = res.agreements || [];
      } catch (_) {
        containerEl.innerHTML = '<p class="error text-sm">Failed to load agreements.</p>';
        return;
      }

      const types      = dataModel.getTypes();
      const activeTab  = types[0].code;

      const trustThreatHTML = dataModel
        ? dataModel.trustThreatBarsHTML(faction.trust_level ?? 0, faction.threat_level ?? 0)
        : '';

      containerEl.innerHTML = `
        <div class="gq-diplomacy-panel">
          <div class="gq-diplomacy-panel__header">
            <span class="gq-diplomacy-panel__title">⚖️ Agreements with ${esc(faction.icon ?? '')} ${esc(faction.name)}</span>
            <button class="btn btn-sm gq-contract-new-btn" data-type="${esc(types[0].code)}">+ New Agreement</button>
          </div>
          ${trustThreatHTML}

          <div class="gq-contract-tabs" role="tablist">
            ${_agreementTypeTabsHTML(activeTab)}
          </div>

          <div class="gq-contract-list" data-active-tab="${esc(activeTab)}">
            ${_renderTabContent(agreements, activeTab, faction)}
          </div>
        </div>`;

      _bindEvents(containerEl, agreements, faction);
    }

    function _renderTabContent(agreements, typeCode, faction) {
      const filtered = dataModel.filterByStatus(
        agreements.filter((a) => a.agreement_type === typeCode),
        'proposed', 'active',
      );
      if (!filtered.length) return _emptyStateHTML(typeCode);
      return filtered.map((ag) => _agreementCardHTML(ag, Number(faction.standing || 0))).join('');
    }

    function _bindEvents(root, agreements, faction) {
      // Tab switching
      root.querySelectorAll('.gq-contract-type-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = String(btn.dataset.tab || '');
          root.querySelectorAll('.gq-contract-type-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
          const list = root.querySelector('.gq-contract-list');
          if (list) {
            list.dataset.activeTab = tab;
            list.innerHTML = _renderTabContent(agreements, tab, faction);
            _bindCardEvents(root, agreements, faction);
          }
        });
      });

      _bindCardEvents(root, agreements, faction);

      // "New Agreement" buttons
      root.querySelectorAll('.gq-contract-new-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const type = String(btn.dataset.type || dataModel.getTypes()[0].code);
          onNegotiate(faction, type);
        });
      });
    }

    function _bindCardEvents(root, agreements, faction) {
      // AI respond
      root.querySelectorAll('.gq-contract-respond-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id || 0);
          btn.disabled = true;
          try {
            const res = await API.factionAgreementsRespond(id);
            if (!res.success) { showToast(res.error || 'Failed', 'error'); return; }
            const msg = res.outcome === 'accepted'
              ? `Agreement accepted! Standing +${res.standing_gain ?? 0}`
              : 'Agreement rejected by faction.';
            showToast(msg, res.outcome === 'accepted' ? 'success' : 'warning');
            // Reload the panel
            const container = root.querySelector('.gq-diplomacy-panel')?.parentElement;
            if (container) await render(container, faction);
          } catch (e) {
            showToast(String(e), 'error');
          }
        });
      });

      // Cancel
      root.querySelectorAll('.gq-contract-cancel-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Cancel this agreement? You will lose the standing bonus.')) return;
          const id = Number(btn.dataset.id || 0);
          btn.disabled = true;
          try {
            const res = await API.factionAgreementsCancel(id);
            if (!res.success) { showToast(res.error || 'Failed', 'error'); return; }
            showToast(`Agreement cancelled. Standing penalty: ${res.standing_penalty ?? 0}`, 'warning');
            const container = root.querySelector('.gq-diplomacy-panel')?.parentElement;
            if (container) await render(container, faction);
          } catch (e) {
            showToast(String(e), 'error');
          }
        });
      });
    }

    return { render };
  }

  const api = { createDiplomacyPanel };
  if (typeof window !== 'undefined') {
    window.GQRuntimeDiplomacyPanel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
