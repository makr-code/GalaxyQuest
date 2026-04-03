/**
 * RuntimeAiSettingsPanel.js
 *
 * Binds LLM and NPC controller controls inside the settings panel.
 */

'use strict';

(function () {
  function bindAiSettingsPanel(opts = {}) {
    const {
      root = null,
      api = null,
      esc = (value) => String(value || ''),
      showToast = () => {},
    } = opts;

    if (!root || !api) return;

    const llmProfileSelect = root.querySelector('#set-llm-profile');
    const llmInputVars = root.querySelector('#set-llm-input-vars');
    const llmOutput = root.querySelector('#set-llm-output');
    const npcStatusLine = root.querySelector('#set-npc-status-line');
    const npcSummaryHours = root.querySelector('#set-npc-summary-hours');
    const npcSummaryOut = root.querySelector('#set-npc-summary');
    const npcDecisions = root.querySelector('#set-npc-decisions');

    const writeLlmOutput = (value) => {
      if (!llmOutput) return;
      llmOutput.value = String(value || '');
    };

    const writeNpcDecisions = (value) => {
      if (!npcDecisions) return;
      npcDecisions.value = String(value || '');
    };

    const writeNpcSummary = (value) => {
      if (!npcSummaryOut) return;
      npcSummaryOut.textContent = String(value || '');
    };

    const loadNpcControllerStatus = async () => {
      const res = await api.npcControllerStatus();
      if (!res.success) {
        if (npcStatusLine) npcStatusLine.textContent = `Fehler: ${String(res.error || 'Status konnte nicht geladen werden.')}`;
        return;
      }
      const controller = res.controller || {};
      const tick = res.tick || {};
      const metrics = res.metrics || {};
      const parts = [
        `enabled=${controller.enabled ? 'yes' : 'no'}`,
        `ollama=${controller.ollama_enabled ? 'yes' : 'no'}`,
        `cooldown=${Number(controller.cooldown_seconds || 0)}s`,
        `min_conf=${Number(controller.min_confidence || 0)}`,
        `last_tick=${tick.last_npc_tick || 'n/a'}`,
        `decisions_24h=${Number(metrics.decisions_last_24h || 0)}`,
      ];
      if (npcStatusLine) npcStatusLine.textContent = parts.join(' | ');
    };

    const loadNpcDecisions = async () => {
      const res = await api.npcControllerDecisions({ limit: 10 });
      writeNpcDecisions(JSON.stringify(res, null, 2));
      if (!res.success) showToast(res.error || 'NPC decisions konnten nicht geladen werden.', 'error');
    };

    const loadNpcSummary = async () => {
      const hours = Math.max(1, Math.min(168, Number(npcSummaryHours?.value || 24)));
      const res = await api.npcControllerSummary({ hours });
      if (!res.success) {
        writeNpcSummary(JSON.stringify(res, null, 2));
        showToast(res.error || 'NPC summary konnte nicht geladen werden.', 'error');
        return;
      }

      const metrics = res.metrics || {};
      const byAction = Array.isArray(res.by_action) ? res.by_action : [];
      const recentErrors = Array.isArray(res.recent_errors) ? res.recent_errors : [];
      const actionRows = byAction.map((row) => {
        const key = String(row.action_key || 'none');
        return `${key.padEnd(16, ' ')} total=${Number(row.total || 0)} exec=${Number(row.executed || 0)} err=${Number(row.errors || 0)} conf=${Number(row.avg_confidence || 0).toFixed(3)}`;
      });
      const errorRows = recentErrors.map((row) => {
        const when = String(row.created_at || 'n/a');
        const message = String(row.error_message || row.reasoning || 'error').replace(/\s+/g, ' ').slice(0, 140);
        return `- [${when}] ${message}`;
      });

      writeNpcSummary([
        `window_hours=${Number(res.window_hours || hours)}`,
        `faction_id=${Number(res.faction_id || 0)}`,
        `total=${Number(metrics.total || 0)} | executed=${Number(metrics.executed || 0)} | blocked=${Number(metrics.blocked || 0)} | errors=${Number(metrics.errors || 0)}`,
        `avg_confidence=${Number(metrics.avg_confidence || 0).toFixed(3)} | executed_ratio=${(Number(metrics.executed_ratio || 0) * 100).toFixed(1)}%`,
        '',
        'by_action:',
        ...(actionRows.length ? actionRows : ['(no rows)']),
        '',
        'recent_errors:',
        ...(errorRows.length ? errorRows : ['(none)']),
      ].join('\n'));
    };

    const loadLlmProfiles = async () => {
      if (!llmProfileSelect) return;
      llmProfileSelect.innerHTML = '<option value="">Lade...</option>';
      const res = await api.llmProfiles();
      if (!res.success) {
        llmProfileSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
        writeLlmOutput(res.error || 'LLM profile load failed.');
        return;
      }

      const profiles = Array.isArray(res.profiles) ? res.profiles : [];
      llmProfileSelect.innerHTML = profiles.length
        ? profiles.map((profile) => `<option value="${esc(profile.profile_key)}">${esc(profile.name)} (${esc(profile.profile_key)})</option>`).join('')
        : '<option value="">Keine Profile gefunden</option>';

      if (profiles.length && llmInputVars && !String(llmInputVars.value || '').trim()) {
        const first = profiles[0];
        const required = Array.isArray(first?.input_schema?.required) ? first.input_schema.required : [];
        const sample = {};
        required.forEach((key) => {
          sample[String(key)] = '';
        });
        llmInputVars.value = JSON.stringify(sample, null, 2);
      }

      writeLlmOutput(JSON.stringify({ loaded_profiles: profiles.length }, null, 2));
    };

    const readLlmInputVars = () => {
      const raw = String(llmInputVars?.value || '').trim();
      if (raw === '') return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Input vars must be a JSON object.');
      }
      return parsed;
    };

    root.querySelector('#set-llm-profiles-load')?.addEventListener('click', async () => {
      try {
        await loadLlmProfiles();
      } catch (err) {
        writeLlmOutput(String(err?.message || err || 'Failed to load profiles'));
      }
    });

    root.querySelector('#set-llm-compose')?.addEventListener('click', async () => {
      try {
        const profileKey = String(llmProfileSelect?.value || '').trim();
        if (!profileKey) {
          showToast('Bitte ein LLM-Profil auswaehlen.', 'warning');
          return;
        }
        const inputVars = readLlmInputVars();
        const res = await api.llmCompose({ profile_key: profileKey, input_vars: inputVars });
        writeLlmOutput(JSON.stringify(res, null, 2));
        if (!res.success) showToast(res.error || 'Compose fehlgeschlagen.', 'error');
      } catch (err) {
        writeLlmOutput(String(err?.message || err || 'Compose failed'));
        showToast('Compose fehlgeschlagen.', 'error');
      }
    });

    root.querySelector('#set-llm-run')?.addEventListener('click', async () => {
      try {
        const profileKey = String(llmProfileSelect?.value || '').trim();
        if (!profileKey) {
          showToast('Bitte ein LLM-Profil auswaehlen.', 'warning');
          return;
        }
        const inputVars = readLlmInputVars();
        writeLlmOutput('LLM Anfrage laeuft...');
        const res = await api.llmChatProfile({ profile_key: profileKey, input_vars: inputVars });
        writeLlmOutput(JSON.stringify(res, null, 2));
        if (res.success) showToast('LLM Antwort erhalten.', 'success');
        else showToast(res.error || 'LLM Anfrage fehlgeschlagen.', 'error');
      } catch (err) {
        writeLlmOutput(String(err?.message || err || 'LLM request failed'));
        showToast('LLM Anfrage fehlgeschlagen.', 'error');
      }
    });

    root.querySelector('#set-npc-refresh')?.addEventListener('click', async () => {
      try {
        await loadNpcControllerStatus();
        await loadNpcSummary();
      } catch (err) {
        if (npcStatusLine) npcStatusLine.textContent = String(err?.message || err || 'Status-Fehler');
      }
    });

    root.querySelector('#set-npc-load-summary')?.addEventListener('click', async () => {
      try {
        await loadNpcSummary();
      } catch (err) {
        writeNpcSummary(String(err?.message || err || 'Summary load failed'));
      }
    });

    root.querySelector('#set-npc-load-decisions')?.addEventListener('click', async () => {
      try {
        await loadNpcDecisions();
      } catch (err) {
        writeNpcDecisions(String(err?.message || err || 'Decision load failed'));
      }
    });

    root.querySelector('#set-npc-run-once')?.addEventListener('click', async () => {
      try {
        const res = await api.npcControllerRunOnce();
        if (res.success) {
          showToast(`NPC tick ausgefuehrt (+${Number(res.new_decision_logs || 0)} logs).`, 'success');
        } else {
          showToast(res.error || 'NPC tick fehlgeschlagen.', 'error');
        }
        await loadNpcControllerStatus();
        await loadNpcSummary();
        await loadNpcDecisions();
      } catch (_) {
        showToast('NPC tick fehlgeschlagen.', 'error');
      }
    });

    loadLlmProfiles().catch(() => {
      writeLlmOutput('LLM profile preload failed.');
    });
    loadNpcControllerStatus().catch(() => {
      if (npcStatusLine) npcStatusLine.textContent = 'NPC status preload failed.';
    });
    loadNpcSummary().catch(() => {
      writeNpcSummary('NPC summary preload failed.');
    });
    loadNpcDecisions().catch(() => {
      writeNpcDecisions('NPC decisions preload failed.');
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bindAiSettingsPanel };
  } else {
    window.GQRuntimeAiSettingsPanel = { bindAiSettingsPanel };
  }
})();