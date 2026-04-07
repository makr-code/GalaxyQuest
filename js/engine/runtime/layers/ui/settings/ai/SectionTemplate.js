/**
 * SectionTemplate.js
 *
 * Builds the LLM section markup for the settings window.
 */

'use strict';

(function () {
  function createSettingsLlmSectionTemplateBuilder() {
    function build() {
      return `
        <div class="system-row" style="margin-top:1rem;"><strong>LLM Prompt Profiles (SoC)</strong></div>
        <label class="system-row">Prompt-Profil</label>
        <select id="set-llm-profile">
          <option value="">Bitte laden...</option>
        </select>
        <label class="system-row">Input-Variablen (JSON)</label>
        <textarea id="set-llm-input-vars" rows="6" style="width:100%;resize:vertical;" placeholder='{"origin":"[1:100:7]","target":"[1:110:4]","mission":"attack","fleet_summary":"8 cruisers"}'></textarea>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.55rem;">
          <button id="set-llm-profiles-load" class="btn btn-secondary btn-sm" type="button">Profile laden</button>
          <button id="set-llm-compose" class="btn btn-secondary btn-sm" type="button">Prompt compose</button>
          <button id="set-llm-run" class="btn btn-primary btn-sm" type="button">LLM ausfuehren</button>
        </div>
        <label class="system-row" style="margin-top:0.6rem;">Ausgabe</label>
        <textarea id="set-llm-output" rows="8" style="width:100%;resize:vertical;" readonly></textarea>`;
    }

    return {
      build,
    };
  }

  const api = {
    createSettingsLlmSectionTemplateBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsLlmSectionTemplate = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
