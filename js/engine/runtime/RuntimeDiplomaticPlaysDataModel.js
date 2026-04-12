'use strict';
/**
 * RuntimeDiplomaticPlaysDataModel.js
 *
 * Pure data helpers for the Sprint 3.2 Diplomatic Plays 4-phase system.
 * No DOM dependency — usable in unit tests and server-side renderers.
 *
 * Exposed as window.GQRuntimeDiplomaticPlaysDataModel.
 */
(function () {

  // ── Phase definitions (Cooperation → Threat → Ultimatum → War) ─────────────

  const PHASES = [
    {
      key:         'cooperation',
      label:       'Cooperation',
      icon:        '🤝',
      color:       '#27ae60',
      description: 'Open diplomatic dialogue. Both sides exchange demands.',
      actionLabel: 'Issue Counter-Threat',
      nextPhase:   'threat',
    },
    {
      key:         'threat',
      label:       'Threat',
      icon:        '⚠️',
      color:       '#f0a500',
      description: 'Tensions escalate. Military mobilisation is threatened.',
      actionLabel: 'Mobilize Forces',
      nextPhase:   'ultimatum',
    },
    {
      key:         'ultimatum',
      label:       'Ultimatum',
      icon:        '🔴',
      color:       '#e74c3c',
      description: 'Final demand. Accept or face war.',
      actionLabel: 'Resolve Play',
      nextPhase:   'war',
    },
    {
      key:         'war',
      label:       'War',
      icon:        '💀',
      color:       '#7f0000',
      description: 'Armed conflict has begun.',
      actionLabel: null,
      nextPhase:   null,
    },
  ];

  const PHASE_INDEX = Object.fromEntries(PHASES.map((p, i) => [p.key, i]));

  // ── Goal types ──────────────────────────────────────────────────────────────

  const GOAL_TYPES = [
    { code: 'diplomatic',     label: 'Diplomatic Settlement', icon: '🕊️'  },
    { code: 'territorial',    label: 'Territorial Claim',     icon: '🗺️'  },
    { code: 'tribute',        label: 'Demand Tribute',        icon: '💎'  },
    { code: 'release_claims', label: 'Release Claims',        icon: '📜'  },
    { code: 'humiliation',    label: 'Public Humiliation',    icon: '😤'  },
  ];

  // ── Outcome labels ──────────────────────────────────────────────────────────

  const OUTCOME_META = {
    deal:         { label: 'Deal Reached',   icon: '✅', cls: 'outcome-deal'        },
    war:          { label: 'War Declared',   icon: '⚔️', cls: 'outcome-war'         },
    capitulation: { label: 'Capitulation',   icon: '🏳️', cls: 'outcome-capitulation' },
    withdrawal:   { label: 'Withdrawn',      icon: '↩️', cls: 'outcome-withdrawal'  },
  };

  // ── Phase helpers ───────────────────────────────────────────────────────────

  function getPhases() {
    return PHASES.slice();
  }

  function getPhase(key) {
    return PHASES.find((p) => p.key === String(key || '')) || null;
  }

  function phaseIndex(key) {
    return PHASE_INDEX[String(key || '')] ?? -1;
  }

  function getGoalTypes() {
    return GOAL_TYPES.slice();
  }

  function getGoalType(code) {
    return GOAL_TYPES.find((g) => g.code === String(code || '')) || null;
  }

  function outcomeMeta(outcome) {
    return OUTCOME_META[String(outcome || '')] || { label: String(outcome || '—'), icon: '❓', cls: 'outcome-unknown' };
  }

  // ── Trust / Threat rendering helpers ───────────────────────────────────────

  /**
   * Render Trust bar HTML.
   * trust  is −100..+100; normalised to 0..100 for the bar width.
   */
  function trustBarHTML(trust) {
    const v    = Math.max(-100, Math.min(100, Number(trust || 0)));
    const pct  = Math.round((v + 100) / 2);   // −100→0, 0→50, +100→100
    const color = v >= 30 ? '#27ae60' : v >= 0 ? '#f0a500' : '#e74c3c';
    const label = v > 0 ? `+${v}` : String(v);
    return `
      <div class="gq-trust-bar" title="Trust: ${label}">
        <span class="gq-trust-bar__label">🤝 Trust</span>
        <div class="gq-trust-bar__track">
          <div class="gq-trust-bar__fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="gq-trust-bar__value">${label}</span>
      </div>`;
  }

  /**
   * Render Threat bar HTML.
   * threat is 0..100.
   */
  function threatBarHTML(threat) {
    const v    = Math.max(0, Math.min(100, Number(threat || 0)));
    const color = v >= 70 ? '#e74c3c' : v >= 40 ? '#f0a500' : '#27ae60';
    return `
      <div class="gq-threat-bar" title="Threat: ${v}">
        <span class="gq-threat-bar__label">⚔️ Threat</span>
        <div class="gq-threat-bar__track">
          <div class="gq-threat-bar__fill" style="width:${v}%;background:${color}"></div>
        </div>
        <span class="gq-threat-bar__value">${v}</span>
      </div>`;
  }

  // ── Phase stepper HTML ──────────────────────────────────────────────────────

  /**
   * Renders a horizontal 4-step phase stepper.
   * @param {string} currentPhase – key of the active phase
   */
  function phaseStepperHTML(currentPhase) {
    const currentIdx = phaseIndex(currentPhase);
    const steps = PHASES.map((p, i) => {
      const done    = i < currentIdx;
      const active  = i === currentIdx;
      const cls     = done ? 'done' : active ? 'active' : 'pending';
      return `
        <div class="gq-phase-step gq-phase-step--${cls}" data-phase="${p.key}">
          <div class="gq-phase-step__icon" style="${active ? `color:${p.color}` : ''}">${p.icon}</div>
          <div class="gq-phase-step__label">${p.label}</div>
        </div>`;
    });

    const connectors = PHASES.slice(0, -1).map((_, i) => {
      const done = i < currentIdx;
      return `<div class="gq-phase-connector${done ? ' gq-phase-connector--done' : ''}"></div>`;
    });

    // Interleave steps and connectors
    const parts = [];
    steps.forEach((s, i) => {
      parts.push(s);
      if (i < connectors.length) parts.push(connectors[i]);
    });

    return `<div class="gq-phase-stepper">${parts.join('')}</div>`;
  }

  // ── Play card HTML ──────────────────────────────────────────────────────────

  /**
   * Renders a compact summary card for one play.
   * @param {object} play
   * @param {string} esc – escape function
   */
  function playCardHTML(play, esc) {
    const e      = typeof esc === 'function' ? esc : (v) => String(v ?? '');
    const phase  = getPhase(play.phase);
    const goal   = getGoalType(play.goal_type);
    const status = String(play.status || 'active');
    const outcome = play.outcome ? outcomeMeta(play.outcome) : null;

    const phaseColor = phase?.color || '#888';
    const goalIcon   = goal?.icon || '🎯';
    const goalLabel  = e(goal?.label || play.goal_type);

    return `
      <div class="gq-play-card gq-play-card--${e(status)}" style="--phase-color:${e(phaseColor)}">
        <div class="gq-play-card__header">
          <span class="gq-play-card__phase-icon">${phase ? e(phase.icon) : ''}</span>
          <span class="gq-play-card__phase-label" style="color:${e(phaseColor)}">${phase ? e(phase.label) : e(play.phase)}</span>
          <span class="gq-play-card__faction">${e(play.faction_icon ?? '')} ${e(play.faction_name ?? '')}</span>
          <span class="gq-play-card__goal">${goalIcon} ${goalLabel}</span>
          ${outcome ? `<span class="gq-play-chip gq-play-chip--${e(outcome.cls)}">${e(outcome.icon)} ${e(outcome.label)}</span>` : ''}
        </div>
        ${phaseStepperHTML(play.phase)}
        ${status === 'active' ? `
          <div class="gq-play-card__actions" data-play-id="${e(String(play.id))}">
            ${_actionButtonsHTML(play, e)}
          </div>` : ''}
      </div>`;
  }

  function _actionButtonsHTML(play, e) {
    const phase = play.phase;
    const id    = e(String(play.id));
    const buttons = [];

    if (phase === 'cooperation') {
      buttons.push(`<button class="btn btn-sm gq-play-btn gq-play-btn--counter" data-action="counter_play" data-id="${id}">⚠️ Issue Threat</button>`);
      buttons.push(`<button class="btn btn-sm gq-play-btn gq-play-btn--resolve-deal" data-action="resolve_deal" data-id="${id}">✅ Accept Deal</button>`);
    } else if (phase === 'threat') {
      buttons.push(`<button class="btn btn-sm gq-play-btn gq-play-btn--mobilize" data-action="mobilize" data-id="${id}">🔴 Mobilize (Ultimatum)</button>`);
      buttons.push(`<button class="btn btn-sm gq-play-btn gq-play-btn--resolve-deal" data-action="resolve_deal" data-id="${id}">✅ Negotiate Deal</button>`);
    } else if (phase === 'ultimatum') {
      buttons.push(`<button class="btn btn-sm gq-play-btn gq-play-btn--resolve-war" data-action="resolve_war" data-id="${id}">💀 Declare War</button>`);
      buttons.push(`<button class="btn btn-sm gq-play-btn gq-play-btn--resolve-deal" data-action="resolve_deal" data-id="${id}">✅ Last-Minute Deal</button>`);
      buttons.push(`<button class="btn btn-sm gq-play-btn gq-play-btn--withdraw" data-action="withdraw" data-id="${id}">↩️ Withdraw</button>`);
    }

    return buttons.join('\n');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  const api = {
    getPhases,
    getPhase,
    phaseIndex,
    getGoalTypes,
    getGoalType,
    outcomeMeta,
    trustBarHTML,
    threatBarHTML,
    phaseStepperHTML,
    playCardHTML,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeDiplomaticPlaysDataModel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
