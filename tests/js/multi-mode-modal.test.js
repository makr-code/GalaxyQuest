// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="generation-status"></div>
    <button id="submit-btn"></button>
    <div id="job-list"></div>
  `;
  window.eval(readFileSync(path.resolve('js/components/multi-mode-modal.js'), 'utf8'));
});

describe('MultiModeGenerationModal', () => {
  it('renders labels and queue IDs as text instead of interpreting them as HTML', () => {
    const modal = window.multiModeModal;
    modal.pollJobStatus = () => {};

    modal.showGenerationStatus(
      { queue_id: '<img src=x onerror=alert(1)>' },
      '<svg onload=alert(1)>',
    );

    const jobCard = document.querySelector('.job-card');
    expect(jobCard.querySelector('.job-header').textContent)
      .toBe('<svg onload=alert(1)>ID: <img src=x onerror=alert(1)>');
    expect(jobCard.querySelector('img, svg')).toBeNull();
    expect(jobCard.querySelector('.progress-fill').style.width).toBe('5%');
    expect(jobCard.querySelector('.status-badge').textContent).toBe('PENDING');
  });
});
