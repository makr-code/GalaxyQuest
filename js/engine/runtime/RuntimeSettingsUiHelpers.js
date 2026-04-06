'use strict';

(function () {
  function formatLastAudioEvent(detail, options = {}) {
    const audioEvents = Array.isArray(options.audioEvents) ? options.audioEvents : [];
    if (!detail || !detail.key) return 'Kein Event';
    const key = String(detail.key || '');
    const matching = audioEvents.find((item) => item.key === key);
    const label = matching ? matching.label : key;
    const stamp = detail.ts ? new Date(detail.ts).toLocaleTimeString() : '';
    return stamp ? `${label} @ ${stamp}` : label;
  }

  function updateLastAudioEventUi(detail, options = {}) {
    const documentRef = options.documentRef || document;
    const formatter = typeof options.formatLastAudioEvent === 'function'
      ? options.formatLastAudioEvent
      : (value) => formatLastAudioEvent(value, options);
    const node = documentRef.querySelector('#set-last-audio-event');
    if (!node) return;
    node.textContent = formatter(detail);
  }

  function applyTransitionPreset(presetName, settingsState) {
    const preset = String(presetName || 'balanced');
    const presets = {
      smooth: { hover: 270, stableMs: 240 },
      balanced: { hover: 220, stableMs: 160 },
      snappy: { hover: 175, stableMs: 100 },
    };
    const selected = presets[preset] || presets.balanced;
    settingsState.transitionPreset = presets[preset] ? preset : 'balanced';
    settingsState.persistentHoverDistance = selected.hover;
    settingsState.transitionStableMinMs = selected.stableMs;
  }

  const api = {
    formatLastAudioEvent,
    updateLastAudioEventUi,
    applyTransitionPreset,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsUiHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();