'use strict';

(function () {
  function createWindowRegistry(opts = {}) {
    const {
      wm = null,
      renderers = {},
    } = opts;

    return {
      registered: false,

      buildDefinitions() {
        return [
          ['overview', { title: 'Overview', w: 460, h: 620, defaultDock: 'right', defaultY: 12, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderOverview() }],
          ['buildings', { title: 'Buildings', w: 480, h: 560, defaultDock: 'right', defaultY: 38, onRender: () => renderers.renderBuildings() }],
          ['colony', { title: 'Colony', w: 620, h: 620, defaultDock: 'right', defaultY: 24, onRender: () => renderers.renderColonyView() }],
          ['research', { title: 'Research', w: 480, h: 560, defaultDock: 'right', defaultY: 58, onRender: () => renderers.renderResearch() }],
          ['shipyard', { title: 'Shipyard', w: 500, h: 560, defaultDock: 'right', defaultY: 78, onRender: () => renderers.renderShipyard() }],
          ['fleet', { title: 'Fleet', w: 500, h: 620, defaultDock: 'right', defaultY: 98, onRender: () => renderers.renderFleetForm() }],
          ['wormholes', { title: 'Wormholes', w: 520, h: 560, defaultDock: 'right', defaultY: 108, onRender: () => renderers.renderWormholes() }],
          ['galaxy', { title: 'Galaxy Map', fullscreenDesktop: true, hideTaskButton: true, backgroundLayer: true, onRender: () => renderers.renderGalaxyWindow() }],
          ['messages', { title: 'Messages', w: 500, h: 520, defaultDock: 'right', defaultY: 118, onRender: () => renderers.renderMessages() }],
          ['intel', { title: 'Intel', w: 520, h: 560, defaultDock: 'right', defaultY: 128, onRender: () => renderers.renderIntel() }],
          ['trade-routes', { title: 'Trade Routes', w: 520, h: 560, defaultDock: 'right', defaultY: 138, onRender: () => renderers.renderTradeRoutes() }],
          ['traders', { title: 'Trader Ops', w: 760, h: 680, defaultDock: 'right', defaultY: 82, onRender: () => renderers.renderTradersDashboard() }],
          ['pirates', { title: 'Pirate Activity', w: 760, h: 680, defaultDock: 'right', defaultY: 96, onRender: () => renderers.renderPirates() }],
          ['economy-flow', { title: 'Economy Flow', w: 540, h: 600, defaultDock: 'right', defaultY: 148, onRender: () => renderers.renderEconomyFlow() }],
          ['economy', { title: 'Economy Management', w: 680, h: 640, defaultDock: 'right', defaultY: 80, onRender: () => renderers.renderEconomy() }],
          ['trade', { title: 'Trade', w: 540, h: 580, defaultDock: 'right', defaultY: 148, onRender: () => renderers.renderTradeProposals() }],
          ['quests', { title: 'Quests', w: 540, h: 620, defaultDock: 'right', defaultY: 28, onRender: () => renderers.renderQuests() }],
          ['leaderboard', { title: 'Leaderboard', w: 420, h: 480, defaultDock: 'right', defaultY: 138, onRender: () => renderers.renderLeaderboard() }],
          ['leaders', { title: 'Leaders & Marketplace', w: 700, h: 600, defaultDock: 'right', defaultY: 44, onRender: () => renderers.renderLeaders() }],
          ['factions', { title: 'Factions', w: 560, h: 620, defaultDock: 'right', defaultY: 24, onRender: () => renderers.renderFactions() }],
          ['alliances', { title: 'Alliances', w: 560, h: 620, defaultDock: 'right', defaultY: 54, onRender: () => renderers.renderAlliances() }],
          ['wars', { title: 'Wars', w: 760, h: 640, defaultDock: 'right', defaultY: 64, onRender: () => renderers.renderWars() }],
          ['settings', { title: 'Settings', w: 460, h: 560, defaultDock: 'right', defaultY: 12, onRender: () => renderers.renderSettings() }],
          ['quicknav', { title: 'QuickNav', w: 370, h: 520, defaultDock: 'left', defaultY: 12, onRender: () => renderers.renderQuickNav() }],
          ['minimap', { title: 'Minimap', w: 290, h: 310, defaultDock: 'right', defaultY: 12, defaultDockMargin: 12, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: (root) => renderers.renderMinimap(root) }],
          ['left-sidebar', {
            title: 'Left Sidebar',
            sectionId: 'left_sidebar',
            prebuiltSelector: '.sidebar-panel-left',
            adaptExisting: true,
            defaultDock: 'left',
            defaultY: 72,
            w: 300,
            h: 520,
            onRender: (root) => {
              if (!root) return;
              if (!root.innerHTML.trim()) root.innerHTML = '<p class="text-muted">Left sidebar window.</p>';
            },
          }],
          ['right-sidebar', {
            title: 'Right Sidebar',
            sectionId: 'right_sidebar',
            prebuiltSelector: '.sidebar-panel-right',
            adaptExisting: true,
            defaultDock: 'right',
            defaultY: 72,
            w: 300,
            h: 520,
            onRender: (root) => {
              if (!root) return;
              if (!root.innerHTML.trim()) root.innerHTML = '<p class="text-muted">Right sidebar window.</p>';
            },
          }],
        ];
      },

      registerAll() {
        if (this.registered || !wm) return;
        const definitions = this.buildDefinitions();
        definitions.forEach(([id, options]) => wm.register(id, options));
        this.registered = true;
      },
    };
  }

  function selfHealGalaxyWindow(opts = {}) {
    const {
      wm = null,
      documentRef = (typeof document !== 'undefined' ? document : null),
      gameLog = () => {},
    } = opts;

    try {
      const staleGalaxyWindow = documentRef?.getElementById('wm-win-galaxy');
      const hasBackgroundClass = !!(staleGalaxyWindow && staleGalaxyWindow.classList.contains('wm-window-background'));
      if (staleGalaxyWindow && !hasBackgroundClass && wm?.isOpen?.('galaxy')) {
        wm.close('galaxy');
        gameLog('info', 'Recreated stale galaxy window with registered background config');
      }
    } catch (err) {
      gameLog('info', 'Galaxy window self-heal check failed', err);
    }
  }

  function createNavigationController(options = {}) {
    const {
      wm = null,
      api = null,
      audio = null,
      planetSelect = null,
      documentRef = (typeof document !== 'undefined' ? document : null),
      windowRef = (typeof window !== 'undefined' ? window : null),
      loadOverview = async () => {},
      focusHomeSystemInGalaxy = async () => {},
      openResourceInsight = () => {},
      selectColonyById = () => {},
      showToast = () => {},
      gameLog = () => {},
      settingsState = {},
      applyRuntimeSettings = () => {},
      saveUiSettings = () => {},
      refreshAudioUi = () => {},
      updateTopbarOrbitBadge = () => {},
      showOrbitModeHintOnce = () => {},
      topbarAudioControlsApi = null,
      audioTrackOptions = [],
      closeTopbarPlayerMenu = () => {},
      closeTopbarSearchOverlay = () => {},
      closeCommanderMenuPanel = () => {},
      setTopbarMenuFocusTrap = () => {},
      syncTopbarBottomSheetState = () => {},
      focusFirstInTopbarMenu = () => {},
      loadAudioTrackCatalog = () => Promise.resolve(),
    } = options;

    return {
      wm,
      api,
      audio,
      planetSelect,
      bound: false,

      bindNavButtons() {
        documentRef?.querySelectorAll('.nav-btn[data-win]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (this.audio && typeof this.audio.playNavigation === 'function') this.audio.playNavigation();
            const win = String(btn.dataset.win || '');

            if (win === 'settings') {
              if (this.wm && typeof this.wm.modal === 'function') {
                this.wm.modal('settings-modal');
              }
              return;
            }

            if (this.api && typeof this.api.cancelPendingRequests === 'function') {
              this.api.cancelPendingRequests(`View switch to ${win || 'unknown'}`);
            }
            this.wm.open(win);
            if (this.audio && typeof this.audio.setScene === 'function') {
              if (win === 'galaxy') this.audio.setScene('galaxy', { autoplay: false, transition: 'fast', force: true });
              else if (win === 'fleet') this.audio.setScene('battle', { autoplay: false, transition: 'normal', force: true });
              else this.audio.setScene('ui', { autoplay: false, transition: 'fast', force: true });
            }
          });
        });
      },

      bindTopbarButtons() {
        documentRef?.getElementById('topbar-title-btn')?.addEventListener('click', async () => {
          if (this.audio) this.audio.playNavigation();
          await loadOverview();
          ['overview','colony','buildings','research','shipyard','fleet','wormholes','messages','quests','leaders','factions','leaderboard','pirates','economy'].forEach((id) => {
            try {
              this.wm.refresh(id);
            } catch (err) {
              gameLog('info', `WM refresh fehlgeschlagen (${id})`, err);
            }
          });
          showToast('Daten aktualisiert.', 'success');
        });

        documentRef?.getElementById('topbar-home-btn')?.addEventListener('click', async () => {
          if (this.audio) this.audio.playNavigation();
          if (this.api && typeof this.api.cancelPendingRequests === 'function') {
            this.api.cancelPendingRequests('Home navigation');
          }
          this.wm.open('galaxy');
          const root = this.wm.body('galaxy');
          if (!root) return;
          await focusHomeSystemInGalaxy(root);
        });

        const cycleOrbitMode = () => {
          showOrbitModeHintOnce();

          const order = ['auto', 'simple', 'complex'];
          const currentMode = String(settingsState.orbitSimulationMode || 'auto').toLowerCase();
          const currentIndex = Math.max(0, order.indexOf(currentMode));
          const nextMode = order[(currentIndex + 1) % order.length];
          settingsState.orbitSimulationMode = nextMode;
          applyRuntimeSettings();
          saveUiSettings();
          updateTopbarOrbitBadge();
          showToast(`Orbit-Simulation: ${nextMode.toUpperCase()}`, 'info');
        };

        documentRef?.getElementById('topbar-orbit-mode')?.addEventListener('click', () => {
          if (this.audio) this.audio.playNavigation();
          cycleOrbitMode();
        });

        documentRef?.getElementById('topbar-orbit-mode')?.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          if (this.audio) this.audio.playNavigation();
          cycleOrbitMode();
        });

        documentRef?.querySelectorAll('.resource-btn[data-resource]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (this.audio && typeof this.audio.playNavigation === 'function') this.audio.playNavigation();
            openResourceInsight(String(btn.dataset.resource || ''));
          });
        });
      },

      bindColonySelector() {
        if (!this.planetSelect) return;
        this.planetSelect.addEventListener('change', () => {
          if (this.audio && typeof this.audio.playNavigation === 'function') this.audio.playNavigation();
          const cid = parseInt(this.planetSelect.value, 10);
          selectColonyById(cid);
        });
      },

      init() {
        if (this.bound) return;
        this.bindNavButtons();
        this.bindTopbarButtons();
        topbarAudioControlsApi?.bindAudioToggle?.({
          audioManager: this.audio,
          settingsState,
          saveUiSettings,
          refreshAudioUi,
          documentRef,
        });
        topbarAudioControlsApi?.bindTopbarPlayer?.({
          audioManager: this.audio,
          settingsState,
          audioTrackOptions,
          closeTopbarPlayerMenu,
          closeTopbarSearchOverlay,
          closeCommanderMenuPanel,
          setTopbarMenuFocusTrap,
          syncTopbarBottomSheetState,
          focusFirstInTopbarMenu,
          loadAudioTrackCatalog,
          saveUiSettings,
          refreshAudioUi,
          showToast,
          gameLog,
          documentRef,
          windowRef,
        });
        this.bindColonySelector();
        this.bound = true;
      },
    };
  }

  const api = {
    createNavigationController,
    createWindowRegistry,
    selfHealGalaxyWindow,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeDesktopShell = api;
  }
})();