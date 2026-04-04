/**
 * RuntimeSettingsNpcSectionTemplate.js
 *
 * Builds the NPC/PvE section markup for the settings window.
 */

'use strict';

(function () {
  function createSettingsNpcSectionTemplateBuilder() {
    function build() {
      return `
        <div class="system-row" style="margin-top:1rem;"><strong>NPC / PvE Controller</strong></div>
        <div class="system-row" id="set-npc-status-line" style="font-size:0.82rem;color:var(--text-muted)">Status wird geladen...</div>
        <div class="system-row" style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <label for="set-npc-summary-hours" style="margin:0;">Summary-Fenster</label>
          <select id="set-npc-summary-hours" style="max-width:140px;">
            <option value="6">6h</option>
            <option value="24" selected>24h</option>
            <option value="72">72h</option>
            <option value="168">168h</option>
          </select>
          <button id="set-npc-load-summary" class="btn btn-secondary btn-sm" type="button">Summary laden</button>
        </div>
        <pre id="set-npc-summary" style="margin:0.45rem 0 0;max-height:180px;overflow:auto;background:rgba(0,0,0,0.22);padding:0.5rem;border-radius:8px;font-size:0.78rem;">Wird geladen...</pre>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.45rem;">
          <button id="set-npc-refresh" class="btn btn-secondary btn-sm" type="button">Status aktualisieren</button>
          <button id="set-npc-run-once" class="btn btn-primary btn-sm" type="button">NPC Tick jetzt ausfuehren</button>
          <button id="set-npc-load-decisions" class="btn btn-secondary btn-sm" type="button">Entscheidungen laden</button>
        </div>
        <label class="system-row" style="margin-top:0.55rem;">NPC Decisions (letzte 10)</label>
        <textarea id="set-npc-decisions" rows="7" style="width:100%;resize:vertical;" readonly></textarea>`;
    }

    return {
      build,
    };
  }

  const api = {
    createSettingsNpcSectionTemplateBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsNpcSectionTemplate = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
