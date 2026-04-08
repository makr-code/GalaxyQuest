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

  const api = {
    getTypes,
    getType,
    standingMeta,
    statusClass,
    acceptanceBarHTML,
    standingMeterHTML,
    filterByStatus,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeDiplomacyDataModel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
