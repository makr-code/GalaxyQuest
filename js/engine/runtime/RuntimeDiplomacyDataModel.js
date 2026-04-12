'use strict';
/**
 * RuntimeDiplomacyDataModel.js
 *
 * Pure data helpers for the faction agreement (treaty) system.
 * No DOM / WM dependency — can be used in tests directly.
 */
(function () {
  const AGREEMENT_TYPES = [
    {
      code: 'non_aggression',
      label: 'Non-Aggression Pact',
      icon: '🤝',
      minStanding: -30,
      standingReward: 8,
      defaultDuration: 3,
      color: '#4a90d9',
    },
    {
      code: 'trade',
      label: 'Trade Agreement',
      icon: '💰',
      minStanding: -10,
      standingReward: 12,
      defaultDuration: 3,
      color: '#f0a500',
    },
    {
      code: 'research',
      label: 'Research Agreement',
      icon: '🔬',
      minStanding: 10,
      standingReward: 15,
      defaultDuration: 6,
      color: '#a855f7',
    },
    {
      code: 'alliance',
      label: 'Military Alliance',
      icon: '⚔️',
      minStanding: 50,
      standingReward: 25,
      defaultDuration: null,
      color: '#e74c3c',
    },
  ];

  function getTypes() {
    return AGREEMENT_TYPES.slice();
  }

  function getType(code) {
    return AGREEMENT_TYPES.find((t) => t.code === String(code || '')) || null;
  }

  /** Standing → { cls, label } */
  function standingMeta(value) {
    const v = Number(value || 0);
    if (v >= 50)  return { cls: 'chip-allied',   label: 'Allied'   };
    if (v >= 10)  return { cls: 'chip-friendly',  label: 'Friendly' };
    if (v >= -10) return { cls: 'chip-neutral',   label: 'Neutral'  };
    if (v >= -50) return { cls: 'chip-hostile',   label: 'Hostile'  };
    return             { cls: 'chip-war',         label: 'War'      };
  }

  /** Map status → CSS class suffix */
  function statusClass(status) {
    switch (String(status || '')) {
      case 'active':    return 'active';
      case 'proposed':  return 'proposed';
      case 'rejected':  return 'rejected';
      case 'cancelled': return 'cancelled';
      case 'expired':   return 'expired';
      default:          return 'unknown';
    }
  }

  /** Render a bar for the acceptance probability (0–100). */
  function acceptanceBarHTML(pct) {
    const p = Math.max(0, Math.min(100, Number(pct || 0)));
    const color = p >= 70 ? '#27ae60' : p >= 40 ? '#f0a500' : '#e74c3c';
    return `
      <div class="gq-ai-confidence" title="AI acceptance likelihood: ${p}%">
        <div class="gq-ai-confidence__bar" style="width:${p}%;background:${color}"></div>
        <span class="gq-ai-confidence__pct">${p}%</span>
      </div>`;
  }

  /** Render an animated standing meter with optional delta overlay. */
  function standingMeterHTML(currentStanding, delta) {
    const pct = Math.round((Number(currentStanding || 0) + 100) / 2);  // −100..+100 → 0..100
    const d   = Number(delta || 0);
    const dPct = Math.round(Math.abs(d) / 2);
    const positive = d >= 0;
    const meta = standingMeta(currentStanding);
    return `
      <div class="gq-standing-meter" title="Standing: ${currentStanding}${d ? ` (${positive ? '+' : ''}${d} after agreement)` : ''}">
        <div class="gq-standing-meter__track">
          <div class="gq-standing-meter__fill ${meta.cls}" style="width:${pct}%"></div>
          ${d ? `<div class="gq-standing-meter__delta ${positive ? 'positive' : 'negative'}"
                      style="${positive ? 'left' : 'right'}:${100 - pct}%;width:${dPct}%"></div>` : ''}
        </div>
        <span class="gq-standing-meter__label">${meta.label} (${currentStanding > 0 ? '+' : ''}${currentStanding})</span>
      </div>`;
  }

  /** Filter agreements by status. */
  function filterByStatus(agreements, ...statuses) {
    const set = new Set(statuses.map(String));
    return (agreements || []).filter((a) => set.has(String(a.status || '')));
  }

  // ── Trust / Threat helpers ────────────────────────────────────────────────

  /**
   * Trust value (0–100) → { cls, label }
   * Used for coloring the trust bar and chip.
   */
  function trustMeta(value) {
    const v = Math.max(0, Math.min(100, Number(value || 0)));
    if (v >= 75) return { cls: 'trust-high',    label: 'High Trust'    };
    if (v >= 40) return { cls: 'trust-moderate', label: 'Moderate Trust' };
    if (v >= 15) return { cls: 'trust-low',      label: 'Low Trust'     };
    return             { cls: 'trust-none',      label: 'No Trust'      };
  }

  /**
   * Threat value (0–100) → { cls, label }
   * Used for coloring the threat bar and chip.
   */
  function threatMeta(value) {
    const v = Math.max(0, Math.min(100, Number(value || 0)));
    if (v >= 75) return { cls: 'threat-critical', label: 'Critical Threat' };
    if (v >= 50) return { cls: 'threat-high',     label: 'High Threat'     };
    if (v >= 25) return { cls: 'threat-moderate', label: 'Moderate Threat' };
    return             { cls: 'threat-low',       label: 'Low Threat'      };
  }

  /**
   * Derive the combined diplomatic stance from trust + threat values.
   * Mirrors the table in COMBAT_SYSTEM_DESIGN.md §6.1.
   */
  function diploStance(trust, threat) {
    const t = Math.max(0, Math.min(100, Number(trust  || 0)));
    const h = Math.max(0, Math.min(100, Number(threat || 0)));
    if (t >= 75 && h < 20) return { code: 'ALLY',     label: 'Ally',     cls: 'stance-ally'     };
    if (t >= 40 && h < 40) return { code: 'FRIENDLY', label: 'Friendly', cls: 'stance-friendly' };
    if (h >= 75)           return { code: 'HOSTILE',  label: 'Hostile',  cls: 'stance-hostile'  };
    if (h >= 50)           return { code: 'TENSE',    label: 'Tense',    cls: 'stance-tense'    };
    return                        { code: 'NEUTRAL',  label: 'Neutral',  cls: 'stance-neutral'  };
  }

  /**
   * Render dual trust/threat progress bars plus the combined stance chip.
   *
   * @param {number} trust  0–100
   * @param {number} threat 0–100
   * @returns {string} HTML fragment
   */
  function trustThreatBarsHTML(trust, threat) {
    const t   = Math.max(0, Math.min(100, Number(trust  || 0)));
    const h   = Math.max(0, Math.min(100, Number(threat || 0)));
    const tm  = trustMeta(t);
    const hm  = threatMeta(h);
    const stance = diploStance(t, h);

    const trustColor  = t >= 75 ? '#27ae60' : t >= 40 ? '#f0a500' : t >= 15 ? '#aaa' : '#666';
    const threatColor = h >= 75 ? '#e74c3c' : h >= 50 ? '#e67e22' : h >= 25 ? '#f0a500' : '#888';

    return `
      <div class="gq-trust-threat-bars" title="Trust: ${t} | Threat: ${h} | Stance: ${stance.label}">
        <div class="gq-axis-row">
          <span class="gq-axis-label">🤝 Trust</span>
          <div class="gq-axis-track">
            <div class="gq-axis-fill gq-axis-fill--trust ${tm.cls}" style="width:${t}%;background:${trustColor}"></div>
          </div>
          <span class="gq-axis-value">${Math.round(t)}</span>
        </div>
        <div class="gq-axis-row">
          <span class="gq-axis-label">⚠️ Threat</span>
          <div class="gq-axis-track">
            <div class="gq-axis-fill gq-axis-fill--threat ${hm.cls}" style="width:${h}%;background:${threatColor}"></div>
          </div>
          <span class="gq-axis-value">${Math.round(h)}</span>
        </div>
        <div class="gq-stance-chip ${stance.cls}">${stance.label}</div>
      </div>`;
  }

  const api = {
    getTypes,
    getType,
    standingMeta,
    statusClass,
    acceptanceBarHTML,
    standingMeterHTML,
    filterByStatus,
    trustMeta,
    threatMeta,
    diploStance,
    trustThreatBarsHTML,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeDiplomacyDataModel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
