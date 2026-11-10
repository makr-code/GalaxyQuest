// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let audioCatalog;

function createAudioCatalogDom() {
  document.body.innerHTML = `
    <select id="set-music-preset"><option value="track-1">Current preset</option></select>
    <select id="set-player-track"><option value="track-2">Current mini track</option></select>
    <select id="topbar-player-track"><option value="track-1">Current topbar track</option></select>
    <div id="topbar-player-track-list"></div>
  `;
}

function configureCatalog(options) {
  audioCatalog.configureAudioCatalogRuntime({
    getAudioTrackOptions: () => options,
    getSettingsState: () => ({ musicUrl: 'track-1' }),
    documentRef: document,
    windowRef: window,
    esc: (value) => String(value ?? ''),
  });
}

beforeEach(() => {
  createAudioCatalogDom();
  delete window.GQRuntimeAudioCatalog;
  window.eval(readFileSync(path.resolve('js/engine/runtime/RuntimeAudioCatalog.js'), 'utf8'));
  audioCatalog = window.GQRuntimeAudioCatalog;
});

describe('RuntimeAudioCatalog DOM rendering', () => {
  it('renders catalog labels as text and track values as properties', () => {
    const maliciousValue = '"><img src=x onerror=alert(1)>';
    const maliciousLabel = '<svg onload=alert(1)>';
    configureCatalog([
      { value: maliciousValue, label: maliciousLabel },
      { value: 'track-2', label: 'Second track' },
    ]);

    audioCatalog.refreshSettingsMusicPresetOptions();
    audioCatalog.renderTopbarTrackQuickList(maliciousValue);

    const quickList = document.querySelector('#topbar-player-track-list');
    expect(quickList.querySelector('img, svg')).toBeNull();
    expect(quickList.querySelector('button').dataset.track).toBe(maliciousValue);
    expect(quickList.querySelector('button').title).toBe(maliciousLabel);
    expect(quickList.querySelector('button').textContent).toBe(maliciousLabel);
    expect(quickList.querySelector('button').getAttribute('aria-selected')).toBe('true');

    for (const selector of ['#set-music-preset', '#set-player-track', '#topbar-player-track']) {
      const select = document.querySelector(selector);
      expect(select.querySelector('img, svg')).toBeNull();
      expect(Array.from(select.options).some((option) => option.value === maliciousValue)).toBe(true);
      expect(Array.from(select.options).some((option) => option.textContent === maliciousLabel)).toBe(true);
    }
  });

  it('preserves valid current selections and shows the empty quick-list state', () => {
    configureCatalog([
      { value: 'track-1', label: 'First track' },
      { value: 'track-2', label: 'Second track' },
    ]);

    audioCatalog.refreshSettingsMusicPresetOptions();
    audioCatalog.renderTopbarTrackQuickList('');

    expect(document.querySelector('#set-music-preset').value).toBe('track-1');
    expect(document.querySelector('#set-player-track').value).toBe('track-2');
    expect(document.querySelector('#topbar-player-track').value).toBe('track-1');
    expect(document.querySelector('#topbar-player-track-list').textContent).toBe('First trackSecond track');

    configureCatalog([]);
    audioCatalog.renderTopbarTrackQuickList('');
    expect(document.querySelector('#topbar-player-track-list').textContent).toBe('Keine Titel verfuegbar.');
    expect(document.querySelector('#topbar-player-track-list').firstElementChild.className)
      .toBe('topbar-player-track-empty');
  });
});
