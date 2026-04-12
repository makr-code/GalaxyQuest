'use strict';
/**
 * RuntimeDiplomaticPlaysPanel.js
 *
 * Sprint 3.2: Diplomatic Plays UI Panel
 *
 * Shows the 4-phase escalation stepper (Cooperation → Threat → Ultimatum → War)
 * with interactive Trust/Threat axes for the selected NPC faction.
 *
 * Exposed as window.GQRuntimeDiplomaticPlaysPanel.
 */
(function () {

  function createDiplomaticPlaysPanel(opts = {}) {
    const API       = opts.api;
    const esc       = opts.esc       || ((v) => String(v ?? ''));
    const showToast = opts.showToast || (() => {});
    const dataModel = opts.dataModel
      || (typeof window !== 'undefined' && window.GQRuntimeDiplomaticPlaysDataModel)
      || null;

    // ── Trust/Threat axes header ────────────────────────────────────────────

    function _axesHTML(trust, threat) {
      return `
        <div class="gq-diplo-axes">
          ${dataModel.trustBarHTML(trust)}
          ${dataModel.threatBarHTML(threat)}
        </div>`;
    }

    // ── "New Play" form ─────────────────────────────────────────────────────

    function _newPlayFormHTML(faction) {
      const goals = dataModel.getGoalTypes();
      const goalOptions = goals.map((g) =>
        `<option value="${esc(g.code)}">${esc(g.icon)} ${esc(g.label)}</option>`
      ).join('');

      return `
        <form class="gq-play-form" data-faction-id="${esc(String(faction.id))}">
          <div class="gq-play-form__title">⚖️ Open Diplomatic Play with ${esc(faction.icon ?? '')} ${esc(faction.name)}</div>
          <label class="gq-play-form__label">
            Goal
            <select class="gq-play-form__goal" name="goal_type">${goalOptions}</select>
          </label>
          <label class="gq-play-form__label">
            Your Demands <span class="gq-play-form__hint">(comma-separated)</span>
            <input class="gq-play-form__demands" name="player_demands" type="text" placeholder="e.g. open borders, trade route" />
          </label>
          <button type="submit" class="btn btn-sm gq-play-form__submit">🤝 Open Play (Cooperation)</button>
        </form>`;
    }

    // ── Full panel HTML ─────────────────────────────────────────────────────

    function _panelHTML(faction, plays, trust, threat) {
      const activePlays   = plays.filter((p) => p.status === 'active');
      const resolvedPlays = plays.filter((p) => p.status !== 'active');

      const activeHTML = activePlays.length
        ? activePlays.map((p) => dataModel.playCardHTML(p, esc)).join('')
        : '<p class="gq-play-empty">No active diplomatic plays.</p>';

      const resolvedSection = resolvedPlays.length
        ? `<details class="gq-play-history">
             <summary>Past Plays (${resolvedPlays.length})</summary>
             ${resolvedPlays.map((p) => dataModel.playCardHTML(p, esc)).join('')}
           </details>`
        : '';

      return `
        <div class="gq-diplo-plays-panel">
          <div class="gq-diplo-plays-panel__header">
            <span class="gq-diplo-plays-panel__title">
              🎭 Diplomatic Plays — ${esc(faction.icon ?? '')} ${esc(faction.name)}
            </span>
          </div>

          ${_axesHTML(trust, threat)}

          <div class="gq-play-active-list">
            ${activeHTML}
          </div>

          ${resolvedSection}

          <hr class="gq-diplo-plays-panel__divider" />

          ${_newPlayFormHTML(faction)}
        </div>`;
    }

    // ── Public render ───────────────────────────────────────────────────────

    async function render(containerEl, faction) {
      if (!containerEl || !faction) return;
      containerEl.innerHTML = '<div class="gq-play-loading">Loading diplomatic plays…</div>';

      let plays = [];
      let trust = 0;
      let threat = 0;

      try {
        const [listRes, axesRes] = await Promise.all([
          API.diplomaticPlaysList(faction.id),
          API.diplomaticPlaysTrustThreat(faction.id),
        ]);
        plays  = listRes.plays   || [];
        trust  = axesRes.trust   ?? 0;
        threat = axesRes.threat  ?? 0;
      } catch (_) {
        containerEl.innerHTML = '<p class="error text-sm">Failed to load diplomatic plays.</p>';
        return;
      }

      containerEl.innerHTML = _panelHTML(faction, plays, trust, threat);
      _bindEvents(containerEl, faction);
    }

    // ── Event binding ───────────────────────────────────────────────────────

    function _bindEvents(root, faction) {
      // Phase action buttons (counter_play, mobilize, resolve_deal, resolve_war, withdraw)
      root.querySelectorAll('.gq-play-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action  = String(btn.dataset.action || '');
          const play_id = Number(btn.dataset.id || 0);
          if (!action || !play_id) return;
          btn.disabled = true;
          await _handlePlayAction(root, faction, action, play_id);
        });
      });

      // New play form submission
      const form = root.querySelector('.gq-play-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const goal_type      = form.querySelector('[name=goal_type]')?.value || 'diplomatic';
          const demandsRaw     = form.querySelector('[name=player_demands]')?.value || '';
          const player_demands = demandsRaw
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
            .map((d) => ({ term: d, label: d }));
          const faction_id     = Number(form.dataset.factionId || 0);
          const submitBtn      = form.querySelector('.gq-play-form__submit');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const res = await API.diplomaticPlaysPropose({
              faction_id,
              goal_type,
              player_demands,
              faction_demands: [],
            });
            if (!res.success) {
              showToast(res.error || 'Failed to open play', 'error');
              if (submitBtn) submitBtn.disabled = false;
              return;
            }
            showToast('Diplomatic play opened in Cooperation phase! 🤝', 'success');
            await render(root, faction);
          } catch (err) {
            showToast(String(err), 'error');
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }
    }

    async function _handlePlayAction(root, faction, action, play_id) {
      try {
        let res;
        switch (action) {
          case 'counter_play':
            res = await API.diplomaticPlaysCounter({ play_id, counter_demands: [] });
            break;
          case 'mobilize':
            if (!confirm('Mobilize forces? This will escalate to Ultimatum and raise Threat.')) {
              const btn = root.querySelector(`.gq-play-btn[data-id="${play_id}"][data-action="mobilize"]`);
              if (btn) btn.disabled = false;
              return;
            }
            res = await API.diplomaticPlaysMobilize({ play_id });
            break;
          case 'resolve_deal':
            res = await API.diplomaticPlaysResolve({ play_id, choice: 'deal' });
            break;
          case 'resolve_war':
            if (!confirm('Declare war? This cannot be undone easily.')) {
              const btn = root.querySelector(`.gq-play-btn[data-id="${play_id}"][data-action="resolve_war"]`);
              if (btn) btn.disabled = false;
              return;
            }
            res = await API.diplomaticPlaysResolve({ play_id, choice: 'war' });
            break;
          case 'withdraw':
            res = await API.diplomaticPlaysResolve({ play_id, choice: 'withdrawal' });
            break;
          default:
            return;
        }

        if (!res.success) {
          showToast(res.error || 'Action failed', 'error');
          return;
        }

        const msg = _outcomeMessage(action, res);
        showToast(msg, res.outcome === 'war' ? 'error' : 'success');
        await render(root, faction);
      } catch (err) {
        showToast(String(err), 'error');
      }
    }

    function _outcomeMessage(action, res) {
      if (action === 'counter_play') return '⚠️ Threat issued — play escalated to Threat phase.';
      if (action === 'mobilize')     return '🔴 Forces mobilized — Ultimatum phase active!';
      if (action === 'resolve_deal') {
        if (res.outcome === 'war') return `💀 AI rejected the deal — war declared! Standing: ${res.standing_delta}`;
        return `✅ Deal reached! Standing: +${res.standing_delta ?? 0}, Trust: +${res.trust_delta ?? 0}`;
      }
      if (action === 'resolve_war')  return `💀 War declared! Standing: ${res.standing_delta ?? 0}`;
      if (action === 'withdraw')     return '↩️ Diplomatic play withdrawn.';
      return 'Done.';
    }

    return { render };
  }

  const api = { createDiplomaticPlaysPanel };
  if (typeof window !== 'undefined') {
    window.GQRuntimeDiplomaticPlaysPanel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
