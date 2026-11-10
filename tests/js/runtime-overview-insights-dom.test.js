import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeOverviewInsights.js');

function loadModule() {
  delete window.GQRuntimeOverviewInsights;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeOverviewInsights;
}

describe('RuntimeOverviewInsights DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes risk and resource values and only emits allowlisted actions', () => {
    const insights = loadModule().createOverviewInsights({
      esc: String,
      fmt: () => '<img src=x onerror=alert(1)>',
      getUiState: () => ({ resourceInsight: 'metal' }),
      getCurrentColony: () => ({
        name: '<svg onload=alert(2)>',
        galaxy: 1,
        system: 2,
        position: 3,
      }),
      getResourceInsightConfig: () => ({
        key: 'metal',
        icon: '<iframe src=javascript:alert(3)>',
        label: '<b onclick=alert(4)>',
        desc: '<img src=x onerror=alert(5)>',
        focusBuilding: 'solar_plant',
        rateKey: 'metal',
        transportable: true,
        tradeable: true,
      }),
      getResourceInsightValue: () => 10,
      getResourceInsightTotal: () => 20,
      formatResourceInsightValue: () => '<svg onload=alert(6)>',
    });

    const resourceRoot = document.createElement('div');
    resourceRoot.innerHTML = insights.buildResourceInsightHtml({
      economy: { net_rates_per_hour: { metal: 5 } },
    }, {});
    expect(resourceRoot.querySelector('img, svg, iframe, b')).toBeNull();
    expect(resourceRoot.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(resourceRoot.querySelectorAll('[data-resource-action]')).toHaveLength(5);
    expect(resourceRoot.textContent).toContain('<svg onload=alert(2)>');
    expect(resourceRoot.textContent).toContain('<img src=x onerror=alert(1)>');

    const invalidInsights = loadModule().createOverviewInsights({
      getUiState: () => ({ resourceInsight: 'invalid' }),
      getCurrentColony: () => ({}),
      getResourceInsightConfig: () => ({
        key: '<img src=x onerror=alert(7)>',
        focusBuilding: 'untrusted_building',
        transportable: true,
        tradeable: true,
      }),
    });
    const invalidConfigRoot = document.createElement('div');
    invalidConfigRoot.innerHTML = invalidInsights.buildResourceInsightHtml(null, {});
    expect(invalidConfigRoot.querySelectorAll('[data-resource-action]')).toHaveLength(0);
  });

  it('escapes offline risk data and omits actions for invalid colony IDs', () => {
    const insights = loadModule().createOverviewInsights({
      fmt: (value) => `<strong>${value}</strong>`,
      esc: String,
    });
    const root = document.createElement('div');
    root.innerHTML = insights.buildOfflineSummaryHtml({
      had_offline_time: true,
      max_elapsed_seconds: 120,
      economy: {
        net_rates_per_hour: { metal: 1 },
        status_counts: { stable: '<img src=x onerror=alert(1)>', watch: 0, strain: 0 },
        avg_welfare: 75,
        top_risks: [{
          colony_id: '4junk',
          colony_name: '<img src=x onerror=alert(2)>',
          status: '<svg onload=alert(3)>',
          risk_score: 9,
          food_rate_per_hour: 1,
          energy: 2,
          risk_flags: ['<b onclick=alert(4)>'],
        }],
      },
    });

    expect(root.querySelector('img, svg, b')).toBeNull();
    expect(root.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(root.querySelector('[data-risk-action]')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(2)>');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
