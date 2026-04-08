'use strict';
/**
 * RuntimeContractNegotiationModal.js
 *
 * Victoria 3-inspired two-column negotiation dialog.
 * Left column: player offer (drag-selectable terms).
 * Right column: faction demands (pre-filled from AI profile).
 * Bottom: standing meter, AI acceptance bar, duration selector.
 *
 * Usage:
 *   const modal = GQRuntimeContractNegotiationModal.createModal({ api, wm, esc, showToast, dataModel });
 *   modal.open(faction, agreementTypeCode);
 *
 * Exposed as window.GQRuntimeContractNegotiationModal.
 */
(function () {
  function createModal(opts = {}) {
    const API       = opts.api;
    const WM        = opts.wm;
    const esc       = opts.esc       || ((v) => String(v ?? ''));
    const showToast = opts.showToast || (() => {});
    const onProposed = typeof opts.onProposed === 'function' ? opts.onProposed : () => {};
    const dataModel = opts.dataModel
      || (typeof window !== 'undefined' && window.GQRuntimeDiplomacyDataModel)
      || null;

    let _faction = null;
    let _type    = null;
    let _types   = [];
    let _playerSelectedTerms = new Set();

    // ── Helpers ────────────────────────────────────────────────────────────

    function _typeOptions() {
      return _types.map((t) => `
        <option value="${esc(t.code)}"${_type && t.code === _type.code ? ' selected' : ''}>
          ${esc(t.icon)} ${esc(t.label)}
        </option>`).join('');
    }

    function _playerTermsHTML(type) {
      const slots = type?.player_offer_slots || [];
      if (!slots.length) {
        return '<li class="text-muted">No terms to offer for this type.</li>';
      }
      return slots.map((slot) => {
        const checked = _playerSelectedTerms.has(slot.term) ? 'checked' : '';
        return `
          <li class="gq-term-row">
            <label class="gq-term-label">
              <input type="checkbox" class="gq-term-check" data-term="${esc(slot.term)}" ${checked} />
              ${esc(slot.label)}
              ${slot.resource ? `<span class="gq-term-resource">(${esc(slot.resource)})</span>` : ''}
            </label>
          </li>`;
      }).join('');
    }

    function _factionDemandsHTML(type) {
      const demands = type?.faction_demand_templates || [];
      if (!demands.length) {
        return '<li class="text-muted">No specific demands.</li>';
      }
      return demands.map((d) => `
        <li class="gq-term-row gq-term-row--demand">
          <span class="gq-term-demand-icon">•</span> ${esc(d.label)}
        </li>`).join('');
    }

    function _durationOptions(type) {
      const options = [
        { value: 1, label: '1 Cycle' },
        { value: 3, label: '3 Cycles' },
        { value: 6, label: '6 Cycles' },
        { value: '',  label: 'Permanent (until cancelled)' },
      ];
      const def = type?.defaultDuration ?? 3;
      return options.map((o) => `
        <option value="${esc(String(o.value))}"${String(o.value) === String(def) ? ' selected' : ''}>
          ${esc(o.label)}
        </option>`).join('');
    }

    function _minStandingWarningHTML(type, currentStanding) {
      const min = Number(type?.minStanding ?? 0);
      const cur = Number(currentStanding ?? 0);
      if (cur >= min) return '';
      return `
        <div class="gq-negotiate-warning">
          ⚠️ Standing too low. Requires ${min}, you have ${cur}.
        </div>`;
    }

    // ── Main modal HTML ────────────────────────────────────────────────────

    function _buildHTML(faction, type, standing) {
      const reward = Number(type?.standingReward ?? 0);
      return `
        <div class="gq-negotiate-modal" data-faction-id="${esc(String(faction.id))}">
          <div class="gq-negotiate-modal__header">
            <span class="gq-negotiate-modal__faction" style="color:${esc(faction.color ?? '#fff')}">
              ${esc(faction.icon ?? '')} ${esc(faction.name ?? '')}
            </span>
            <div class="gq-negotiate-modal__type-selector">
              <label>Agreement type:</label>
              <select id="gq-neg-type-select" class="input-sm">${_typeOptions()}</select>
            </div>
          </div>

          ${_minStandingWarningHTML(type, standing)}

          <div class="gq-contract-cols">
            <div class="gq-contract-col gq-contract-col--player">
              <div class="gq-contract-col__title">🧑 You offer</div>
              <ul class="gq-contract-terms" id="gq-neg-player-terms">
                ${_playerTermsHTML(type)}
              </ul>
            </div>
            <div class="gq-contract-col gq-contract-col--faction">
              <div class="gq-contract-col__title">🦎 ${esc(faction.name ?? 'Faction')} requires</div>
              <ul class="gq-contract-terms" id="gq-neg-faction-demands">
                ${_factionDemandsHTML(type)}
              </ul>
            </div>
          </div>

          <div class="gq-negotiate-modal__footer">
            <div class="gq-negotiate-footer-row">
              <label>Duration:
                <select id="gq-neg-duration" class="input-sm">${_durationOptions(type)}</select>
              </label>
              <div class="gq-negotiate-standing-preview">
                <span>Rep after signing:</span>
                ${dataModel.standingMeterHTML(standing, reward)}
              </div>
            </div>

            <div class="gq-negotiate-footer-row">
              <span class="gq-negotiate-label">AI acceptance estimate:</span>
              <div id="gq-neg-ai-bar">${dataModel.acceptanceBarHTML(50)}</div>
            </div>

            <div class="gq-negotiate-actions">
              <button class="btn btn-secondary" id="gq-neg-cancel-btn">Cancel</button>
              <button class="btn" id="gq-neg-propose-btn">Submit Proposal ➤</button>
            </div>
          </div>
        </div>`;
    }

    // ── AI bar update ──────────────────────────────────────────────────────

    function _updateAiBar(root, pct) {
      const bar = root.querySelector('#gq-neg-ai-bar');
      if (bar) bar.innerHTML = dataModel.acceptanceBarHTML(pct);
    }

    // ── Event wiring ───────────────────────────────────────────────────────

    function _bind(root, faction, initialStanding) {
      // Type selector change → re-render columns
      const typeSelect = root.querySelector('#gq-neg-type-select');
      typeSelect?.addEventListener('change', () => {
        const code = String(typeSelect.value || '');
        _type = dataModel.getType(code);
        _playerSelectedTerms.clear();
        const playerList = root.querySelector('#gq-neg-player-terms');
        const factionList = root.querySelector('#gq-neg-faction-demands');
        if (playerList) playerList.innerHTML = _playerTermsHTML(_type);
        if (factionList) factionList.innerHTML = _factionDemandsHTML(_type);
        // Recalculate AI estimate
        const ai = _estimateAi(_type, initialStanding);
        _updateAiBar(root, ai);
        _bindTermChecks(root, faction, initialStanding);
      });

      _bindTermChecks(root, faction, initialStanding);

      // Cancel
      root.querySelector('#gq-neg-cancel-btn')?.addEventListener('click', () => {
        WM.modal('contract-negotiate', { close: true });
      });

      // Propose
      root.querySelector('#gq-neg-propose-btn')?.addEventListener('click', async () => {
        const proposeBtn = root.querySelector('#gq-neg-propose-btn');
        if (proposeBtn) proposeBtn.disabled = true;
        await _submitProposal(root, faction);
        if (proposeBtn) proposeBtn.disabled = false;
      });
    }

    function _bindTermChecks(root, faction, standing) {
      root.querySelectorAll('.gq-term-check').forEach((chk) => {
        chk.addEventListener('change', () => {
          const term = String(chk.dataset.term || '');
          if (chk.checked) {
            _playerSelectedTerms.add(term);
          } else {
            _playerSelectedTerms.delete(term);
          }
          const ai = _estimateAi(_type, standing);
          _updateAiBar(root, ai);
        });
      });
    }

    function _estimateAi(type, standing) {
      if (!type) return 50;
      const min  = Number(type.minStanding ?? 0);
      const gap  = Number(standing ?? 0) - min;
      let base = 40 + Math.min(40, Math.max(-40, gap));
      // bonus for more player offer terms
      base += _playerSelectedTerms.size * 5;
      return Math.max(5, Math.min(95, Math.round(base)));
    }

    async function _submitProposal(root, faction) {
      const typeSelect  = root.querySelector('#gq-neg-type-select');
      const durSelect   = root.querySelector('#gq-neg-duration');
      const typeCode    = String(typeSelect?.value || (_type && _type.code) || '');
      const durVal      = durSelect?.value;
      const duration    = durVal !== '' && durVal !== null ? Number(durVal) : null;

      // Build offer array from selected checkboxes
      const type    = dataModel.getType(typeCode);
      const slots   = type?.player_offer_slots || [];
      const playerOffer = slots.filter((s) => _playerSelectedTerms.has(s.term));

      // Build faction demands from templates
      const factionDemand = (type?.faction_demand_templates || []).map((d) => ({
        term: d.term, label: d.label,
      }));

      try {
        const res = await API.factionAgreementsPropose({
          faction_id:     faction.id,
          agreement_type: typeCode,
          player_offer:   playerOffer,
          faction_demand: factionDemand,
          duration_cycles: duration,
        });
        if (!res.success) {
          showToast(res.error || 'Proposal failed.', 'error');
          return;
        }
        showToast(`Proposal submitted! AI acceptance: ${res.ai_acceptance_pct}%`, 'success');
        WM.modal('contract-negotiate', { close: true });
        onProposed(faction);
      } catch (e) {
        showToast(String(e), 'error');
      }
    }

    // ── Public open ────────────────────────────────────────────────────────

    async function open(faction, typeCode) {
      _faction = faction;
      _playerSelectedTerms.clear();

      // Load types (from server or static)
      try {
        const res = await API.factionAgreementsTypes();
        _types = (res.types || []).map((t) => ({
          ...t,
          minStanding:   Number(t.min_standing  ?? t.minStanding  ?? 0),
          standingReward: Number(t.standing_reward ?? t.standingReward ?? 0),
          defaultDuration: t.default_duration ?? t.defaultDuration ?? null,
        }));
      } catch (_) {
        _types = dataModel.getTypes();
      }

      _type = dataModel.getType(typeCode) || _types[0] || null;
      const standing = Number(faction.standing ?? 0);

      WM.modal('contract-negotiate', {
        title: `Negotiate: ${_type?.label ?? 'Agreement'}`,
        html:  _buildHTML(faction, _type, standing),
        onOpen: (modalRoot) => _bind(modalRoot, faction, standing),
      });
    }

    return { open };
  }

  const api = { createModal };
  if (typeof window !== 'undefined') {
    window.GQRuntimeContractNegotiationModal = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
