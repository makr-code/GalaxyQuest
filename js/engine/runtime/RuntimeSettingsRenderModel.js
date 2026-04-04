/**
 * RuntimeSettingsRenderModel.js
 *
 * Builds the settings render model (audio snapshot, composed sections, view
 * model and core section html) so renderSettings() can stay orchestration-only.
 */
(function () {
  function createSettingsRenderModelBuilder() {
    function build({
      settingsState,
      audioManager,
      esc,
      audioTrackOptions,
      audioEvents,
      sfxOptions,
      formatLastAudioEvent,
      settingsSectionsComposer,
      settingsViewModelBuilder,
      settingsCoreSectionTemplateBuilder,
    }) {
      const audioState = audioManager ? audioManager.snapshot() : settingsState;
      settingsState.sfxMap = Object.assign({}, settingsState.sfxMap || {}, audioState.sfxMap || {});

      const sections = settingsSectionsComposer.compose({
        audioState,
        settingsState,
        esc,
        audioTrackOptions,
        audioEvents,
        sfxOptions,
      });

      const settingsVm = settingsViewModelBuilder.build({
        audioState,
        esc,
        formatLastAudioEvent,
        musicTrackOptions: sections.musicTrackOptions,
        sfxRows: sections.sfxRows,
        ftlSectionHtml: sections.ftlSectionHtml,
        llmSectionHtml: sections.llmSectionHtml,
        npcSectionHtml: sections.npcSectionHtml,
      });

      const coreSectionHtml = settingsCoreSectionTemplateBuilder.build({
        settingsState,
        audioState,
        musicTrackOptions: settingsVm.musicTrackOptions,
        sfxRows: settingsVm.sfxRows,
        lastAudioEventLabel: settingsVm.lastAudioEventLabel,
        llmSectionHtml: settingsVm.llmSectionHtml,
        npcSectionHtml: settingsVm.npcSectionHtml,
        esc,
      });

      return {
        audioState,
        coreSectionHtml,
        ftlSectionHtml: settingsVm.ftlSectionHtml,
      };
    }

    return { build };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSettingsRenderModelBuilder };
  } else {
    window.GQRuntimeSettingsRenderModel = { createSettingsRenderModelBuilder };
  }
})();
