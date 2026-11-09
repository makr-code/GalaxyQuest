// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let controller;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="galaxy-container"></div>
    <section data-role="system-detail"></section>
  `;
  window.eval(readFileSync(path.resolve('js/features/galaxy/galaxy-controller.js'), 'utf8'));
  controller = new window.GalaxyController({});
});

describe('GalaxyController DOM rendering', () => {
  it('renders system details as text rather than interpreting system data as HTML', () => {
    const systemDetail = {
      system: {
        name: '<img src=x onerror=alert(1)>',
        spectral_class: '<svg onload=alert(1)>',
        subtype: '<script>alert(1)</script>',
        planet_count: 3,
      },
    };
    const rendered = document.querySelector('[data-role="system-detail"]');
    let eventDetail;
    rendered.addEventListener('system-detail-rendered', (event) => {
      eventDetail = event.detail;
    });

    controller.renderSystemDetail(systemDetail);

    expect(rendered.querySelectorAll('h2, dt, dd')).toHaveLength(5);
    expect(rendered.querySelector('h2').textContent).toBe(systemDetail.system.name);
    expect(rendered.querySelectorAll('dd')[0].textContent)
      .toBe(`${systemDetail.system.spectral_class}${systemDetail.system.subtype}`);
    expect(rendered.querySelectorAll('dd')[1].textContent).toBe('3');
    expect(rendered.querySelector('img, svg, script')).toBeNull();
    expect(eventDetail).toBe(systemDetail);
  });

  it('renders service error codes and messages as text', () => {
    vi.useFakeTimers();
    try {
      const error = {
        code: '<img src=x onerror=alert(1)>',
        message: '<svg onload=alert(1)>',
      };

      controller.showError(error);

      const rendered = document.querySelector('.error-message');
      expect(rendered.textContent).toBe(`[${error.code}]: ${error.message}`);
      expect(rendered.querySelector('img, svg')).toBeNull();
      vi.runOnlyPendingTimers();
      expect(rendered.isConnected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
