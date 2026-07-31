import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancedRenderingUI } from '../../js/engine/AdvancedRenderingUI.js';

describe('AdvancedRenderingUI', () => {
  let mockEngine;
  let colorblindSelect;
  let originalDocument;

  beforeEach(() => {
    mockEngine = {};
    colorblindSelect = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    originalDocument = global.document;
    global.document = {
      getElementById: (id) => (id === 'adv-rendering-colorblind' ? colorblindSelect : null),
    };
  });

  afterEach(() => {
    global.document = originalDocument;
  });

  it('reuses the bound colorblind listener for attach and dispose', () => {
    const ui = new AdvancedRenderingUI(mockEngine);

    ui._attachEventListeners();
    const [[, handler]] = colorblindSelect.addEventListener.mock.calls;

    ui.dispose();

    expect(colorblindSelect.removeEventListener).toHaveBeenCalledWith('change', handler);
  });
});
