import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sequencePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeBootSetupSequence.js');
const contextPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeBootSetupContext.js');

function loadSequenceModule() {
  delete window.GQRuntimeBootSetupSequence;
  window.eval(fs.readFileSync(sequencePath, 'utf8'));
  return window.GQRuntimeBootSetupSequence;
}

function loadContextModule() {
  delete window.GQRuntimeBootSetupContext;
  window.eval(fs.readFileSync(contextPath, 'utf8'));
  return window.GQRuntimeBootSetupContext;
}

function createBaseSetup(eventBus = null, windowRef = {}) {
  const fallbackWindowRef = { navigator: { onLine: true }, ...windowRef };
  return {
    logoutHandlerApi: { bindLogoutHandler: vi.fn() },
    badgeLoaderApi: { createBadgeLoader: vi.fn(() => ({ loadBadge: vi.fn() })) },
    realtimeSyncSetupApi: { setupRealtimeSync: vi.fn() },
    startupBootSetupApi: { setupStartupBoot: vi.fn() },
    footerUiKitSetupApi: { setupFooterUiKit: vi.fn() },
    postBootFlowSetupApi: { runPostBootFlowSetup: vi.fn().mockResolvedValue(undefined) },
    colonyVfxDebugWidgetSetupApi: { setupColonyVfxDebugWidget: vi.fn() },
    loadNetworkEventsApi: { registerLoadAndNetworkRuntimeEvents: vi.fn() },
    renderTelemetryHookApi: {
      configureRenderTelemetryRuntime: vi.fn(),
      installRenderTelemetryHook: vi.fn(),
    },
    realtimeSyncApi: {},
    startupBootApi: {},
    footerUiKitApi: {},
    postBootFlowApi: {},
    colonyVfxDebugWidgetApi: {},
    messagesController: {},
    audioManager: {},
    api: {},
    gameLog: vi.fn(),
    localStorageRef: {},
    sessionStorageRef: {},
    windowRef: fallbackWindowRef,
    documentRef: {},
    loadOverview: vi.fn(),
    invalidateGetCache: vi.fn(),
    refreshWindow: vi.fn(),
    getGalaxyRoot: vi.fn(() => null),
    refreshGalaxyDensityMetrics: vi.fn(),
    refreshFooterNetworkStatus: vi.fn(),
    showToast: vi.fn(),
    eventSourceFactory: vi.fn(),
    eventBus,
    runtimeCore: null,
    setFooterLoadProgress: vi.fn(),
    setFooterNetworkStatus: vi.fn(),
    redirectToLogin: vi.fn(),
    pushGalaxyDebugError: vi.fn(),
    getLastLoadErrorToastAt: vi.fn(() => 0),
    setLastLoadErrorToastAt: vi.fn(),
    wm: {},
    loadAudioTrackCatalog: vi.fn(),
    refreshAudioUi: vi.fn(),
    updateFooterQuickNavBadge: vi.fn(),
    settingsState: {},
    focusHomeSystemInGalaxy: vi.fn(),
    initSystemBreadcrumb: vi.fn(),
    advisorWidget: {},
    esc: vi.fn((v) => String(v ?? '')),
    logger: console,
  };
}

describe('RuntimeBootSetupSequence event bus integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards eventBus to realtime sync setup and connects combat bridge', async () => {
    const mod = loadSequenceModule();
    const eventBus = { emit: vi.fn() };
    const combatBridge = { connectEventBus: vi.fn() };
    const setup = createBaseSetup(eventBus, { GQCombatVfxBridge: combatBridge });

    await mod.runBootSetupSequence(setup);

    expect(setup.realtimeSyncSetupApi.setupRealtimeSync).toHaveBeenCalledWith(expect.objectContaining({
      eventBus,
    }));
    expect(combatBridge.connectEventBus).toHaveBeenCalledWith(eventBus);
    expect(setup.renderTelemetryHookApi.configureRenderTelemetryRuntime).toHaveBeenCalledWith(expect.objectContaining({
      showToast: setup.showToast,
      windowRef: setup.windowRef,
    }));
    expect(setup.renderTelemetryHookApi.installRenderTelemetryHook).toHaveBeenCalled();
    expect(setup.loadNetworkEventsApi.registerLoadAndNetworkRuntimeEvents).toHaveBeenCalledWith(expect.objectContaining({
      setFooterLoadProgress: setup.setFooterLoadProgress,
      setFooterNetworkStatus: setup.setFooterNetworkStatus,
      pushGalaxyDebugError: setup.pushGalaxyDebugError,
    }));
  });

  it('skips combat bridge event bus connect when bus is missing', async () => {
    const mod = loadSequenceModule();
    const combatBridge = { connectEventBus: vi.fn() };
    const setup = createBaseSetup(null, { GQCombatVfxBridge: combatBridge });

    await mod.runBootSetupSequence(setup);

    expect(setup.realtimeSyncSetupApi.setupRealtimeSync).toHaveBeenCalledWith(expect.objectContaining({
      eventBus: null,
    }));
    expect(combatBridge.connectEventBus).not.toHaveBeenCalled();
  });

  it('skips optional module calls when missing', async () => {
    const mod = loadSequenceModule();
    const setup = createBaseSetup(null, {});
    setup.renderTelemetryHookApi = null;
    setup.loadNetworkEventsApi = null;

    await mod.runBootSetupSequence(setup);

    expect(setup.realtimeSyncSetupApi.setupRealtimeSync).toHaveBeenCalled();
  });

  it('passes runtimeCore to registerLoadAndNetworkRuntimeEvents', async () => {
    const mod = loadSequenceModule();
    const fakeCore = { bindWindowEvent: vi.fn(() => () => {}) };
    const setup = createBaseSetup(null, {});
    setup.runtimeCore = fakeCore;

    await mod.runBootSetupSequence(setup);

    expect(setup.loadNetworkEventsApi.registerLoadAndNetworkRuntimeEvents).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeCore: fakeCore })
    );
  });
});

describe('RuntimeBootSetupContext event bus passthrough', () => {
  it('includes eventBus and integration handles in built boot setup context', () => {
    const mod = loadContextModule();
    const eventBus = { emit: vi.fn() };
    const loadNetworkEventsApi = { registerLoadAndNetworkRuntimeEvents: vi.fn() };
    const renderTelemetryHookApi = { configureRenderTelemetryRuntime: vi.fn(), installRenderTelemetryHook: vi.fn() };
    const getLastLoadErrorToastAt = vi.fn(() => 0);
    const setLastLoadErrorToastAt = vi.fn();
    const context = mod.createBootSetupContextBuilder().build({
      eventBus,
      loadNetworkEventsApi,
      renderTelemetryHookApi,
      getLastLoadErrorToastAt,
      setLastLoadErrorToastAt,
    });

    expect(context.eventBus).toBe(eventBus);
    expect(context.loadNetworkEventsApi).toBe(loadNetworkEventsApi);
    expect(context.renderTelemetryHookApi).toBe(renderTelemetryHookApi);
    expect(context.getLastLoadErrorToastAt).toBe(getLastLoadErrorToastAt);
    expect(context.setLastLoadErrorToastAt).toBe(setLastLoadErrorToastAt);
  });
});
