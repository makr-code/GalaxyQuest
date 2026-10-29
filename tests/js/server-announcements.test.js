import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initializeServerAnnouncements } from '../../js/network/server-announcements.js';

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const message = { id: 5, title: 'Maintenance', message: 'Restart at 20:00 UTC.', severity: 'maintenance', published_at: '2026-10-29 19:00:00' };
const fetchMessages = (announcements = [message]) => vi.fn().mockResolvedValue({
  ok: true, json: async () => ({ success: true, announcements }),
});

describe('server announcements overlay', () => {
  beforeEach(() => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const id of ['start-announcements', 'server-announcements-dialog']) {
      document.body.append(document.importNode(parsed.getElementById(id), true));
    }
    document.body.className = 'auth-page';
    HTMLDialogElement.prototype.showModal = vi.fn(function () { this.open = true; });
    HTMLDialogElement.prototype.close = vi.fn(function () { this.open = false; });
    localStorage.clear();
  });
  afterEach(() => {
    window.dispatchEvent(new Event('gq:authenticated'));
    vi.restoreAllMocks();
    delete HTMLDialogElement.prototype.showModal;
    delete HTMLDialogElement.prototype.close;
    document.body.innerHTML = '';
    document.body.className = '';
    localStorage.clear();
  });

  it('automatically displays unseen messages and persists IDs only after display', async () => {
    const controller = initializeServerAnnouncements({ fetchImpl: fetchMessages() });
    await controller.ready;
    expect(document.getElementById('server-announcements-dialog').open).toBe(true);
    expect(document.querySelector('.server-announcement h3').textContent).toBe('Maintenance');
    expect(JSON.parse(localStorage.getItem('gq_seen_server_announcements'))).toEqual([5]);
    controller.close();
    document.getElementById('start-announcements').click();
    expect(document.getElementById('server-announcements-dialog').open).toBe(true);
  });

  it('does not automatically reopen read messages, but a new ID does open', async () => {
    localStorage.setItem('gq_seen_server_announcements', '[5]');
    const fetchImpl = fetchMessages();
    const controller = initializeServerAnnouncements({ fetchImpl });
    await controller.ready;
    expect(document.getElementById('server-announcements-dialog').open).toBe(false);
    fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, announcements: [{ ...message, id: 6 }] }) });
    document.getElementById('server-announcements-refresh').click();
    await vi.waitFor(() => expect(document.getElementById('server-announcements-dialog').open).toBe(true));
  });

  it('does not interrupt an active form or mark deferred messages as read', async () => {
    let busy = true;
    const controller = initializeServerAnnouncements({ fetchImpl: fetchMessages(), beforeOpen: () => !busy });
    await controller.ready;
    expect(document.getElementById('server-announcements-dialog').open).toBe(false);
    expect(localStorage.getItem('gq_seen_server_announcements')).toBeNull();
    expect(document.getElementById('start-announcements-status').textContent).toBe('1 new');
    busy = false;
    window.dispatchEvent(new Event('gq:start-panel-closed'));
    await vi.waitFor(() => expect(document.getElementById('server-announcements-dialog').open).toBe(true));
  });

  it('renders messages as text, never executable HTML', async () => {
    await initializeServerAnnouncements({ fetchImpl: fetchMessages([{ ...message, message: '<img src=x onerror=alert(1)>' }]) }).ready;
    expect(document.querySelector('.server-announcement-message').textContent).toContain('<img');
    expect(document.querySelector('#server-announcements-list img')).toBeNull();
  });

  it('surfaces HTTP failures, keeps the overlay reopenable and offers refresh', async () => {
    await initializeServerAnnouncements({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }) }).ready;
    expect(document.getElementById('start-announcements-status').textContent).toBe('Unavailable');
    document.getElementById('start-announcements').click();
    expect(document.getElementById('server-announcements-status').textContent).toContain('HTTP 503');
    expect(document.getElementById('server-announcements-dialog').open).toBe(true);
  });

  it('surfaces persistence errors without preventing dismissal', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    const controller = initializeServerAnnouncements({ fetchImpl: fetchMessages() });
    await controller.ready;
    expect(document.getElementById('server-announcements-status').textContent).toContain('Storage disabled');
    controller.close();
    expect(document.getElementById('server-announcements-dialog').open).toBe(false);
  });
});
