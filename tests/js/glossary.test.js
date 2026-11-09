// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadGlossary(sourceTransform = (source) => source) {
  const source = sourceTransform(readFileSync(path.resolve('js/ui/glossary.js'), 'utf8'));
  window.eval(source);
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Glossary modal DOM rendering', () => {
  it('renders glossary catalog values as text and creates only approved HTTPS links', () => {
    const hostileValue = '<img src=x onerror=alert(1)>';
    loadGlossary((source) => source.replace(
      "term: 'White Dwarf',",
      `term: ${JSON.stringify(hostileValue)},`,
    ));

    window.openGlossaryModal();

    const modal = document.querySelector('.glossary-modal');
    const entry = modal.querySelector('[data-term="white_dwarf"]');
    expect(entry.querySelector('h3').textContent).toBe(hostileValue);
    expect(entry.querySelector('img')).toBeNull();
    expect(modal.querySelectorAll('.glossary-entry').length).toBeGreaterThan(1);
    expect(Array.from(modal.querySelectorAll('.glossary-links a')).every(
      (link) => link.protocol === 'https:' && link.rel === 'noopener',
    )).toBe(true);

    const search = modal.querySelector('#glossary-search-input');
    search.value = 'White Dwarf';
    search.dispatchEvent(new Event('input'));
    expect(entry.style.display).toBe('block');
    expect(modal.querySelector('[data-term="main_sequence"]').style.display).toBe('none');
  });

  it('rejects external glossary URLs outside the approved HTTPS hosts', () => {
    loadGlossary((source) => source.replace(
      "wikipedia: 'https://en.wikipedia.org/wiki/White_dwarf',",
      'wikipedia: "javascript:alert(1)",',
    ));

    expect(() => window.openGlossaryModal()).toThrow('Unsupported glossary link URL');
    expect(document.querySelector('.glossary-modal')).toBeNull();
  });
});
