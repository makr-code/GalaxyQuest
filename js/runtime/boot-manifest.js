(function () {
  const V = Object.freeze({
    bootManifest: '20260407p2',
    bootAssets: '20260404p1',
    terminal: '20260404p51',
    starfield: '20260404p110',
    prolog: '1',
    auth: '20260404p111',
    assetCore: '20260404p50',
    tts: '20260404p1',
    webgpuCore: '20260401p1',
    runtime: '20260407p2',
    galaxyController: '20260404p2',
    footerNetworkStatus: '20260404p3',
    galaxyStarLoaderFacade: '20260404p4',
    galaxyInit3D: '20260404p10',
    quickNav: '20260404p1',
    inputController: '20260402p1',
    inputContexts: '20260402p3',
    inputActions: '20260402p2',
    debrisManager: '20260404p1',
    sceneLight: '20260402p4',
    galaxyRendererConfig: '20260329p76',
    galaxyRendererBinding: '20260329p77',
    starfieldWebGpu: '20260330p2',
    combatFx: '20260402p1',
    galaxyRendererWebGpu: '20260404p4',
    legacyWebGpu: '20260404p2',
    gqui: '20260330p1',
    uiGlossary: '20260331p50',
    uiKit: '20260331p62',
    starTooltip: '20260331p51',
    systemInfoPanel: '20260331p54',
    stellarisSystemOverview: '20260408p1',
    systemBodiesCardWindow:  '20260408p1',
    hrDiagram: '20260328p49',
    settingsPanel: '20260331p7',
    settings2fa: '20260331p2',
    adminUsers: '20260331p1',
    systemBreadcrumb: '20260331p1',
    game: '20260407p2',
    packageBundle: '20260407p1',
    flightDriverSmoke: '20260329p1',
    lodStreamingSmoke: '20260329p2'
  });

  const CDN = Object.freeze({
    dexie: 'js/vendor/dexie.min.js',
    three: 'js/vendor/three.min.js',
    mustache: 'js/vendor/mustache.min.js'
  });

  const assetVersions = Object.freeze({
    wm: '20260406p2',
    wmWidgets: '20260406p2',
    gqwm: '20260407p1',
    audio: V.assetCore,
    gqui: V.gqui,
    galaxyCameraController: '20260329p85',
    textureManager: V.assetCore,
    geometryManager: V.assetCore,
    materialFactory: V.assetCore,
    lightRigManager: V.assetCore,
    galaxyRendererCore: '20260404p118'
  });

  function localScript(path, version) {
    return `${path}?v=${version}`;
  }

  function localScripts(paths, version) {
    return paths.map(function (path) {
      return localScript(path, version);
    });
  }

  window.GQ_ASSETS_MANIFEST_VERSION = 2;
  window.__GQ_ASSET_VERSIONS = Object.assign({}, window.__GQ_ASSET_VERSIONS || {}, assetVersions);

  window.__GQ_DIRECT_BOOT_SCRIPTS = [
    { src: 'js/runtime/boot-manifest.js', version: V.bootManifest },
    { src: 'js/runtime/boot-assets.js', version: V.bootAssets },
    { src: 'js/ui/terminal.js', version: V.terminal },
    { src: 'js/rendering/starfield.js', version: V.starfield },
    { src: 'js/ui/prolog.js', version: V.prolog },
    { src: 'js/network/auth.js', version: V.auth }
  ];

  window.__GQ_LAZY_LOCAL_SCRIPTS = [
    { path: 'js/rendering/galaxy-camera-controller.js', versionKey: 'galaxyCameraController', fallbackVersion: assetVersions.galaxyCameraController, consumer: 'starfield' },
    { path: 'js/rendering/texture-manager.js', versionKey: 'textureManager', fallbackVersion: assetVersions.textureManager, consumer: 'starfield' },
    { path: 'js/rendering/geometry-manager.js', versionKey: 'geometryManager', fallbackVersion: assetVersions.geometryManager, consumer: 'starfield' },
    { path: 'js/rendering/material-factory.js', versionKey: 'materialFactory', fallbackVersion: assetVersions.materialFactory, consumer: 'starfield' },
    { path: 'js/rendering/light-rig-manager.js', versionKey: 'lightRigManager', fallbackVersion: assetVersions.lightRigManager, consumer: 'starfield' },
    { path: 'js/rendering/galaxy-renderer-core.js', versionKey: 'galaxyRendererCore', fallbackVersion: assetVersions.galaxyRendererCore, consumer: 'starfield' }
  ];

  const bootScriptsCore = []
    .concat([
      localScript('js/runtime/wm.js', assetVersions.wm),
      localScript('js/runtime/wm-widgets.js', assetVersions.wmWidgets),
      localScript('js/runtime/gqwm.js', assetVersions.gqwm),
      localScript('js/network/binary-decoder.js', V.assetCore),
      localScript('js/network/binary-decoder-v2.js', V.assetCore),
      localScript('js/network/binary-decoder-v3.js', V.assetCore),
      localScript('js/network/api.js', V.assetCore),
      localScript('js/network/api-contracts.js', V.assetCore),
      CDN.dexie,
      localScript('js/runtime/galaxy-model.js', V.assetCore),
      localScript('js/runtime/galaxy-db.js', V.assetCore),
      localScript('js/runtime/audio.js', V.assetCore),
      localScript('js/runtime/tts.js', V.tts),
      CDN.three,
      localScript('js/engine/core/GraphicsContext.js', V.assetCore),
      localScript('js/engine/webgpu/WebGPURenderPass.js', V.webgpuCore),
      localScript('js/engine/webgpu/WebGPUShader.js', V.webgpuCore),
      localScript('js/engine/core/WebGPURenderer.js', V.webgpuCore),
      localScript('js/engine/core/WebGLRenderer.js', V.assetCore),
      localScript('js/engine/core/RendererFactory.js', V.webgpuCore)
    ])
    .concat(localScripts([
      'js/engine/EventBus.js',
      'js/engine/GameLoop.js'
    ], V.runtime));

  const bootScriptsRuntimeFoundation = []
    .concat(localScripts([
      'js/engine/runtime/RuntimeCore.js',
      'js/engine/runtime/layers/core/LifecyclePhases.js',
      'js/engine/runtime/layers/core/FeatureRegistry.js',
      'js/engine/runtime/layers/core/LifecycleManager.js',
      'js/engine/runtime/layers/core/GameContextRefs.js',
      'js/engine/runtime/RuntimeLifecycleCoreFeatures.js',
      'js/engine/runtime/RuntimeLifecycleDomainFeatures.js',
      'js/engine/runtime/RuntimeSelectionState.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/GalaxyRendererBootstrap.js', V.galaxyController),
      localScript('js/engine/runtime/RuntimeLoadNetworkEvents.js', V.runtime)
    ])
    .concat(localScripts([
      'js/engine/runtime/layers/ui/settings/foundation/Defaults.js',
      'js/engine/runtime/layers/ui/settings/audio/SettingsMetadata.js',
      'js/engine/runtime/layers/ui/settings/foundation/Storage.js',
      'js/engine/runtime/layers/ui/settings/foundation/Normalization.js',
      'js/engine/runtime/RuntimeThemePalette.js',
      'js/engine/runtime/layers/ui/settings/foundation/Bootstrap.js',
      'js/engine/runtime/RuntimeResourceInsight.js',
      'js/engine/runtime/RuntimeHints.js',
      'js/engine/runtime/RuntimeTopbarA11y.js',
      'js/engine/runtime/RuntimeTopbarSearchStore.js',
      'js/engine/runtime/RuntimeTopbarSearch.js',
      'js/engine/runtime/layers/domain/galaxy/SearchScoring.js',
      'js/engine/runtime/layers/domain/galaxy/PhysicsFlight.js',
      'js/engine/runtime/RuntimeColonySurfaceSlotMapping.js',
      'js/engine/runtime/RuntimeWormholeController.js',
      'js/engine/runtime/RuntimeRealtimeSync.js',
      'js/engine/runtime/layers/bootstrap/StartupBoot.js',
      'js/engine/runtime/layers/bootstrap/PostBootFlow.js',
      'js/engine/runtime/RuntimeColonyVfxDebugWidget.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/RuntimeFooterNetworkStatus.js', V.footerNetworkStatus)
    ])
    .concat(localScripts([
      'js/engine/runtime/RuntimePolicyEngine.js',
      'js/engine/runtime/layers/integration/galaxy/DebugLog.js',
      'js/engine/runtime/RuntimeColonyBuildingLogic.js',
      'js/engine/runtime/RuntimeMessageSignals.js',
      'js/engine/runtime/RuntimeRenderTelemetryHook.js',
      'js/engine/runtime/layers/integration/galaxy/CanvasDebug.js',
      'js/engine/runtime/layers/integration/galaxy/EventProbe.js',
      'js/engine/runtime/layers/integration/galaxy/RendererDebug.js',
      'js/engine/runtime/RuntimePerfTelemetryCommand.js',
      'js/engine/runtime/RuntimeTerminalCommand.js',
      'js/engine/runtime/RuntimeOpenWindowCommand.js',
      'js/engine/runtime/RuntimeMessageSendCommand.js',
      'js/engine/runtime/RuntimeMessageConsoleCommand.js'
    ], V.runtime));

  const bootScriptsGalaxy = []
    .concat(localScripts([
      'js/engine/runtime/layers/ui/galaxy/OverlayControls.js',
      'js/engine/runtime/layers/domain/galaxy/NavActions.js',
      'js/engine/runtime/layers/domain/galaxy/ControllerNavigation.js',
      'js/engine/runtime/layers/domain/galaxy/ControllerActions.js',
      'js/engine/runtime/layers/ui/galaxy/ControllerWindow.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/layers/integration/galaxy/ControllerRenderWindowFlow.js', V.galaxyController)
    ])
    .concat(localScripts([
      'js/engine/runtime/layers/ui/galaxy/ControllerControlUi.js',
      'js/engine/runtime/layers/integration/galaxy/ControllerStarLoading.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/layers/integration/galaxy/ControllerFacade.js', V.galaxyController)
    ])
    .concat(localScripts([
      'js/engine/runtime/layers/integration/galaxy/ControllerBootstrap.js',
      'js/engine/runtime/layers/ui/galaxy/ControlUi.js',
      'js/engine/runtime/layers/integration/galaxy/WindowBindings.js',
      'js/engine/runtime/layers/integration/galaxy/StarLoadingHelpers.js',
      'js/engine/runtime/layers/integration/galaxy/TerritorySync.js',
      'js/engine/runtime/layers/integration/galaxy/CacheRead.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/layers/integration/galaxy/NetworkFlow.js', V.galaxyController)
    ])
    .concat(localScripts([
      'js/engine/runtime/layers/integration/galaxy/FallbackRecovery.js',
      'js/engine/runtime/layers/integration/galaxy/ErrorUi.js',
      'js/engine/runtime/layers/integration/galaxy/UiStatus.js',
      'js/engine/runtime/layers/integration/galaxy/Persistence.js',
      'js/engine/runtime/layers/integration/galaxy/BootstrapPreflight.js',
      'js/engine/runtime/layers/integration/galaxy/FlowOrchestrator.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/layers/integration/galaxy/LoaderFacade.js', V.galaxyStarLoaderFacade),
      localScript('js/engine/runtime/layers/integration/galaxy/Init3DFacade.js', V.galaxyInit3D)
    ])
    .concat(localScripts([
      'js/engine/runtime/layers/integration/galaxy/NavOrbRepeat.js',
      'js/engine/runtime/layers/integration/galaxy/NavOrb.js',
      'js/engine/runtime/layers/domain/commands/CommandParsing.js',
      'js/engine/runtime/layers/ui/commands/TransitionsCommand.js',
      'js/engine/runtime/layers/integration/galaxy/StarTerritorySync.js',
      'js/engine/runtime/layers/integration/galaxy/StarCacheRead.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/layers/integration/galaxy/StarNetworkFlow.js', V.galaxyController)
    ])
    .concat(localScripts([
      'js/engine/runtime/layers/integration/galaxy/StarFallbackRecovery.js',
      'js/engine/runtime/layers/ui/galaxy/StarErrorUi.js',
      'js/engine/runtime/layers/ui/galaxy/StarUiStatus.js',
      'js/engine/runtime/layers/integration/galaxy/StarPersistence.js',
      'js/engine/runtime/layers/integration/galaxy/StarBootstrapPreflight.js',
      'js/engine/runtime/layers/integration/galaxy/StarFlowOrchestrator.js'
    ], V.runtime))
    .concat([
      localScript('js/engine/runtime/layers/integration/galaxy/StarLoaderFacade.js', V.galaxyStarLoaderFacade),
      localScript('js/engine/runtime/layers/integration/galaxy/Init3DFacade.js', V.galaxyInit3D)
    ])
    .concat(localScripts([
      'js/engine/runtime/layers/ui/galaxy/NavOrbRepeat.js',
      'js/engine/runtime/layers/ui/galaxy/NavOrb.js',
      'js/engine/runtime/layers/domain/commands/CommandParsing.js',
      'js/engine/runtime/layers/ui/commands/TransitionsCommand.js',
      'js/engine/runtime/layers/bootstrap/GameBootstrapHelpers.js',
      'js/engine/runtime/layers/bootstrap/GameInfraHelpers.js',
      'js/engine/runtime/layers/ui/system/SystemBreadcrumbHelpers.js',
      'js/engine/runtime/layers/ui/console/CommandRegistry.js',
      'js/engine/runtime/layers/ui/console/MetaCommand.js',
      'js/engine/runtime/layers/ui/admin/AdminVisibility.js',
      'js/engine/runtime/layers/ui/galaxy/VisualUtils.js'
    ], V.runtime));

  const bootScriptsUiRuntime = localScripts([
    'js/engine/runtime/layers/ui/helpers/TemplateHelpers.js',
    'js/engine/runtime/layers/ui/console/Store.js',
    'js/engine/runtime/layers/ui/console/Panel.js',
    'js/engine/runtime/layers/ui/console/CommandExecutor.js',
    'js/engine/runtime/layers/ui/settings/RendererSettingsApply.js',
    'js/engine/runtime/layers/ui/settings/audio/SettingsApply.js',
    'js/engine/runtime/layers/ui/settings/audio/SettingsPanel.js',
    'js/engine/runtime/layers/ui/settings/UiHelpers.js',
    'js/engine/runtime/RuntimePayloadValidation.js',
    'js/engine/runtime/layers/ui/settings/ai/SettingsPanel.js',
    'js/engine/runtime/layers/ui/settings/ftl/SettingsPanel.js',
    'js/engine/runtime/RuntimeAudioCatalog.js',
    'js/engine/runtime/RuntimeTopbarAudioControls.js',
    'js/engine/runtime/RuntimeFooterUiKit.js',
    'js/engine/runtime/layers/ui/settings/theme/SettingsUi.js',
    'js/engine/runtime/layers/ui/settings/SettingsController.js',
    'js/engine/runtime/RuntimeUserMenuActions.js',
    'js/engine/runtime/RuntimeUserMenuUi.js',
    'js/engine/runtime/RuntimeAudioUi.js',
    'js/engine/runtime/RuntimeDesktopShell.js'
  ], V.runtime);

  const bootScriptsControllers = localScripts([
    'js/engine/runtime/RuntimeFleetMissionDefaults.js',
    'js/engine/runtime/RuntimeFleetSubmitFlow.js',
    'js/engine/runtime/RuntimeFleetStatusPanels.js',
    'js/engine/runtime/RuntimeFleetController.js',
    'js/engine/runtime/RuntimeEconomyFlowController.js',
    'js/engine/runtime/RuntimeResearchController.js',
    'js/engine/runtime/RuntimeBuildingsController.js',
    'js/engine/runtime/RuntimeColonyViewController.js',
    'js/engine/runtime/RuntimeColonyWarnings.js',
    'js/engine/runtime/RuntimeBuildingUpgradePreview.js',
    'js/engine/runtime/RuntimeOverviewInsights.js',
    'js/engine/runtime/RuntimeOverviewLists.js',
    'js/engine/runtime/RuntimeOverviewActions.js',
    'js/engine/runtime/RuntimeOverviewController.js',
    'js/engine/runtime/RuntimeOverviewBootstrap.js',
    'js/engine/runtime/RuntimeDevelopmentControllersBootstrap.js',
    'js/engine/runtime/RuntimeShipyardController.js',
    'js/ui/ShipHangarViewer.js',
    'js/engine/runtime/RuntimeMessagesController.js',
    'js/engine/runtime/RuntimeIntelController.js',
    'js/engine/runtime/RuntimeLeadersController.js',
    'js/engine/runtime/RuntimeAlliancesController.js',
    'js/engine/runtime/RuntimeTradeProposalsController.js',
    'js/engine/runtime/RuntimeTradeRoutesController.js',
    'js/engine/runtime/RuntimeTradersDashboardController.js',
    'js/engine/runtime/RuntimePiratesController.js',
    'js/engine/runtime/RuntimeWarController.js',
    'js/engine/runtime/RuntimeEconomyController.js',
    'js/engine/runtime/RuntimeConflictDashboard.js',
    'js/engine/runtime/NpcAvatarRenderer.js',
    'js/engine/runtime/RuntimeFactionsController.js',
    'js/engine/runtime/RuntimeDiplomacyDataModel.js',
    'js/engine/runtime/RuntimeDiplomacyPanel.js',
    'js/engine/runtime/RuntimeContractNegotiationModal.js',
    'js/engine/runtime/RuntimeLeaderboardController.js',
    'js/engine/runtime/RuntimeAdvisorWidget.js',
    'js/engine/runtime/RuntimeSocialControllersBootstrap.js'
  ], V.runtime);

  const bootScriptsMinimapAndSettings = []
    .concat(localScripts([
      'js/engine/runtime/RuntimeMinimapHelpers.js',
      'js/engine/runtime/RuntimeMinimapCameraControls.js',
      'js/engine/runtime/RuntimeMinimapOverlay.js',
      'js/engine/runtime/RuntimeMinimapRenderer.js',
      'js/engine/runtime/RuntimeMinimapInteractions.js',
      'js/engine/runtime/RuntimeMinimapLoop.js',
      'js/engine/runtime/RuntimeMinimapSeed.js',
      'js/engine/runtime/RuntimeMinimapDomScaffold.js',
      'js/engine/runtime/RuntimeMinimapNavigationBinding.js',
      'js/engine/runtime/RuntimeMinimapRenderOrchestrator.js',
      'js/engine/runtime/RuntimeMinimapFacade.js'
    ], V.runtime))
    .concat(localScripts([
      'js/engine/runtime/RuntimeQuickNavFacade.js',
      'js/engine/runtime/layers/ui/galaxy/HoverCardFacade.js',
      'js/engine/runtime/layers/ui/galaxy/ClusterRangeControls.js',
      'js/engine/runtime/layers/ui/galaxy/SystemDetailsFacade.js'
    ], V.quickNav))
    .concat(localScripts([
      'js/engine/runtime/layers/ui/settings/audio/SfxRows.js',
      'js/engine/runtime/layers/ui/settings/audio/MusicTrackOptions.js',
      'js/engine/runtime/layers/ui/settings/ftl/DriveButtons.js',
      'js/engine/runtime/layers/ui/settings/ftl/DrivesCatalog.js',
      'js/engine/runtime/layers/ui/settings/ftl/TemplateStyles.js',
      'js/engine/runtime/layers/ui/settings/ftl/SectionTemplate.js',
      'js/engine/runtime/layers/ui/settings/ai/SectionTemplate.js',
      'js/engine/runtime/layers/ui/settings/ai/NpcSectionTemplate.js',
      'js/engine/runtime/layers/ui/settings/core/SectionTemplate.js',
      'js/engine/runtime/layers/ui/settings/foundation/Defaults.js',
      'js/engine/runtime/layers/ui/settings/foundation/Storage.js',
      'js/engine/runtime/layers/ui/settings/foundation/Normalization.js',
      'js/engine/runtime/layers/ui/settings/foundation/Bootstrap.js',
      'js/engine/runtime/layers/ui/settings/compose/ViewModel.js',
      'js/engine/runtime/layers/ui/settings/compose/SectionsComposer.js',
      'js/engine/runtime/layers/ui/settings/compose/BaseBindings.js',
      'js/engine/runtime/layers/ui/settings/compose/PanelBindingsOrchestrator.js',
      'js/engine/runtime/layers/ui/settings/render/RenderModel.js',
      'js/engine/runtime/layers/ui/settings/render/RenderBindings.js',
      'js/engine/runtime/layers/ui/settings/render/RenderContext.js',
      'js/engine/runtime/layers/ui/settings/render/RenderFacade.js'
    ], V.runtime));

  const bootScriptsBootFlow = localScripts([
    'js/engine/runtime/RuntimeQuestsDataModel.js',
    'js/engine/runtime/RuntimeQuestsCardTemplate.js',
    'js/engine/runtime/RuntimeQuestsGroupTemplate.js',
    'js/engine/runtime/RuntimeQuestsClaimBindings.js',
    'js/engine/runtime/RuntimeQuestsRenderContext.js',
    'js/engine/runtime/RuntimeQuestsRenderFacade.js',
    'js/engine/runtime/RuntimeLogoutHandler.js',
    'js/engine/runtime/RuntimeBadgeLoader.js',
    'js/engine/runtime/RuntimeRealtimeSyncSetup.js',
    'js/engine/runtime/RuntimeStartupBootSetup.js',
    'js/engine/runtime/RuntimeFooterUiKitSetup.js',
    'js/engine/runtime/RuntimePostBootFlowSetup.js',
    'js/engine/runtime/RuntimeColonyVfxDebugWidgetSetup.js',
    'js/engine/runtime/RuntimeBootSetupContext.js',
    'js/engine/runtime/RuntimeBootSetupSequence.js'
  ], V.runtime);

  const bootScriptsRendering = []
    .concat([
      CDN.mustache,
      localScript('js/rendering/planet-textures.js', V.assetCore),
      localScript('js/rendering/texture-manager.js', V.assetCore),
      localScript('js/engine/scene/Light.js', V.sceneLight),
      localScript('js/rendering/geometry-manager.js', V.assetCore),
      localScript('js/rendering/material-factory.js', V.assetCore),
      localScript('js/rendering/light-rig-manager.js', V.assetCore),
      localScript('js/runtime/model_registry.js', V.assetCore),
      localScript('js/telemetry/space-physics-engine.js', V.assetCore),
      localScript('js/telemetry/performance-budget.js', V.assetCore),
      localScript('js/telemetry/space-flight-telemetry-schema.js', V.assetCore),
      localScript('js/telemetry/trajectory-planner.js', V.assetCore),
      localScript('js/telemetry/space-camera-flight-driver.js', V.assetCore),
      localScript('js/rendering/canvas-input-controller.js', V.inputController),
      localScript('js/rendering/input-contexts/input-action-types.js', V.inputContexts),
      localScript('js/rendering/input-contexts/core-galaxy-context.js', V.inputContexts),
      localScript('js/rendering/input-contexts/core-system-context.js', V.inputContexts),
      localScript('js/rendering/input-contexts/webgpu-galaxy-context.js', V.inputContexts),
      localScript('js/rendering/input-contexts/webgpu-system-context.js', V.inputContexts),
      localScript('js/rendering/input-contexts/core-context-actions.js', V.inputActions),
      localScript('js/rendering/input-contexts/webgpu-context-actions.js', V.inputActions),
      localScript('js/engine/DebrisManager.js', V.debrisManager),
      localScript('js/rendering/galaxy-renderer-config.js', V.galaxyRendererConfig),
      localScript('js/rendering/galaxy-renderer-event-binding-shared.js', V.galaxyRendererBinding),
      localScript('js/rendering/galaxy-renderer-events.js', V.galaxyRendererConfig),
      localScript('js/rendering/galaxy-camera-controller.js', assetVersions.galaxyCameraController)
    ])
    .concat(localScripts([
      'js/engine/zoom/IZoomLevelRenderer.js',
      'js/engine/zoom/RendererRegistry.js',
      'js/engine/zoom/CameraFlightPath.js',
      'js/engine/zoom/SeamlessZoomOrchestrator.js',
      'js/engine/zoom/levels/GalaxyLevelThreeJS.js',
      'js/engine/zoom/levels/GalaxyLevelWebGPU.js',
      'js/engine/zoom/levels/SystemLevelThreeJS.js',
      'js/engine/zoom/levels/SystemLevelWebGPU.js',
      'js/engine/zoom/levels/PlanetApproachLevelThreeJS.js',
      'js/engine/zoom/levels/PlanetApproachLevelWebGPU.js',
      'js/engine/zoom/levels/ColonySurfaceLevelThreeJS.js',
      'js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js',
      'js/engine/zoom/levels/ObjectApproachLevelThreeJS.js',
      'js/engine/zoom/levels/ObjectApproachLevelWebGPU.js'
    ], V.runtime))
    .concat([
      localScript('js/rendering/galaxy-renderer-core.js', assetVersions.galaxyRendererCore),
      localScript('js/rendering/starfield-webgpu.js', V.starfieldWebGpu),
      localScript('js/engine/CombatVfxBridge.js', V.combatFx),
      localScript('js/engine/fx/BeamEffect.js', V.combatFx),
      localScript('js/rendering/Galaxy3DRendererWebGPU.js', V.galaxyRendererWebGpu),
      localScript('js/legacy/galaxy3d-webgpu.js', V.legacyWebGpu)
    ]);

  const bootScriptsUiAndApp = [
    localScript('js/tests/flight-driver-integration-tests.js', V.flightDriverSmoke),
    localScript('js/tests/regression-tests-lod-streaming.js', V.lodStreamingSmoke),
    localScript('js/ui/glossary.js', V.uiGlossary),
    localScript('js/ui/ui-kit.js', V.uiKit),
    localScript('js/ui/star-tooltip.js', V.starTooltip),
    localScript('js/ui/system-info-panel.js', V.systemInfoPanel),
    localScript('js/ui/hr-diagram.js', V.hrDiagram),
    localScript('js/ui/settings-panel.js', V.settingsPanel),
    localScript('js/ui/settings-2fa.js', V.settings2fa),
    localScript('js/ui/admin-users.js', V.adminUsers),
    localScript('js/ui/system-bodies-breadcrumb.js', V.systemBreadcrumb),
    localScript('js/ui/system-breadcrumb-integration.js', V.systemBreadcrumb),
    localScript('js/ui/stellaris-system-overview.js', V.stellarisSystemOverview),
    localScript('js/ui/system-bodies-card-window.js', V.systemBodiesCardWindow),
    localScript('js/ui/gq-ui.js', V.gqui),
    localScript('js/runtime/game.js', V.game)
  ];

  window.__GQ_BOOT = {
    assetsManifestVersion: 2,
    packageBundles: [
      localScript('js/packages/game.boot.bundle.engine-core.js.gz', V.packageBundle),
      localScript('js/packages/game.boot.bundle.runtime.js.gz', V.packageBundle),
      localScript('js/packages/game.boot.bundle.network.js.gz', V.packageBundle),
      localScript('js/packages/game.boot.bundle.rendering.js.gz', V.packageBundle),
      localScript('js/packages/game.boot.bundle.telemetry.js.gz', V.packageBundle),
      localScript('js/packages/game.boot.bundle.ui.js.gz', V.packageBundle),
      localScript('js/packages/game.boot.bundle.tests.js.gz', V.packageBundle),
      localScript('js/packages/game.boot.bundle.legacy.js.gz', V.packageBundle)
    ],
    gameScripts: []
      .concat(bootScriptsCore)
      .concat(bootScriptsRuntimeFoundation)
      .concat(bootScriptsGalaxy)
      .concat(bootScriptsUiRuntime)
      .concat(bootScriptsControllers)
      .concat(bootScriptsMinimapAndSettings)
      .concat(bootScriptsBootFlow)
      .concat(bootScriptsRendering)
      .concat(bootScriptsUiAndApp)
  };

  window.__GQ_BOOT.preloadAssets = (window.__GQ_BOOT.gameScripts || []).filter(function (src) {
    return typeof src === 'string' && !/^https?:\/\//i.test(src);
  });
})();
