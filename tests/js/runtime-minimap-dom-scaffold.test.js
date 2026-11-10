import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeMinimapDomScaffold.js');

function loadModule() {
  delete window.GQRuntimeMinimapDomScaffold;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeMinimapDomScaffold;
}

describe('RuntimeMinimapDomScaffold', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('builds the minimap scaffold using static DOM elements and text', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>replace me</p>';
    const scaffold = loadModule().createMinimapDomScaffold();

    const result = scaffold.ensure(root);

    expect(result.wrap).toBe(root.querySelector('.minimap-wrap'));
    expect(result.canvas).toBe(root.querySelector('.minimap-canvas'));
    expect(result.hud).toBe(root.querySelector('.minimap-hud'));
    expect(root.querySelector('.minimap-badge').textContent).toBe('LIVE');
    expect(root.querySelector('.minimap-meta').textContent).toBe('Ziehen bewegt die Kamera');
    expect(root.querySelector('.minimap-hint').textContent).toBe('Klick fokussiert Systeme, Mausrad zoomt');
    expect(root.querySelector('p')).toBeNull();
  });

  it('reuses existing scaffold nodes without replacing custom children', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="minimap-wrap"><canvas class="minimap-canvas"></canvas><div class="minimap-hud"><i>existing</i></div></div>';
    const scaffold = loadModule().createMinimapDomScaffold();

    const result = scaffold.ensure(root);

    expect(root.querySelector('.minimap-wrap')).toBe(result.wrap);
    expect(result.hud.querySelector('i')?.textContent).toBe('existing');
    expect(result.wrap.querySelectorAll('.minimap-canvas')).toHaveLength(1);
  });
});
