import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/rendering/ColonyViewRenderer.js');

function loadRenderer() {
  window.ViewRenderer = class {};
  delete window.ColonyViewRenderer;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.ColonyViewRenderer;
}

describe('ColonyViewRenderer building health', () => {
  beforeEach(() => {
    loadRenderer();
  });

  function renderHealth(health) {
    const renderer = Object.create(window.ColonyViewRenderer.prototype);
    renderer._selectedBuilding = { name: 'Habitat', type: 'residential', level: 1, health };
    renderer._getBuildingColor = () => '#fff';
    const labels = [];
    renderer._renderBuildingView({
      fillRect: () => {},
      fillText: (text) => labels.push(text),
    });
    return labels.find((label) => label.startsWith('Health:'));
  }

  it('does not infer full health when the building has no health measurement', () => {
    expect(renderHealth(undefined)).toBe('Health: Unavailable');
  });

  it('renders explicit zero and valid health values', () => {
    expect(renderHealth(0)).toBe('Health: 0%');
    expect(renderHealth(63.6)).toBe('Health: 64%');
  });

  it('omits invalid health values instead of clamping them', () => {
    expect(renderHealth(130)).toBe('Health: Unavailable');
  });
});
