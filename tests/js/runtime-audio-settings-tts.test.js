import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'js/engine/runtime/layers/ui/settings/audio/SettingsPanel.js');
const applyPath = path.resolve(process.cwd(), 'js/engine/runtime/layers/ui/settings/audio/SettingsApply.js');

function loadPanelModule() {
  delete window.GQRuntimeAudioSettingsPanel;
  window.eval(fs.readFileSync(panelPath, 'utf8'));
  return window.GQRuntimeAudioSettingsPanel;
}

function loadApplyModule() {
  delete window.GQRuntimeAudioSettingsApply;
  window.eval(fs.readFileSync(applyPath, 'utf8'));
  return window.GQRuntimeAudioSettingsApply;
}

function createRoot() {
  const root = document.createElement('div');
  root.innerHTML = `
    <input id="set-tts-mute" type="checkbox" />
    <input id="set-tts-auto-voice" type="checkbox" checked />
    <span id="set-tts-vol-value">95</span>
    <input id="set-tts-vol" type="range" min="0" max="100" value="95" />
    <button id="set-tts-test" type="button">TTS-Test</button>
    <button id="set-audio-test" type="button">SFX-Test</button>
  `;
  document.body.appendChild(root);
  return root;
}

function createBindRange(root) {
  return (id, valueId, setter) => {
    const input = root.querySelector(id);
    const out = root.querySelector(valueId);
    if (!input || !out) return;
    const apply = () => {
      out.textContent = String(input.value);
      setter(Number(input.value || 0));
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  window.GQTTS = {
    speak: vi.fn().mockResolvedValue({ play: vi.fn(), addEventListener: vi.fn() }),
    setAutoVoice: vi.fn(),
  };
});

describe('Runtime audio settings TTS wiring', () => {
  it('applies persisted TTS settings to audio manager and GQTTS', () => {
    const mod = loadApplyModule();
    const audioManager = {
      snapshot: vi.fn(() => ({ sfxMap: {}, musicTransitionMode: 'fade' })),
      setMasterVolume: vi.fn(),
      setMusicVolume: vi.fn(),
      setSfxVolume: vi.fn(),
      setTtsVolume: vi.fn(),
      setMasterMuted: vi.fn(),
      setMusicMuted: vi.fn(),
      setSfxMuted: vi.fn(),
      setTtsMuted: vi.fn(),
      setMusicTransitionMode: vi.fn(),
      setAutoSceneMusic: vi.fn(),
      setSceneTrack: vi.fn(),
      setSfxTrack: vi.fn(),
      setMusicTrack: vi.fn(),
    };

    mod.applyLoadedAudioSettings({
      audioManager,
      settingsState: {
        masterVolume: 0.8,
        musicVolume: 0.55,
        sfxVolume: 0.7,
        ttsVolume: 0.61,
        masterMuted: false,
        musicMuted: false,
        sfxMuted: false,
        ttsMuted: true,
        ttsAutoVoice: false,
        musicTransitionMode: 'fade',
        autoSceneMusic: true,
        sceneTracks: { galaxy: '', system: '', battle: '', ui: '' },
        sfxMap: {},
        musicUrl: '',
      },
    });

    expect(audioManager.setTtsVolume).toHaveBeenCalledWith(0.61);
    expect(audioManager.setTtsMuted).toHaveBeenCalledWith(true);
    expect(window.GQTTS.setAutoVoice).toHaveBeenCalledWith(false);
  });

  it('binds TTS controls in the active settings panel', async () => {
    const mod = loadPanelModule();
    const root = createRoot();
    const settingsState = { ttsMuted: false, ttsVolume: 0.95, ttsAutoVoice: true };
    const audioManager = {
      setTtsMuted: vi.fn(),
      setTtsVolume: vi.fn(),
      playUiConfirm: vi.fn(),
    };
    const saveUiSettings = vi.fn();
    const showToast = vi.fn();

    mod.bindAudioSettingsPanel({
      root,
      audioState: settingsState,
      settingsState,
      audioManager,
      bindRange: createBindRange(root),
      loadAudioTrackCatalog: vi.fn(),
      saveUiSettings,
      showToast,
      refreshAudioUi: vi.fn(),
      rerenderSettings: vi.fn(),
    });

    const mute = root.querySelector('#set-tts-mute');
    mute.checked = true;
    mute.dispatchEvent(new Event('change'));

    const autoVoice = root.querySelector('#set-tts-auto-voice');
    autoVoice.checked = false;
    autoVoice.dispatchEvent(new Event('change'));

    const volume = root.querySelector('#set-tts-vol');
    volume.value = '42';
    volume.dispatchEvent(new Event('input'));

    await root.querySelector('#set-tts-test').click();

    expect(audioManager.setTtsMuted).toHaveBeenCalledWith(true);
    expect(audioManager.setTtsVolume).toHaveBeenCalledWith(0.42);
    expect(window.GQTTS.setAutoVoice).toHaveBeenCalledWith(false);
    expect(window.GQTTS.speak).toHaveBeenCalledWith('Systemcheck. Sprachausgabe aktiv.', { noCache: true });
    expect(saveUiSettings).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith('TTS ist nicht verfuegbar.', 'warning');
  });
});