/**
 * RuntimeSettingsSectionsComposer.js
 *
 * Composes derived settings section markup from specialized builders.
 */

'use strict';

(function () {
  function createSettingsSectionsComposer(opts = {}) {
    const buildMusicTrackOptions = typeof opts.buildMusicTrackOptions === 'function'
      ? opts.buildMusicTrackOptions
      : (() => '');
    const buildSfxRows = typeof opts.buildSfxRows === 'function'
      ? opts.buildSfxRows
      : (() => '');
    const buildFtlDriveButtons = typeof opts.buildFtlDriveButtons === 'function'
      ? opts.buildFtlDriveButtons
      : (() => '');
    const buildFtlSection = typeof opts.buildFtlSection === 'function'
      ? opts.buildFtlSection
      : (() => '');
    const buildLlmSection = typeof opts.buildLlmSection === 'function'
      ? opts.buildLlmSection
      : (() => '');
    const buildNpcSection = typeof opts.buildNpcSection === 'function'
      ? opts.buildNpcSection
      : (() => '');

    function compose(input = {}) {
      const audioState = input.audioState || {};
      const settingsState = input.settingsState || {};
      const esc = typeof input.esc === 'function' ? input.esc : ((value) => String(value || ''));
      const audioTrackOptions = Array.isArray(input.audioTrackOptions) ? input.audioTrackOptions : [];
      const audioEvents = Array.isArray(input.audioEvents) ? input.audioEvents : [];
      const sfxOptions = Array.isArray(input.sfxOptions) ? input.sfxOptions : [];

      const musicTrackOptions = buildMusicTrackOptions({
        audioTrackOptions,
        esc,
      });

      const sfxRows = buildSfxRows({
        audioState,
        settingsState,
        audioEvents,
        sfxOptions,
        esc,
      });

      const ftlDriveButtons = buildFtlDriveButtons({
        esc,
      });

      return {
        musicTrackOptions: String(musicTrackOptions || ''),
        sfxRows: String(sfxRows || ''),
        ftlSectionHtml: String(buildFtlSection({ ftlDriveButtons }) || ''),
        llmSectionHtml: String(buildLlmSection() || ''),
        npcSectionHtml: String(buildNpcSection() || ''),
      };
    }

    return {
      compose,
    };
  }

  const api = {
    createSettingsSectionsComposer,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsSectionsComposer = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
