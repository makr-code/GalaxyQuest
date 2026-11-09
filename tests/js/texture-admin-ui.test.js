// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.resolve('js/admin/texture-admin-ui.js'), 'utf8');

function response(data) {
  return { json: async () => data };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="texture-admin-test"></div>';
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('cache_stats')) {
      return response({
        success: true,
        stats: {
          total_textures: 1,
          total_size_mb: 0.1,
          by_type: { '<svg onload=alert(1)>': { count: 1, size: 1024 } },
        },
      });
    }
    return response({
      success: true,
      textures: [{
        type: '<img src=x onerror=alert(1)>',
        cache_key: '"><svg onload=alert(1)>-long-cache-key',
        size_bytes: 1024,
      }],
    });
  }));
  window.eval(source);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Texture admin DOM rendering', () => {
  it('renders cache metadata as text and keeps cache keys in data properties', async () => {
    const ui = new window.GQTextureAdminUI('#texture-admin-test');
    await ui.loadCacheList();

    const table = document.querySelector('#cache-list-container table');
    expect(table.querySelectorAll('img, svg')).toHaveLength(0);
    expect(table.querySelectorAll('tr')[1].querySelector('td').textContent)
      .toBe('<img src=x onerror=alert(1)>');
    const button = table.querySelector('.btn-regen');
    expect(button.dataset.cacheKey).toBe('"><svg onload=alert(1)>-long-cache-key');
    const regen = vi.fn();
    ui.regenTexture = regen;
    button.click();
    expect(regen).toHaveBeenCalledWith('"><svg onload=alert(1)>-long-cache-key');
  });

  it('renders statistics and API error values as text', async () => {
    const ui = new window.GQTextureAdminUI('#texture-admin-test');
    await ui.loadStats();

    const stats = document.querySelector('#stats-container');
    expect(stats.querySelector('svg')).toBeNull();
    expect(stats.querySelector('table tr:nth-child(2) td').textContent)
      .toBe('<svg onload=alert(1)>');
  });

  it('renders prompt response values as text', async () => {
    const ui = new window.GQTextureAdminUI('#texture-admin-test');
    ui.postAdminAction = async () => response({
      success: true,
      prompt_id: '<img src=x onerror=alert(1)>',
    });
    const event = { preventDefault: vi.fn() };

    await ui.handleTestPrompt(event);

    const result = document.querySelector('#test-result');
    expect(result.textContent).toBe('Submitted! ID: <img src=x onerror=alert(1)>');
    expect(result.querySelector('img')).toBeNull();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
