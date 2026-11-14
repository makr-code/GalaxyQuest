import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { initializeChronology } from '../../js/network/chronology.js';

const html = fs.readFileSync('index.html', 'utf8');
const post = {
  id: 1, title: '<Chronik>', summary: 'Ein Ereignis.',
  event_date: '2024-02-29', origin: 'game-event', is_correction: true, url: 'https://blog.test/?p=1',
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Chronology', () => {
  it('loads on demand, applies filters and pages while rendering text safely', async () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.append(document.importNode(parsed.getElementById('start-chronology'), true));
    const fetchImpl = vi.fn(async () => ({
      ok: true, json: async () => ({ success: true, posts: [post], has_more: true }),
    }));
    initializeChronology({ fetchImpl });
    const root = document.getElementById('start-chronology');
    root.open = true;
    root.dispatchEvent(new Event('toggle'));
    await vi.waitFor(() => expect(document.querySelector('#start-chronology-posts li a')?.textContent).toBe('<Chronik>'));
    expect(document.querySelector('#start-chronology-posts li:not(.chronology-chapter)').textContent).toContain('Spielereignis');
    expect(document.querySelector('#start-chronology-posts li:not(.chronology-chapter)').textContent).toContain('Korrektur');
    expect(document.querySelector('#start-chronology-posts li a').rel).toContain('noopener');
    expect(document.querySelector('#start-chronology-posts li').textContent).toBe('Kapitel 2024-02');
    const form = root.querySelector('form');
    form.elements.topic.value = 'diplomatie';
    form.elements.order.value = 'asc';
    form.elements.from.value = '2024-01-01';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.includes('topic=diplomatie') && url.includes('order=asc'))).toBe(true));
    await vi.waitFor(() => expect(root.querySelector('#start-chronology-next').disabled).toBe(false));
    root.querySelector('#start-chronology-next').click();
    await vi.waitFor(() => expect(root.querySelector('#start-chronology-page').textContent).toBe('Seite 2'));
    expect(fetchImpl.mock.calls.at(-1)[0]).toContain('page=2');
  });

  it('clears stale entries on source failure', async () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.append(document.importNode(parsed.getElementById('start-chronology'), true));
    const fetchImpl = vi.fn(async () => ({
      ok: true, json: async () => ({ success: true, posts: [post], has_more: false }),
    }));
    initializeChronology({ fetchImpl });
    const root = document.getElementById('start-chronology');
    root.open = true;
    root.dispatchEvent(new Event('toggle'));
    await vi.waitFor(() => expect(root.querySelectorAll('li:not(.chronology-chapter)')).toHaveLength(1));
    fetchImpl.mockResolvedValue({ ok: false, status: 503, json: async () => ({ success: false, error: 'Ausfall' }) });
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector('#start-chronology-status').textContent).toContain('Ausfall'));
    expect(root.querySelectorAll('li')).toHaveLength(0);
  });
});
