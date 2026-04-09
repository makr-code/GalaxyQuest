import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const helpersPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeSystemBreadcrumbHelpers.js');

function loadModule() {
  delete window.GQRuntimeSystemBreadcrumbHelpers;
  window.eval(fs.readFileSync(helpersPath, 'utf8'));
  return window.GQRuntimeSystemBreadcrumbHelpers;
}

describe('RuntimeSystemBreadcrumbHelpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.GQRuntimeSystemBreadcrumbHelpers;
    delete window.SystemBreadcrumbIntegration;
  });

  it('initSystemBreadcrumb creates and stores integration', () => {
    const mod = loadModule();
    const integration = { onSystemEnter: vi.fn(), onSystemExit: vi.fn() };
    window.SystemBreadcrumbIntegration = vi.fn(function SystemBreadcrumbIntegrationMock() {
      return integration;
    });
    const setIntegration = vi.fn();

    mod.initSystemBreadcrumb({
      windowRef: window,
      setIntegration,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(window.SystemBreadcrumbIntegration).toHaveBeenCalledOnce();
    expect(setIntegration).toHaveBeenCalledWith(integration);
  });

  it('trigger enter and exit forward to integration handlers', () => {
    const mod = loadModule();
    const integration = { onSystemEnter: vi.fn(), onSystemExit: vi.fn() };

    mod.triggerSystemBreadcrumbEnter({ systemId: 12 }, { renderer: true }, {
      getIntegration: () => integration,
      logger: { warn: vi.fn() },
    });
    mod.triggerSystemBreadcrumbExit({
      getIntegration: () => integration,
      logger: { warn: vi.fn() },
    });

    expect(integration.onSystemEnter).toHaveBeenCalledWith({ systemId: 12 }, { renderer: true });
    expect(integration.onSystemExit).toHaveBeenCalledOnce();
  });
});
