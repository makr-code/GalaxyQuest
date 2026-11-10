import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeQuickNavFacade.js');

function loadModule() {
  delete window.GQRuntimeQuickNavFacade;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeQuickNavFacade;
}

describe('RuntimeQuickNavFacade DOM output', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('escapes persisted favorites and previous search text despite an identity callback', () => {
    window.localStorage.setItem('gq_quicknav', JSON.stringify({
      favorites: [
        {
          key: 'untrusted-key',
          galaxy_index: 1,
          system_index: 2,
          name: '<img src=x onerror=alert(1)>',
          catalog_name: '<svg onload=alert(2)>',
          spectral_class: 'G"><b onclick=alert(3)>',
          subtype: '<i onmouseover=alert(4)>',
          ribbon: 'home" onclick="alert(5)',
        },
        { galaxy_index: '3junk', system_index: 4, name: 'invalid' },
      ],
    }));
    const root = document.createElement('div');
    root.innerHTML = '<input id="qn-search" value="trusted initial value">';
    root.querySelector('#qn-search').value = '"><img src=x onerror=alert(6)>';
    document.body.appendChild(root);
    const facade = loadModule().createQuickNavFacade({
      wm: { body: () => root },
      documentRef: document,
      esc: String,
    });

    facade.renderQuickNav();
    const search = root.querySelector('#qn-search');
    expect(search.value).toBe('"><img src=x onerror=alert(6)>');
    search.value = '';
    search.dispatchEvent(new Event('input'));

    expect(root.querySelector('img, svg, b, i')).toBeNull();
    expect(root.querySelector('[onerror], [onload], [onclick], [onmouseover]')).toBeNull();
    expect(root.querySelectorAll('.quicknav-item')).toHaveLength(1);
    expect(root.querySelector('.quicknav-item')?.dataset.favKey).toBe('1:2');
    expect(root.querySelector('.quicknav-item-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('.quicknav-item-class')?.textContent)
      .toBe('G"><b onclick=alert(3)><i onmouseover=alert(4)>');
    expect(root.querySelector('.quicknav-ribbon-dot')?.getAttribute('data-r')).toBe('');
  });

  it('ignores malformed favorite actions and constrains ribbon updates', () => {
    window.localStorage.setItem('gq_quicknav', JSON.stringify({
      favorites: [{ galaxy_index: 1, system_index: 2, name: 'Sol', ribbon: 'home' }],
    }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const facade = loadModule().createQuickNavFacade({
      wm: { body: () => root, open: vi.fn() },
      documentRef: document,
      runPhysicsCinematicFlight: vi.fn(async () => ({ ok: true })),
    });

    facade.renderQuickNav();
    const removeButton = root.querySelector('.quicknav-item-btn.remove');
    removeButton.dataset.favKey = '1:2junk';
    removeButton.click();
    expect(facade.getQuickNavFavorites()).toHaveLength(1);

    facade.setFavoriteRibbon('1:2', 'home" onclick="alert(1)');
    expect(facade.getQuickNavFavorites()[0].ribbon).toBe('');
    expect(root.querySelector('[onclick]')).toBeNull();
  });
});
