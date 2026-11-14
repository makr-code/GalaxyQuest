import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { initializeRadio } from '../../js/network/radio.js';

const html = fs.readFileSync('index.html', 'utf8');
const clip = 'generated/tts/' + 'a'.repeat(64) + '.mp3';
const post = { id: 7, title: '<Funkspruch>', revision: 'wp:' + 'b'.repeat(64) };

function mount() {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.append(document.importNode(parsed.getElementById('start-radio'), true));
}

afterEach(() => {
  document.body.replaceChildren();
  delete window.__GQ_AUDIO_MANAGER;
  vi.restoreAllMocks();
});

describe('Galaxy News Radio', () => {
  it('plays each broadcast item through narration and renders titles as text', async () => {
    mount();
    const audio = new EventTarget();
    audio.pause = vi.fn();
    window.__GQ_AUDIO_MANAGER = {
      snapshot: () => ({}),
      playTtsAudio: vi.fn(() => { setTimeout(() => audio.dispatchEvent(new Event('ended'))); return audio; }),
    };
    const fetchImpl = vi.fn(async url => ({
      ok: true,
      json: async () => url.includes('action=radio') ? { success: true, posts: [post] }
        : url.includes('action=narration') ? { success: true, audio_url: clip, chunks: 1, chunk: 0 }
          : { success: true, token: 't' },
    }));
    initializeRadio({ fetchImpl });
    document.getElementById('start-radio-play').click();
    await vi.waitFor(() => expect(document.getElementById('start-radio-status').textContent).toBe('Sendung beendet.'));
    expect(document.querySelector('#start-radio-posts li').textContent).toBe('<Funkspruch>');
    expect(window.__GQ_AUDIO_MANAGER.playTtsAudio).toHaveBeenCalledWith(clip);
    expect(document.getElementById('start-radio-play').disabled).toBe(false);
  });

  it('refuses to start while audio is muted', () => {
    mount();
    window.__GQ_AUDIO_MANAGER = { snapshot: () => ({ ttsMuted: true }), playTtsAudio: vi.fn() };
    const fetchImpl = vi.fn();
    initializeRadio({ fetchImpl });
    document.getElementById('start-radio-play').click();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(document.getElementById('start-radio-status').textContent).toContain('stummgeschaltet');
  });
});
