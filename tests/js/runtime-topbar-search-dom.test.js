import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeTopbarSearch.js');

function loadModule() {
  delete window.GQRuntimeTopbarSearch;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeTopbarSearch;
}

describe('RuntimeTopbarSearch DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes star values internally even with an identity escaper', () => {
    const overlay = document.createElement('div');
    overlay.id = 'topbar-search-overlay';
    document.body.appendChild(overlay);
    const store = {
      open: true,
      localResults: [{
        id: 1,
        name: '<img src=x onerror=alert(1)>',
        galaxy_index: '1"><svg onload=alert(2)>',
        system_index: '2"><img src=x onerror=alert(3)>',
        spectral_class: 'G"><b onclick=alert(4)>',
        subtype: 2,
      }],
      serverResults: [{
        id: 2,
        catalog_name: '<svg onload=alert(5)>',
        galaxy_index: 3,
        system_index: 4,
      }],
    };
    const mod = loadModule();
    mod.configureTopbarSearchRuntime({
      getTopbarSearchStore: () => store,
      documentRef: document,
      esc: String,
    });

    mod.renderTopbarSearchOverlay();

    expect(overlay.querySelectorAll('img, svg, b')).toHaveLength(0);
    expect(overlay.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(overlay.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(overlay.textContent).toContain('1:0');
    expect(overlay.textContent).toContain('<svg onload=alert(5)>');
    expect(overlay.querySelectorAll('.topbar-search-item')).toHaveLength(2);
    expect(overlay.querySelector('[data-search-source="local"]')?.dataset.searchIndex).toBe('0');
    expect(overlay.querySelector('[data-search-source="server"]')?.dataset.searchIndex).toBe('0');
  });

  it('ignores malformed result source and index attributes when binding clicks', async () => {
    const overlay = document.createElement('div');
    overlay.id = 'topbar-search-overlay';
    document.body.appendChild(overlay);
    const localStar = { id: 'expected-local' };
    const serverStar = { id: 'expected-server' };
    const store = {
      open: true,
      localResults: [localStar],
      serverResults: [serverStar],
      closeOverlay: vi.fn(),
    };
    const onJumpToSearchStar = vi.fn(async () => {});
    const mod = loadModule();
    mod.configureTopbarSearchRuntime({
      getTopbarSearchStore: () => store,
      documentRef: document,
      onJumpToSearchStar,
    });
    mod.renderTopbarSearchOverlay();

    const button = overlay.querySelector('.topbar-search-item');
    button.dataset.searchSource = 'invalid';
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onJumpToSearchStar).not.toHaveBeenCalled();

    button.dataset.searchSource = 'local';
    button.dataset.searchIndex = '0.5';
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onJumpToSearchStar).not.toHaveBeenCalled();

    button.dataset.searchSource = 'server';
    button.dataset.searchIndex = '0';
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onJumpToSearchStar).toHaveBeenCalledWith(serverStar);
  });
});
