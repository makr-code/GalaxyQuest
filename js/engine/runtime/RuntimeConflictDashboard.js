'use strict';

/**
 * RuntimeConflictDashboard.js — PHASE 4.4
 *
 * Unified Conflict Dashboard: aggregates war, pirate, and economy crisis data
 * into a single ranked threat overview.
 *
 * Usage:
 *   const controller = GQRuntimeConflictDashboard.createConflictDashboard({ wm, api, esc, gameLog, showToast });
 *   await controller.render();
 */

(function () {
  function createConflictDashboard(opts = {}) {
    const wm        = opts.wm;
    const api       = opts.api;
    const esc       = opts.esc       || ((v) => String(v ?? ''));
    const gameLog   = typeof opts.gameLog   === 'function' ? opts.gameLog   : () => {};
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : () => {};

    const S = {
      section: 'background:#171c28;border:1px solid #2e374e;border-radius:8px;padding:12px;',
      card: 'flex:1 1 130px;min-width:130px;background:#1f2533;border:1px solid #3a4762;border-radius:8px;padding:10px;',
      label: 'font-size:11px;color:#9fb0ce;',
      value: 'font-size:20px;font-weight:700;color:#e3efff;',
      hero: 'background:linear-gradient(135deg,#2a1722 0%,#171c28 48%,#10203a 100%);border:1px solid #3b4762;border-radius:10px;padding:14px;display:grid;gap:10px;',
      actionBtn: 'background:#2e374e;border:1px solid #4a5878;color:#d7e4ff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;',
      badge: (tone) => `display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${
        tone === 'critical' ? '#4e1010' : tone === 'high' ? '#4e3010' : tone === 'medium' ? '#3c3010' : '#1a2035'
      };color:${
        tone === 'critical' ? '#ff9980' : tone === 'high' ? '#ffc080' : tone === 'medium' ? '#ffe080' : '#9fb0ce'
      };`,
      meter: (pct, tone) => {
        const safe = Math.max(0, Math.min(100, Number(pct || 0)));
        const color = tone === 'critical' ? '#ff7f66' : tone === 'high' ? '#ffb066' : tone === 'medium' ? '#ffd36f' : '#8ac5ff';
        return `<div style="height:6px;background:#121826;border:1px solid #2a3450;border-radius:999px;overflow:hidden;">
                  <div style="height:100%;width:${safe}%;background:${color};box-shadow:0 0 10px ${color}99;"></div>
                </div>`;
      },
    };

    function _severityRank(tone) {
      if (tone === 'critical') return 4;
      if (tone === 'high') return 3;
      if (tone === 'medium') return 2;
      return 1;
    }

    function _severityLabel(tone) {
      if (tone === 'critical') return 'Critical';
      if (tone === 'high') return 'High';
      if (tone === 'medium') return 'Medium';
      return 'Low';
    }

    function _parseThreats(warData, piratesData, economyData) {
      const threats = [];

      // ── Wars ────────────────────────────────────────────────────────────────
      const wars = warData?.wars || [];
      for (const w of wars) {
        const pressure = Number(w.war_score_att || w.summary?.pressure || 0);
        threats.push({
          type: 'war',
          icon: '⚔',
          name: `War #${w.id}`,
          detail: `Score: ${Number(w.war_score_att || 0).toFixed(0)} / ${Number(w.war_score_def || 0).toFixed(0)}`,
          severity: pressure > 70 ? 'critical' : pressure > 40 ? 'high' : 'medium',
          score: pressure,
          action: null,
          warId: w.id,
        });
      }

      // ── Pirates ──────────────────────────────────────────────────────────────
      const pirateSummary = piratesData?.summary || {};
      const raidCount     = Number(pirateSummary.raids_last_24h || 0);
      const maxThreat     = Number(pirateSummary.max_threat_score || 0);
      if (maxThreat > 0 || raidCount > 0) {
        const severity = maxThreat >= 80 ? 'critical' : maxThreat >= 50 ? 'high' : raidCount > 0 ? 'medium' : 'low';
        threats.push({
          type: 'pirates',
          icon: '☠',
          name: 'Pirate Threat',
          detail: `Max threat ${maxThreat} | ${raidCount} raids/24h`,
          severity,
          score: maxThreat,
          action: null,
        });
      }

      // ── Economy ──────────────────────────────────────────────────────────────
      const warMods  = economyData?.war_modifiers || null;
      const pirateMult = Number(economyData?.pirate_damage_mult ?? 1);
      if (warMods) {
        const prodLoss = Math.round((1 - (warMods.production_mult ?? 1)) * 100);
        if (prodLoss > 0) {
          threats.push({
            type: 'economy',
            icon: '📉',
            name: 'War Economy Impact',
            detail: `Production −${prodLoss}% | Trade −${Math.round((1 - (warMods.trade_income_mult ?? 1)) * 100)}%`,
            severity: prodLoss >= 40 ? 'critical' : prodLoss >= 20 ? 'high' : 'medium',
            score: prodLoss,
            action: 'Activate War Economy policy to offset production losses.',
          });
        }
      }
      if (pirateMult < 0.95) {
        const dmgPct = Math.round((1 - pirateMult) * 100);
        threats.push({
          type: 'economy',
          icon: '🏚',
          name: 'Colony Raid Damage',
          detail: `Goods capacity −${dmgPct}% from unrepaired damage`,
          severity: dmgPct >= 30 ? 'high' : 'medium',
          score: dmgPct,
          action: 'Invest in pirate_damage_recovery repairs or increase defense budget.',
        });
      }

      // Sort by severity then score.
      threats.sort((a, b) => {
        const sev = _severityRank(b.severity) - _severityRank(a.severity);
        if (sev !== 0) return sev;
        return b.score - a.score;
      });
      return threats;
    }

    function _renderThreatRow(t) {
      const badge = S.badge(t.severity);
      return `
        <tr>
          <td style="padding:6px 4px;font-size:18px;">${t.icon}</td>
          <td style="padding:6px 4px;font-weight:700;">${esc(t.name)}</td>
          <td style="padding:6px 4px;"><span style="${badge}">${esc(t.severity)}</span></td>
          <td style="padding:6px 4px;font-size:11px;color:#9fb0ce;">${esc(t.detail)}</td>
          <td style="padding:6px 4px;font-size:11px;color:#f0c040;">${t.action ? esc(t.action) : '—'}</td>
        </tr>
      `;
    }

    function _recommendedActions(threats) {
      const byType = new Map();
      for (const t of threats) {
        if (!byType.has(t.type)) byType.set(t.type, t);
      }

      const actions = [];
      if (byType.has('war')) {
        actions.push({ label: 'Review War Goals', detail: 'Check score drift and active goal progress.', target: 'wars' });
      }
      if (byType.has('pirates')) {
        actions.push({ label: 'Negotiate Pirate Contract', detail: 'Open pirate panel and submit tribute/non-aggression offer.', target: 'pirates' });
      }
      if (byType.has('economy')) {
        actions.push({ label: 'Apply Economy Countermeasures', detail: 'Open economy panel and rebalance policy/tax/subsidies.', target: 'economy' });
      }
      if (!actions.length) {
        actions.push({ label: 'System Stable', detail: 'No urgent interventions required right now.', target: 'overview' });
      }
      return actions;
    }

    function _renderThreatCards(threats) {
      if (!threats.length) return '';
      return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">
        ${threats.slice(0, 4).map((t) => `
          <article style="background:#161d2b;border:1px solid #304060;border-radius:8px;padding:9px;display:grid;gap:6px;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
              <div style="font-size:13px;font-weight:700;">${t.icon} ${esc(t.name)}</div>
              <span style="${S.badge(t.severity)}">${_severityLabel(t.severity)}</span>
            </div>
            <div style="font-size:11px;color:#98abcf;min-height:30px;">${esc(t.detail)}</div>
            ${S.meter(t.score, t.severity)}
          </article>
        `).join('')}
      </div>`;
    }

    function _renderHtml(threats, warData, piratesData, economyData) {
      const warCount    = (warData?.wars || []).length;
      const raidCount   = Number(piratesData?.summary?.raids_last_24h || 0);
      const prodMult    = economyData?.war_modifiers?.production_mult ?? 1;
      const prodPct     = Math.round(prodMult * 100);
      const critCount   = threats.filter(t => t.severity === 'critical').length;
      const topThreat   = threats[0] || null;
      const urgency     = topThreat ? `${topThreat.icon} ${topThreat.name}` : 'No immediate threats';
      const actions     = _recommendedActions(threats);

      const headerCards = [
        { label: 'Active Wars',    value: warCount },
        { label: 'Raids (24h)',    value: raidCount },
        { label: 'Production',     value: `${prodPct}%` },
        { label: 'Critical Alerts',value: critCount },
      ];

      return `
        <div style="display:grid;gap:12px;">
          <section style="${S.hero}">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <div style="font-size:11px;color:#9fb0ce;text-transform:uppercase;letter-spacing:.08em;">Unified Conflict Center</div>
                <h3 style="margin:3px 0 0;color:#e5efff;font-size:18px;line-height:1.25;">${esc(urgency)}</h3>
              </div>
              <div style="display:flex;gap:7px;flex-wrap:wrap;">
                <button style="${S.actionBtn}" data-open-window="wars">⚔ War Room</button>
                <button style="${S.actionBtn}" data-open-window="pirates">☠ Pirate Ops</button>
                <button style="${S.actionBtn}" data-open-window="economy">📊 Economy</button>
                <button style="${S.actionBtn}" data-conflict-refresh="1">↻ Sync</button>
              </div>
            </div>
            ${topThreat ? `<div style="font-size:12px;color:#ffc88a;">${esc(topThreat.action || 'Maintain pressure and monitor trend changes.')}</div>` : '<div style="font-size:12px;color:#9fb0ce;">No emergency action required.</div>'}
          </section>

          <section style="display:flex;gap:8px;flex-wrap:wrap;">
            ${headerCards.map(c => `
              <div style="${S.card}">
                <div style="${S.label}">${esc(c.label)}</div>
                <div style="${S.value}">${esc(String(c.value))}</div>
              </div>
            `).join('')}
          </section>

          ${_renderThreatCards(threats)}

          <section style="${S.section}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <div style="font-weight:700;">Recommended Actions</div>
              <span style="font-size:11px;color:#8ea5ce;">Actionable based on current threat mix</span>
            </div>
            <div style="display:grid;gap:7px;margin-top:8px;">
              ${actions.map((a) => `
                <div style="display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;background:#141b29;border:1px solid #304060;border-radius:8px;padding:8px;">
                  <div>
                    <div style="font-size:12px;font-weight:700;color:#d7e4ff;">${esc(a.label)}</div>
                    <div style="font-size:11px;color:#9fb0ce;">${esc(a.detail)}</div>
                  </div>
                  <button style="${S.actionBtn}" data-open-window="${esc(a.target)}">Open</button>
                </div>
              `).join('')}
            </div>
          </section>

          <section style="${S.section}">
            <div style="font-weight:700;margin-bottom:8px;">Threat Overview — ranked by urgency</div>
            ${threats.length === 0
              ? '<p style="color:#9fb0ce;font-size:12px;">No active threats detected. Your empire is stable.</p>'
              : `<table style="width:100%;border-collapse:collapse;font-size:12px;">
                  <thead><tr>
                    <th style="padding:4px;border-bottom:1px solid #3a4762;"></th>
                    <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Threat</th>
                    <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Severity</th>
                    <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Details</th>
                    <th style="text-align:left;padding:4px;border-bottom:1px solid #3a4762;">Recommended Action</th>
                  </tr></thead>
                  <tbody>${threats.map(_renderThreatRow).join('')}</tbody>
                </table>`}
          </section>

          <section style="${S.section};padding:10px;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
              <div style="font-size:12px;color:#8ea5ce;">Tip: Use this panel as your command overlay and jump directly into subsystem windows via action buttons.</div>
              <button style="${S.actionBtn}" data-open-window="overview">Open Colony Overview</button>
            </div>
          </section>
        </div>
      `;
    }

    return {
      async render() {
        const root = wm && wm.body('conflict');
        if (!root) return;
        root.innerHTML = '<p style="color:#9fb0ce;padding:10px;">Loading conflict data…</p>';

        let warData = {}, piratesData = {}, economyData = {};
        try {
          [warData, piratesData, economyData] = await Promise.all([
            api.wars().catch(() => ({})),
            api.piratesStatus().catch(() => ({})),
            api.economyOverview().catch(() => ({})),
          ]);
        } catch (err) {
          gameLog('warn', 'ConflictDashboard load failed', err);
          root.innerHTML = '<p class="text-red">Failed to load conflict data.</p>';
          return;
        }

        const threats = _parseThreats(warData, piratesData, economyData);
        root.innerHTML = _renderHtml(threats, warData, piratesData, economyData);

        // Quick link buttons
        root.querySelectorAll('[data-open-window]').forEach(btn => {
          btn.addEventListener('click', () => {
            try { wm.open(btn.dataset.openWindow); } catch (_) {}
          });
        });
        root.querySelector('[data-conflict-refresh="1"]')?.addEventListener('click', () => {
          this.render();
        });
      },
    };
  }

  const api = { createConflictDashboard };
  if (typeof window !== 'undefined') {
    window.GQRuntimeConflictDashboard = api;
  }
})();
