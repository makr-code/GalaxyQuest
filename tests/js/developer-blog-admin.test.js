import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const { blogRequest } = vi.hoisted(() => ({ blogRequest: vi.fn() }));
vi.mock('../../js/network/developer-blog.js', async importOriginal => ({
  ...await importOriginal(), blogRequest,
}));
const html = fs.readFileSync('developer-blog-admin.php', 'utf8')
  .replaceAll('<?= DeveloperBlogRepository::MAX_TITLE_CHARS ?>', '160')
  .replaceAll('<?= DeveloperBlogRepository::MAX_BODY_CHARS ?>', '3000');

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  blogRequest.mockReset();
  blogRequest.mockResolvedValue({ posts: [], has_more: false });
  const parsed = new DOMParser().parseFromString(html.slice(html.indexOf('<!doctype')), 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  await import('../../js/ui/developer-blog-admin.js');
  await vi.waitFor(() => expect(document.getElementById('blog-admin-status').textContent).toBe('Redaktion aktualisiert.'));
});
afterEach(() => {
  document.getElementById('blog-new').click();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Blog editor limits', () => {
  it('accepts exactly 3000 Unicode characters and reports the count', () => {
    const form = document.getElementById('blog-editor');
    form.elements.title.value = 'Update';
    form.elements.body.value = '🌟'.repeat(3000);
    form.elements.body.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('blog-body-count').textContent).toBe('3000 / 3000 Zeichen');
    expect(form.checkValidity()).toBe(true);
    form.elements.body.value += '🌟';
    form.elements.body.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('blog-body-count').textContent).toBe('3001 / 3000 Zeichen');
    expect(form.elements.body.validationMessage).toContain('höchstens 3000');
    expect(form.checkValidity()).toBe(false);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(blogRequest).toHaveBeenCalledTimes(1);
  });
  it('counts titles and clears validation after shortening or starting a new post', () => {
    const field = document.getElementById('blog-editor').elements.title;
    field.value = '🌟'.repeat(161);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(field.validationMessage).toContain('höchstens 160');
    field.value = '🌟'.repeat(160);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(field.validationMessage).toBe('');
    document.getElementById('blog-new').click();
    expect(document.getElementById('blog-title-count').textContent).toBe('0 / 160 Zeichen');
    expect(document.getElementById('blog-body-count').textContent).toBe('0 / 3000 Zeichen');
  });
  it('retains the page on failed pagination so retry does not skip posts', async () => {
    blogRequest.mockRejectedValueOnce(new Error('Offline'));
    const next = document.getElementById('blog-next');
    next.disabled = false;
    next.click();
    await vi.waitFor(() => expect(document.getElementById('blog-admin-status').textContent).toBe('Offline'));
    blogRequest.mockResolvedValue({ posts: [], has_more: false });
    next.click();
    await vi.waitFor(() => expect(blogRequest).toHaveBeenCalledTimes(3));
    expect(blogRequest.mock.calls[1][0]).toBe('admin_list&page=2');
    expect(blogRequest.mock.calls[2][0]).toBe('admin_list&page=2');
  });
  it('saves publication state and bounded text before reloading the editor list', async () => {
    const form = document.getElementById('blog-editor');
    form.elements.title.value = 'Entwicklungsstand';
    form.elements.body.value = 'a'.repeat(3000);
    form.elements.published.checked = true;
    blogRequest.mockResolvedValueOnce({ id: 17 }).mockResolvedValueOnce({ posts: [], has_more: false });
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(blogRequest).toHaveBeenCalledTimes(3));
    expect(blogRequest).toHaveBeenNthCalledWith(2, 'save', {
      id: 0, revision: null, title: 'Entwicklungsstand', body: 'a'.repeat(3000), published: true, categories: ['entwicklung'], tags: [], target_faction_id: null,
    });
    expect(blogRequest).toHaveBeenNthCalledWith(3, 'admin_list&page=1');
    await vi.waitFor(() => expect(form.inert).toBe(false));
  });
  it('protects unsaved edits and allows reverting the form without a warning', () => {
    const form = document.getElementById('blog-editor');
    form.elements.title.value = 'Entwurf';
    form.dispatchEvent(new Event('input'));
    expect(document.getElementById('blog-unsaved').textContent).toContain('Ungespeicherte');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    window.confirm.mockReturnValueOnce(false);
    document.getElementById('blog-new').click();
    expect(form.elements.title.value).toBe('Entwurf');
    document.getElementById('blog-new').click();
    expect(form.elements.title.value).toBe('');
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    expect(document.getElementById('blog-unsaved').textContent).toBe('');
  });
  it('tracks publication-only edits and removes the warning when reverted', () => {
    const checkbox = document.getElementById('blog-editor').elements.published;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('blog-unsaved').textContent).not.toBe('');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('blog-unsaved').textContent).toBe('');
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('keeps stale edits on conflict and preserves them when reloading the list', async () => {
    const form = document.getElementById('blog-editor');
    const post = { id: 8, revision: 3, title: 'Original', body: 'Text', published_at: null };
    blogRequest.mockResolvedValueOnce({ posts: [post], has_more: false });
    document.getElementById('blog-reload').click();
    await vi.waitFor(() => expect(document.querySelector('#blog-admin-posts button')).not.toBeNull());
    await vi.waitFor(() => expect(form.inert).toBe(false));
    document.querySelector('#blog-admin-posts button').click();
    form.elements.title.value = 'Meine Änderung';
    form.dispatchEvent(new Event('input'));
    blogRequest.mockRejectedValueOnce(new Error('Beitrag wurde zwischenzeitlich geändert.'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('blog-admin-status').textContent).toContain('zwischenzeitlich'));
    expect(blogRequest).toHaveBeenLastCalledWith('save', {
      id: 8, revision: 3, title: 'Meine Änderung', body: 'Text', published: false, categories: ['entwicklung'], tags: [], target_faction_id: null,
    });
    blogRequest.mockResolvedValueOnce({ posts: [{ ...post, revision: 4, title: 'Andere Änderung' }], has_more: false });
    document.getElementById('blog-reload').click();
    await vi.waitFor(() => expect(document.querySelector('#blog-admin-posts button').textContent).toContain('Andere Änderung'));
    expect(form.elements.title.value).toBe('Meine Änderung');
    expect(document.getElementById('blog-unsaved').textContent).not.toBe('');
  });
  it('uses the returned revision on a second save without reopening the post', async () => {
    const form = document.getElementById('blog-editor');
    form.elements.title.value = 'Update';
    form.elements.body.value = 'Text';
    blogRequest.mockResolvedValueOnce({ id: 17, revision: 1 })
      .mockResolvedValueOnce({ posts: [], has_more: false });
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(blogRequest).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(form.inert).toBe(false));
    blogRequest.mockResolvedValueOnce({ id: 17, revision: 2 })
      .mockResolvedValueOnce({ posts: [], has_more: false });
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(blogRequest).toHaveBeenCalledTimes(5));
    expect(blogRequest.mock.calls[3][1]).toMatchObject({ id: 17, revision: 1 });
    await vi.waitFor(() => expect(form.inert).toBe(false));
  });
  it('loads categories and tags, protects changes and sends taxonomy on save', async () => {
    const form = document.getElementById('blog-editor');
    blogRequest.mockResolvedValueOnce({ posts: [{
      id: 22, revision: 1, title: 'Update', body: 'Text', published_at: null,
      categories: ['audio'], tags: ['hero', 'tts'],
    }], has_more: false });
    document.getElementById('blog-reload').click();
    await vi.waitFor(() => expect(document.querySelector('#blog-admin-posts button')).not.toBeNull());
    await vi.waitFor(() => expect(form.inert).toBe(false));
    document.querySelector('#blog-admin-posts button').click();
    expect(form.elements.categories.value).toBe('audio');
    expect(form.elements.tags.value).toBe('hero, tts');
    form.elements.tags.value = 'tts';
    form.elements.categories.value = 'audio, ui-ux';
    form.dispatchEvent(new Event('input'));
    expect(document.getElementById('blog-unsaved').textContent).not.toBe('');
    blogRequest.mockResolvedValueOnce({ id: 22, revision: 2 })
      .mockResolvedValueOnce({ posts: [], has_more: false });
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(blogRequest).toHaveBeenCalledTimes(4));
    expect(blogRequest.mock.calls[2][1]).toMatchObject({
      categories: ['audio', 'ui-ux'], tags: ['tts'], id: 22, revision: 1,
    });
    await vi.waitFor(() => expect(form.inert).toBe(false));
    expect(document.getElementById('blog-unsaved').textContent).toBe('');
  });
  it('saves an explicit homeworld target and keeps it across list refreshes', async () => {
      const form = document.getElementById('blog-editor');
      const target = { faction_id: 8, code: 'aereth', homeworld: "Sol'Ryaan" };
      blogRequest.mockResolvedValueOnce({ posts: [], has_more: false, flight_targets: [target] });
      document.getElementById('blog-reload').click();
      await vi.waitFor(() => expect(form.elements.target_faction_id.options).toHaveLength(2));
      await vi.waitFor(() => expect(form.inert).toBe(false));
      form.elements.title.value = 'Anflug';
      form.elements.body.value = 'Heimatwelt';
      form.elements.target_faction_id.value = '8';
      form.dispatchEvent(new Event('input'));
      blogRequest.mockResolvedValueOnce({ id: 17, revision: 1 })
        .mockResolvedValueOnce({ posts: [], has_more: false, flight_targets: [target] });
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await vi.waitFor(() => expect(blogRequest).toHaveBeenCalledTimes(4));
      expect(blogRequest.mock.calls[2][1].target_faction_id).toBe(8);
      await vi.waitFor(() => expect(form.inert).toBe(false));
      expect(form.elements.target_faction_id.value).toBe('8');
      expect(document.getElementById('blog-unsaved').textContent).toBe('');
  });
  it('retains edits on save failure and distinguishes saved posts from list refresh failures', async () => {
    const form = document.getElementById('blog-editor');
    form.elements.title.value = 'Update';
    form.elements.body.value = 'Text';
    form.dispatchEvent(new Event('input'));
    blogRequest.mockRejectedValueOnce(new Error('Save offline'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(form.inert).toBe(false));
    expect(document.getElementById('blog-unsaved').textContent).not.toBe('');
    blogRequest.mockResolvedValueOnce({ id: 17 }).mockRejectedValueOnce(new Error('List offline'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('blog-admin-status').textContent).toContain('Beitrag gespeichert, aber'));
    expect(document.getElementById('blog-unsaved').textContent).toBe('');
    expect(form.elements.body.value).toBe('Text');
  });
});
