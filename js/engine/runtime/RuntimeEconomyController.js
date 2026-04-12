/**
 * RuntimeEconomyController.js
 *
 * Empire Economy Management window.
 * Tabs: Policy (global policy, taxes, subsidies) | Overview (colonies: goods + pop classes).
 */

'use strict';

(function () {
  const POLICY_LABELS = {
    free_market: 'Free Market',
    subsidies: 'Subsidies',
    mercantilism: 'Mercantilism',
    autarky: 'Autarky',
    war_economy: 'War Economy',
  };

  const POLICY_DESCRIPTIONS = {
    free_market: 'Minimal intervention — maximum trade income, lower happiness floor.',
    subsidies: 'State support boosts agri/research output at the cost of treasury.',
    mercantilism: 'Import restrictions, export focus — strong metal/crystal output.',
    autarky: 'Self-sufficiency. No trade bonuses, but reduced external risk.',
    war_economy: 'Maximises military production and ship throughput. Civilian morale penalty.',
  };

  const POP_LABELS = {
    colonist: 'Colonists',
    citizen: 'Citizens',
    specialist: 'Specialists',
    elite: 'Elite',
    transcendent: 'Transcendent',
  };

  const GOOD_ICONS = {
    food: '🌾',
    metal_alloys: '⚙',
    refined_crystal: '💎',
    deuterium_cells: '⚗',
    consumer_goods: '🛒',
    luxury_goods: '✨',
    military_hardware: '🔫',
    advanced_components: '🔬',
    default: '▣',
  };

  function createEconomyController(opts = {}) {
    const {
      wm       = null,
      api      = null,
      esc      = (v) => String(v ?? ''),
      gameLog  = () => {},
      showToast= () => {},
      invalidateGetCache = () => {},
    } = opts;

    let _state = {
      tab: 'policy',          // 'policy' | 'overview'
      policy: null,           // { global_policy, taxes:{income,production,trade}, subsidies:{agriculture,research,military} }
      overview: null,         // { colonies: [...] }
      popClasses: null,       // empire-wide aggregation
      loading: false,
      error: null,
    };

    // -----------------------------------------------------------------------
    // Data loading
    // -----------------------------------------------------------------------

    async function _loadPolicyTab() {
      const resp = await api.economyPolicy();
      if (!resp?.success) throw new Error(resp?.error || 'Economy policy request failed');
      _state.policy = {
        global_policy: resp.global_policy || 'free_market',
        taxes: resp.taxes || { income: 0, production: 0, trade: 0 },
        subsidies: resp.subsidies || { agriculture: false, research: false, military: false },
      };
    }

    async function _loadOverviewTab() {
      const [ovResp, popResp] = await Promise.all([
        api.economyOverview(),
        api.economyPopClasses(),
      ]);
      if (!ovResp?.success) throw new Error(ovResp?.error || 'Economy overview request failed');
      _state.overview = {
        colonies: ovResp.colonies || [],
        war_modifiers: ovResp.war_modifiers || null,
        pirate_damage_mult: ovResp.pirate_damage_mult ?? 1.0,
      };
      _state.popClasses = popResp?.success ? popResp : null;
    }

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------

    function _fmtPct(val) {
      return (Number(val) * 100).toFixed(0) + '%';
    }

    function _renderPolicyTab(policy) {
      const current = policy.global_policy || 'free_market';
      const policyBtns = Object.entries(POLICY_LABELS).map(([key, label]) => {
        const active = key === current ? ' economy-policy-btn--active' : '';
        const desc = esc(POLICY_DESCRIPTIONS[key] || '');
        return `<button class="economy-policy-btn${active}" data-policy="${esc(key)}" title="${desc}">${esc(label)}</button>`;
      }).join('');

      const taxRows = Object.entries(policy.taxes).map(([type, rate]) => {
        const pct = Math.round(Number(rate) * 100);
        const maxPctMap = { income: 40, production: 30, trade: 25 };
        const cap = maxPctMap[type] ?? 40;
        const label = type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ');
        return `<div class="economy-tax-row">
          <span class="economy-tax-label">${esc(label)} Tax</span>
          <input type="range" class="economy-tax-slider" data-tax-type="${esc(type)}"
            min="0" max="${cap}" step="1" value="${pct}" title="${pct}%">
          <span class="economy-tax-value" data-tax-display="${esc(type)}">${pct}%</span>
        </div>`;
      }).join('');

      const subsidyRows = Object.entries(policy.subsidies).map(([sector, enabled]) => {
        const checked = enabled ? ' checked' : '';
        const label = sector.charAt(0).toUpperCase() + sector.slice(1);
        return `<label class="economy-subsidy-row">
          <input type="checkbox" class="economy-subsidy-check" data-subsidy-sector="${esc(sector)}"${checked}>
          <span>${esc(label)}</span>
        </label>`;
      }).join('');

      return `<div class="economy-section">
        <div class="system-row" style="margin-bottom:.5rem"><strong>Global Economic Policy</strong></div>
        <div class="economy-policy-btns">${policyBtns}</div>
        <p class="economy-policy-desc text-muted" id="economy-policy-desc">${esc(POLICY_DESCRIPTIONS[current] || '')}</p>
      </div>
      <div class="economy-section" style="margin-top:1rem">
        <div class="system-row" style="margin-bottom:.5rem"><strong>Tax Rates</strong></div>
        ${taxRows}
      </div>
      <div class="economy-section" style="margin-top:1rem">
        <div class="system-row" style="margin-bottom:.5rem"><strong>Subsidies</strong></div>
        <div class="economy-subsidies">${subsidyRows}</div>
      </div>
      ${_renderPolicyEffectsPanel(policy)}`;
    }

    function _renderPopBadge(classes) {
      if (!classes || typeof classes !== 'object') return '';
      return Object.entries(classes)
        .filter(([, v]) => v?.count > 0)
        .map(([cls, v]) => `<span class="economy-pop-badge" title="${esc(POP_LABELS[cls] || cls)}: satisfaction ${v.satisfaction_ticks ?? '?'}">${esc(POP_LABELS[cls] || cls)}: ${v.count}</span>`)
        .join(' ');
    }

    // PHASE 2.3 – Active policy production effects panel (shown in Policy tab)
    function _renderPolicyEffectsPanel(policy) {
      const p = policy?.global_policy || 'free_market';
      const subs = policy?.subsidies || {};
      const lines = [];

      if (p === 'war_economy') {
        lines.push({ label: 'Military Equipment output', val: '+30%', tone: 'is-good' });
        lines.push({ label: 'Consumer Goods output', val: '−20%', tone: 'is-critical' });
        lines.push({ label: 'Happiness modifier', val: '−10', tone: 'is-critical' });
      } else if (p === 'autarky') {
        lines.push({ label: 'All domestic production', val: '+10%', tone: 'is-good' });
        lines.push({ label: 'Market imports', val: 'BLOCKED', tone: 'is-critical' });
      } else if (p === 'mercantilism') {
        lines.push({ label: 'Import cost surcharge', val: '+20%', tone: 'is-warning' });
        lines.push({ label: 'Export earnings bonus', val: '+20%', tone: 'is-good' });
      } else if (p === 'subsidies') {
        lines.push({ label: 'Factory build cost', val: '−20%', tone: 'is-good' });
        lines.push({ label: 'Credits income', val: '−10%', tone: 'is-warning' });
      } else if (p === 'free_market') {
        lines.push({ label: 'Credits income bonus', val: '+15%', tone: 'is-good' });
        lines.push({ label: 'Trade speed', val: '+10%', tone: 'is-good' });
      }

      if (subs.agriculture) lines.push({ label: 'Agriculture output (biocompost)', val: '+20%', tone: 'is-good' });
      if (subs.research)    lines.push({ label: 'Research output (research kits)', val: '+20%', tone: 'is-good' });
      if (subs.military)    lines.push({ label: 'Military output (equipment)', val: '+20%', tone: 'is-good' });

      if (!lines.length) return '';
      const rows = lines.map(({ label, val, tone }) =>
        `<div class="economy-effect-row" style="display:flex;justify-content:space-between;font-size:12px;line-height:1.6">
          <span class="text-muted">${esc(label)}</span>
          <span class="badge ${esc(tone)}" style="font-size:11px">${esc(val)}</span>
        </div>`
      ).join('');
      return `<div class="economy-section" style="margin-top:1rem">
        <div class="system-row" style="margin-bottom:.5rem"><strong>Active Policy Effects</strong></div>
        <div class="economy-effects-list">${rows}</div>
      </div>`;
    }

    // PHASE 4.2 – Conflict-driven production warning banner
    function _renderConflictWarnings(warMods, pirateMult) {
      const bits = [];
      if (warMods) {
        const prodPct  = Math.round((1 - (warMods.production_mult   ?? 1)) * 100);
        const tradePct = Math.round((1 - (warMods.trade_income_mult ?? 1)) * 100);
        const taxPct   = Math.round((1 - (warMods.tax_efficiency_mult ?? 1)) * 100);
        if (prodPct > 0)  bits.push(`\u2694 War: production \u2212${prodPct}%`);
        if (tradePct > 0) bits.push(`\u2694 War: trade income \u2212${tradePct}%`);
        if (taxPct > 0)   bits.push(`\u2694 War: tax efficiency \u2212${taxPct}%`);
        if ((warMods.production_mult ?? 1) >= 1.1)
          bits.push(`\u2694 War Economy policy: production +${Math.round(((warMods.production_mult ?? 1) - 1) * 100)}%`);
      }
      const pirateLoss = Math.round((1 - (pirateMult ?? 1)) * 100);
      if (pirateLoss > 0) bits.push(`\u2620 Pirate damage: goods capacity \u2212${pirateLoss}%`);
      if (!bits.length) return '';
      return `<div class="economy-conflict-warnings" style="background:#2a1f0a;border:1px solid #7a5c1a;border-radius:6px;padding:.5rem .75rem;margin-bottom:.75rem;line-height:1.7;font-size:12px;">${bits.map(b => `<div>${esc(b)}</div>`).join('')}</div>`;
    }

    function _renderGoodsRow(goods) {
      if (!goods || !Object.keys(goods).length) return '<span class="text-muted">— no processed goods —</span>';
      return Object.entries(goods).map(([good, data]) => {
        const icon = GOOD_ICONS[good] || GOOD_ICONS.default;
        const qty = Number(data.quantity ?? 0).toFixed(0);
        const cap = Number(data.capacity ?? 0).toFixed(0);
        const pct = data.capacity > 0 ? Math.min(100, Math.round((data.quantity / data.capacity) * 100)) : 0;
        const tone = pct >= 80 ? 'is-good' : (pct < 25 ? 'is-critical' : 'is-warning');
        const label = good.replace(/_/g, ' ');
        return `<span class="economy-good-chip ${tone}" title="${esc(label)}: ${qty}/${cap}">${icon} ${qty}</span>`;
      }).join(' ');
    }

    function _renderOverviewTab(colonies, popClasses, warMods, pirateMult) {
      const warningHtml = _renderConflictWarnings(warMods, pirateMult);

      if (!colonies.length) {
        return warningHtml + '<p class="text-muted">No colonies found.</p>';
      }

      // Empire-wide pop summary
      let empirePopHtml = '';
      if (popClasses?.pop_classes && Object.keys(popClasses.pop_classes).length) {
        const total = Object.values(popClasses.pop_classes).reduce((s, v) => s + (v.total_count ?? 0), 0);
        empirePopHtml = `<div class="system-card" style="margin-bottom:1rem">
          <div class="system-row">
            <strong>Empire Population</strong>
            <span class="badge is-neutral">${total.toLocaleString()} total</span>
          </div>
          <div class="economy-pop-row">${Object.entries(popClasses.pop_classes).map(([cls, v]) =>
            `<span class="economy-pop-badge">${esc(POP_LABELS[cls] || cls)}: ${v.total_count ?? 0}</span>`
          ).join(' ')}</div>
        </div>`;
      }

      const colonyCards = colonies.map((col) => {
        const loc = col.location ? `G${col.location.galaxy} S${col.location.system} P${col.location.pos}` : '';
        const goodsHtml = _renderGoodsRow(col.goods || {});
        const popHtml = _renderPopBadge(col.pop_classes || {});
        const methodEntries = Object.entries(col.methods || {});
        const methodsHtml = methodEntries.length
          ? methodEntries.map(([bt, m]) => `<span class="economy-method-chip" title="${esc(bt)}">${esc(m)}</span>`).join(' ')
          : '<span class="text-muted">—</span>';

        return `<div class="system-card economy-colony-card">
          <div class="system-row">
            <strong>${esc(col.name || 'Colony')}</strong>
            <span class="tag">${esc(col.type || '')}</span>
            <span class="text-muted" style="font-size:.8rem">${esc(loc)}</span>
            <span class="text-muted" style="font-size:.8rem">pop: ${(col.population || 0).toLocaleString()}</span>
          </div>
          <div class="economy-colony-detail">
            <div class="economy-detail-row"><span class="economy-detail-label">Goods:</span><span>${goodsHtml}</span></div>
            <div class="economy-detail-row"><span class="economy-detail-label">Methods:</span><span>${methodsHtml}</span></div>
            ${popHtml ? `<div class="economy-detail-row"><span class="economy-detail-label">Classes:</span><span>${popHtml}</span></div>` : ''}
          </div>
        </div>`;
      }).join('');

      return warningHtml + empirePopHtml + colonyCards;
    }

    function _renderSkeleton() {
      return `<div class="system-card" style="height:2.4rem;animation:skeleton-pulse 1.2s ease infinite;"></div>
              <div class="system-card" style="height:2.4rem;margin-top:.5rem;animation:skeleton-pulse 1.2s ease infinite .2s;"></div>`;
    }

    function _renderError(msg) {
      return `<p class="text-red" style="padding:.5rem 0">⚠ ${esc(msg)}</p>`;
    }

    function _buildFullHtml(state) {
      const tabPolicy = state.tab === 'policy' ? ' economy-tab--active' : '';
      const tabOverview = state.tab === 'overview' ? ' economy-tab--active' : '';

      let contentHtml;
      if (state.loading) {
        contentHtml = _renderSkeleton();
      } else if (state.error) {
        contentHtml = _renderError(state.error);
      } else if (state.tab === 'policy' && state.policy) {
        contentHtml = _renderPolicyTab(state.policy);
      } else if (state.tab === 'overview' && state.overview) {
        contentHtml = _renderOverviewTab(
          state.overview.colonies,
          state.popClasses,
          state.overview.war_modifiers,
          state.overview.pirate_damage_mult,
        );
      } else {
        contentHtml = _renderSkeleton();
      }

      return `<div class="economy-ctrl">
        <div class="economy-tabs">
          <button class="economy-tab${tabPolicy}" data-economy-tab="policy">Policy</button>
          <button class="economy-tab${tabOverview}" data-economy-tab="overview">Colony Overview</button>
        </div>
        <div class="economy-tab-content">
          ${contentHtml}
        </div>
      </div>`;
    }

    // -----------------------------------------------------------------------
    // Event wiring
    // -----------------------------------------------------------------------

    function _attachPolicyListeners(root) {
      // Tab switcher
      root.querySelectorAll('[data-economy-tab]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          _state.tab = btn.dataset.economyTab;
          await render();
        });
      });

      // Policy selector
      root.querySelectorAll('[data-policy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const policy = btn.dataset.policy;
          try {
            btn.disabled = true;
            const resp = await api.setEconomyPolicy(policy);
            if (!resp?.success) throw new Error(resp?.error || 'Failed to set policy');
            invalidateGetCache('economy policy');
            _state.policy.global_policy = policy;
            showToast(`Economic policy changed to ${POLICY_LABELS[policy] || policy}`);
            await render();
          } catch (err) {
            showToast('Failed to change policy: ' + String(err?.message || err), 'error');
            gameLog('warn', 'setEconomyPolicy failed', err);
            btn.disabled = false;
          }
        });
      });

      // Tax sliders
      root.querySelectorAll('.economy-tax-slider').forEach((slider) => {
        const type = slider.dataset.taxType;
        const display = root.querySelector(`[data-tax-display="${type}"]`);

        // Live preview
        slider.addEventListener('input', () => {
          if (display) display.textContent = slider.value + '%';
        });

        // Commit on release
        slider.addEventListener('change', async () => {
          const rate = Number(slider.value) / 100;
          try {
            const resp = await api.setEconomyTax(type, rate);
            if (!resp?.success) throw new Error(resp?.error || 'Failed to set tax');
            invalidateGetCache('economy policy');
            _state.policy.taxes[type] = resp.rate ?? rate;
            showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} tax set to ${_fmtPct(resp.rate ?? rate)}`);
          } catch (err) {
            showToast('Failed to set tax: ' + String(err?.message || err), 'error');
            gameLog('warn', 'setEconomyTax failed', err);
          }
        });
      });

      // Subsidy checkboxes
      root.querySelectorAll('.economy-subsidy-check').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const sector = cb.dataset.subsidySector;
          const enabled = cb.checked;
          cb.disabled = true;
          try {
            const resp = await api.setEconomySubsidy(sector, enabled);
            if (!resp?.success) throw new Error(resp?.error || 'Failed to set subsidy');
            invalidateGetCache('economy policy');
            _state.policy.subsidies[sector] = enabled;
            showToast(`${sector.charAt(0).toUpperCase() + sector.slice(1)} subsidy ${enabled ? 'enabled' : 'disabled'}`);
          } catch (err) {
            showToast('Failed to toggle subsidy: ' + String(err?.message || err), 'error');
            gameLog('warn', 'setEconomySubsidy failed', err);
            cb.checked = !enabled; // revert
          } finally {
            cb.disabled = false;
          }
        });
      });
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    async function render() {
      const root = wm?.body('economy');
      if (!root) return;

      // First paint with current state
      root.innerHTML = _buildFullHtml(_state);
      _attachPolicyListeners(root);
      // Bind View Hyperlinks for navigation
      const ViewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
      if (ViewHyperlinks) ViewHyperlinks.bindAll(root);

      if (!_state.loading && !_state.policy && _state.tab === 'policy') {
        _state.loading = true;
        root.innerHTML = _buildFullHtml(_state);
        try {
          await _loadPolicyTab();
          _state.loading = false;
          _state.error = null;
        } catch (err) {
          _state.loading = false;
          _state.error = String(err?.message || err);
          gameLog('warn', 'Economy policy load failed', err);
        }
        root.innerHTML = _buildFullHtml(_state);
        _attachPolicyListeners(root);
      }

      if (!_state.loading && !_state.overview && _state.tab === 'overview') {
        _state.loading = true;
        root.innerHTML = _buildFullHtml(_state);
        try {
          await _loadOverviewTab();
          _state.loading = false;
          _state.error = null;
        } catch (err) {
          _state.loading = false;
          _state.error = String(err?.message || err);
          gameLog('warn', 'Economy overview load failed', err);
        }
        root.innerHTML = _buildFullHtml(_state);
        _attachPolicyListeners(root);
      }
    }

    async function refresh() {
      _state.policy   = null;
      _state.overview = null;
      _state.popClasses = null;
      _state.error    = null;
      await render();
    }

    return { render, refresh };
  }

  const api = { createEconomyController };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeEconomyController = api;
  }
})();
