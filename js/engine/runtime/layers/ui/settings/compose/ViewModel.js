/**
 * ViewModel.js
 *
 * Builds derived view-model data for settings rendering.
 */

'use strict';

(function () {
  function createSettingsViewModelBuilder() {
    function build(opts = {}) {
      const audioState = opts.audioState || {};
      const esc = typeof opts.esc === 'function' ? opts.esc : ((value) => String(value || ''));
      const formatLastAudioEvent = typeof opts.formatLastAudioEvent === 'function'
        ? opts.formatLastAudioEvent
        : (() => '');
      const buildMusicTrackOptions = typeof opts.buildMusicTrackOptions === 'function'
        ? opts.buildMusicTrackOptions
        : (() => '');
      const buildSfxRows = typeof opts.buildSfxRows === 'function'
        ? opts.buildSfxRows
        : (() => '');
      const buildFtlSectionHtml = typeof opts.buildFtlSectionHtml === 'function'
        ? opts.buildFtlSectionHtml
        : (() => '');
      const buildLlmSectionHtml = typeof opts.buildLlmSectionHtml === 'function'
        ? opts.buildLlmSectionHtml
        : (() => '');
      const buildNpcSectionHtml = typeof opts.buildNpcSectionHtml === 'function'
        ? opts.buildNpcSectionHtml
        : (() => '');

      const directMusicTrackOptions = typeof opts.musicTrackOptions === 'string' ? opts.musicTrackOptions : null;
      const directSfxRows = typeof opts.sfxRows === 'string' ? opts.sfxRows : null;
      const directFtlSectionHtml = typeof opts.ftlSectionHtml === 'string' ? opts.ftlSectionHtml : null;
      const directLlmSectionHtml = typeof opts.llmSectionHtml === 'string' ? opts.llmSectionHtml : null;
      const directNpcSectionHtml = typeof opts.npcSectionHtml === 'string' ? opts.npcSectionHtml : null;

      return {
        musicTrackOptions: String((directMusicTrackOptions != null ? directMusicTrackOptions : buildMusicTrackOptions()) || ''),
        sfxRows: String((directSfxRows != null ? directSfxRows : buildSfxRows()) || ''),
        ftlSectionHtml: String((directFtlSectionHtml != null ? directFtlSectionHtml : buildFtlSectionHtml()) || ''),
        llmSectionHtml: String((directLlmSectionHtml != null ? directLlmSectionHtml : buildLlmSectionHtml()) || ''),
        npcSectionHtml: String((directNpcSectionHtml != null ? directNpcSectionHtml : buildNpcSectionHtml()) || ''),
        lastAudioEventLabel: esc(formatLastAudioEvent(audioState.lastAudioEvent || null)),
      };
    }

    return {
      build,
    };
  }

  const api = {
    createSettingsViewModelBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsViewModel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
