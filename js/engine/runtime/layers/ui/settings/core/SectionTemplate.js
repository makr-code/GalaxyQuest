/**
 * SectionTemplate.js
 *
 * Builds the main settings card markup (navigation + audio + injected sections).
 */

'use strict';

(function () {
  function createSettingsCoreSectionTemplateBuilder() {
    function build(opts = {}) {
      const settingsState = opts.settingsState || {};
      const audioState = opts.audioState || {};
      const musicTrackOptions = String(opts.musicTrackOptions || '');
      const sfxRows = String(opts.sfxRows || '');
      const lastAudioEventLabel = String(opts.lastAudioEventLabel || '');
      const llmSectionHtml = String(opts.llmSectionHtml || '');
      const npcSectionHtml = String(opts.npcSectionHtml || '');
      const esc = typeof opts.esc === 'function' ? opts.esc : ((value) => String(value || ''));

      return `
      <div class="system-card">
        <h3 style="margin-top:0">Einstellungen</h3>
        <div class="system-row"><strong>Navigation & Transition</strong></div>
        <label class="system-row">Transition-Preset</label>
        <select id="set-transition-preset">
          <option value="smooth" ${settingsState.transitionPreset === 'smooth' ? 'selected' : ''}>Smooth</option>
          <option value="balanced" ${settingsState.transitionPreset === 'balanced' ? 'selected' : ''}>Balanced</option>
          <option value="snappy" ${settingsState.transitionPreset === 'snappy' ? 'selected' : ''}>Snappy</option>
        </select>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-auto-transitions" ${settingsState.autoTransitions ? 'checked' : ''} />
          Auto-Transitions aktivieren
        </label>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-galaxy-fleet-vectors" ${settingsState.galaxyFleetVectorsVisible !== false ? 'checked' : ''} />
          Galaxy: Fleet-Marker und Fluglinien anzeigen
        </label>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-home-enter-system" ${settingsState.homeEnterSystem ? 'checked' : ''} />
          Home-Navigation öffnet direkt Systemansicht
        </label>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-system-legacy-fallback" ${settingsState.systemViewLegacyFallback === true ? 'checked' : ''} />
          System Legacy Fallback (direkte enter/exitSystemView-Calls erlauben)
        </label>
        <label class="system-row">Persistente Hover-Distanz: <span id="set-hover-distance-value">${Math.round(settingsState.persistentHoverDistance)}</span></label>
        <input id="set-hover-distance" type="range" min="120" max="380" step="5" value="${Math.round(settingsState.persistentHoverDistance)}" />
        <label class="system-row">Transition-Ruhezeit (ms): <span id="set-transition-ms-value">${Math.round(settingsState.transitionStableMinMs)}</span></label>
        <input id="set-transition-ms" type="range" min="80" max="360" step="10" value="${Math.round(settingsState.transitionStableMinMs)}" />

        <div class="system-row" style="margin-top:0.9rem;"><strong>Audio</strong></div>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-master-mute" ${audioState.masterMuted ? 'checked' : ''} />
          Ton aus
        </label>
        <label class="system-row">Master: <span id="set-master-vol-value">${Math.round((audioState.masterVolume || 0) * 100)}</span>%</label>
        <input id="set-master-vol" type="range" min="0" max="100" step="1" value="${Math.round((audioState.masterVolume || 0) * 100)}" />

        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-music-mute" ${audioState.musicMuted ? 'checked' : ''} />
          Musik stumm
        </label>
        <label class="system-row">Musik: <span id="set-music-vol-value">${Math.round((audioState.musicVolume || 0) * 100)}</span>%</label>
        <input id="set-music-vol" type="range" min="0" max="100" step="1" value="${Math.round((audioState.musicVolume || 0) * 100)}" />

        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-sfx-mute" ${audioState.sfxMuted ? 'checked' : ''} />
          SFX stumm
        </label>
        <label class="system-row">SFX: <span id="set-sfx-vol-value">${Math.round((audioState.sfxVolume || 0) * 100)}</span>%</label>
        <input id="set-sfx-vol" type="range" min="0" max="100" step="1" value="${Math.round((audioState.sfxVolume || 0) * 100)}" />
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-tts-mute" ${audioState.ttsMuted ? 'checked' : ''} />
          Sprachausgabe stumm
        </label>
        <label class="system-row">Sprachausgabe: <span id="set-tts-vol-value">${Math.round((audioState.ttsVolume || 0.95) * 100)}</span>%</label>
        <input id="set-tts-vol" type="range" min="0" max="100" step="1" value="${Math.round((audioState.ttsVolume || 0.95) * 100)}" />
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;">
          <input type="checkbox" id="set-tts-auto-voice" ${settingsState.ttsAutoVoice !== false ? 'checked' : ''} />
          Automatische Sprachausgabe fuer Hinweise, Nachrichten und NPC-Dialoge
        </label>
        <div class="system-row" style="font-size:0.8rem;color:var(--text-muted)">Letztes Audio-Event: <span id="set-last-audio-event">${lastAudioEventLabel}</span></div>

        <label class="system-row" style="margin-top:0.75rem;">Musik-URL (optional)</label>
        <input id="set-music-url" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.musicUrl || '')}" />
        <label class="system-row">Track-Transition</label>
        <select id="set-music-transition-mode">
          <option value="fade" ${String(audioState.musicTransitionMode || settingsState.musicTransitionMode || 'fade') === 'fade' ? 'selected' : ''}>Fade (nahtlos)</option>
          <option value="cut" ${String(audioState.musicTransitionMode || settingsState.musicTransitionMode || 'fade') === 'cut' ? 'selected' : ''}>Cut (sofort)</option>
        </select>
        <div class="system-row" style="margin-top:0.6rem;"><strong>Mini-Player</strong></div>
        <div class="system-row" style="display:grid;grid-template-columns:1fr auto auto auto;gap:0.4rem;align-items:center;">
          <select id="set-player-track">${musicTrackOptions}</select>
          <button id="set-player-prev" class="btn btn-secondary btn-sm" type="button">⏮</button>
          <button id="set-player-toggle" class="btn btn-primary btn-sm" type="button">Play</button>
          <button id="set-player-next" class="btn btn-secondary btn-sm" type="button">⏭</button>
        </div>
        <label class="system-row">Lokale Musik-Vorlage</label>
        <select id="set-music-preset">
          <option value="">Keine Vorlage</option>
          ${musicTrackOptions}
        </select>
        <label class="system-row" style="display:flex;gap:0.5rem;align-items:center;margin-top:0.65rem;">
          <input type="checkbox" id="set-auto-scene-music" ${audioState.autoSceneMusic ? 'checked' : ''} />
          Auto-Szenenmusik aktiv
        </label>
        <label class="system-row">Galaxy-Track URL</label>
        <input id="set-scene-galaxy" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.galaxy || '')}" />
        <label class="system-row">System-Track URL</label>
        <input id="set-scene-system" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.system || '')}" />
        <label class="system-row">Battle-Track URL</label>
        <input id="set-scene-battle" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.battle || '')}" />
        <label class="system-row">UI-Track URL</label>
        <input id="set-scene-ui" type="text" placeholder="music/Nebula_Overture.mp3" value="${esc(audioState.sceneTracks?.ui || '')}" />
        <div class="system-row" style="margin-top:0.85rem;"><strong>SFX-Browser</strong></div>
        ${sfxRows}
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.55rem;">
          <button id="set-audio-test" class="btn btn-secondary btn-sm" type="button">SFX-Test</button>
          <button id="set-tts-test" class="btn btn-secondary btn-sm" type="button">TTS-Test</button>
          <button id="set-sfx-apply" class="btn btn-secondary btn-sm" type="button">SFX speichern</button>
          <button id="set-audio-reset" class="btn btn-warning btn-sm" type="button">Audio-Defaults</button>
          <button id="set-scene-apply" class="btn btn-secondary btn-sm" type="button">Szenen speichern</button>
          <button id="set-scene-preview-galaxy" class="btn btn-secondary btn-sm" type="button">Preview Galaxy</button>
          <button id="set-scene-preview-system" class="btn btn-secondary btn-sm" type="button">Preview System</button>
          <button id="set-scene-preview-battle" class="btn btn-secondary btn-sm" type="button">Preview Battle</button>
          <button id="set-scene-preview-ui" class="btn btn-secondary btn-sm" type="button">Preview UI</button>
          <button id="set-music-apply" class="btn btn-secondary btn-sm" type="button">Musik laden</button>
          <button id="set-music-play" class="btn btn-primary btn-sm" type="button">Play</button>
          <button id="set-music-stop" class="btn btn-warning btn-sm" type="button">Stop</button>
        </div>

        ${llmSectionHtml}

        ${npcSectionHtml}
      </div>`;
    }

    return {
      build,
    };
  }

  const api = {
    createSettingsCoreSectionTemplateBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsCoreSectionTemplate = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
