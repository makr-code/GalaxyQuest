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
          ['buildings', { title: 'Buildings', w: 480, h: 560, defaultDock: 'right', defaultY: 38, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderBuildings() }],
          ['colony', { title: 'Colony', w: 620, h: 620, defaultDock: 'right', defaultY: 24, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderColonyView() }],
          ['research', { title: 'Research', w: 480, h: 560, defaultDock: 'right', defaultY: 58, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderResearch() }],
          ['shipyard', { title: 'Shipyard', w: 500, h: 560, defaultDock: 'right', defaultY: 78, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderShipyard() }],
          ['fleet', { title: 'Fleet', w: 500, h: 620, defaultDock: 'right', defaultY: 98, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderFleetForm() }],
          ['wormholes', { title: 'Wormholes', w: 520, h: 560, defaultDock: 'right', defaultY: 108, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderWormholes() }],
          ['galaxy', { title: 'Galaxy Map', fullscreenDesktop: true, hideTaskButton: true, backgroundLayer: true, onRender: () => renderers.renderGalaxyWindow() }],
          ['galaxy-info', { title: 'Galaxy Intel', w: 380, h: 640, defaultDock: 'right', defaultY: 24, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderGalaxyInfoWindow() }],
          ['messages', { title: 'Messages', w: 500, h: 520, defaultDock: 'right', defaultY: 118, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderMessages() }],
          ['intel', { title: 'Intel', w: 520, h: 560, defaultDock: 'right', defaultY: 128, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderIntel() }],
          ['trade-routes', { title: 'Trade Routes', w: 520, h: 560, defaultDock: 'right', defaultY: 138, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderTradeRoutes() }],
          ['traders', { title: 'Trader Ops', w: 760, h: 680, defaultDock: 'right', defaultY: 82, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderTradersDashboard() }],
          ['pirates', { title: 'Pirate Activity', w: 760, h: 680, defaultDock: 'right', defaultY: 96, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderPirates() }],
          ['conflict', { title: 'Conflict Dashboard', w: 860, h: 680, defaultDock: 'right', defaultY: 72, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderConflict() }],
          ['economy-flow', { title: 'Economy Flow', w: 540, h: 600, defaultDock: 'right', defaultY: 148, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderEconomyFlow() }],
          ['economy', { title: 'Economy Management', w: 680, h: 640, defaultDock: 'right', defaultY: 80, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderEconomy() }],
          ['trade', { title: 'Trade', w: 540, h: 580, defaultDock: 'right', defaultY: 148, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderTradeProposals() }],
          ['quests', { title: 'Quests', w: 540, h: 620, defaultDock: 'right', defaultY: 28, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderQuests() }],
          ['leaderboard', { title: 'Leaderboard', w: 420, h: 480, defaultDock: 'right', defaultY: 138, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderLeaderboard() }],
          ['leaders', { title: 'Leaders & Marketplace', w: 700, h: 600, defaultDock: 'right', defaultY: 44, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderLeaders() }],
          ['factions', { title: 'Factions', w: 560, h: 620, defaultDock: 'right', defaultY: 24, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderFactions() }],
          ['alliances', { title: 'Alliances', w: 560, h: 620, defaultDock: 'right', defaultY: 54, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderAlliances() }],
          ['wars', { title: 'Wars', w: 760, h: 640, defaultDock: 'right', defaultY: 64, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderWars() }],
          ['nav-orb', { title: 'Nav Orb', w: 300, h: 520, defaultDock: 'right', defaultY: 12, defaultDockMargin: 12, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderNavOrb() }],
          ['settings', { title: 'Settings', w: 460, h: 560, defaultDock: 'right', defaultY: 12, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderSettings() }],
          ['quicknav', { title: 'QuickNav', w: 370, h: 520, defaultDock: 'left', defaultY: 12, dockable: true, dockableSides: ['left', 'right'], dockMagnetThreshold: 72, onRender: () => renderers.renderQuickNav() }],
          ['console', {
            title: 'Console',
            sectionId: 'terminal-section',
            prebuiltSelector: '#boot-terminal',
            adaptExisting: true,
            preserveOnClose: true,
            w: 920,
            h: 290,
            defaultDock: 'bottom',
            defaultY: 0,
            dockable: true,
            dockableSides: ['bottom', 'left', 'right'],
            dockMagnetThreshold: 72,
            dockBottomInset: 56,
          }],
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
          ['overview','colony','buildings','research','shipyard','fleet','wormholes','messages','quests','leaders','factions','leaderboard','trade-routes','traders','wars','pirates','conflict','economy'].forEach((id) => {
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

  /**
   * registerGameCommands – registers named WM commands for all game windows
   * and common layout actions so they appear in the Command Palette and can
   * be bound to toolbar items or hotkeys.
   *
   * opts: { wm, showToast, gameLog }
   */
  function registerGameCommands(opts = {}) {
    const {
      wm = null,
      showToast = () => {},
      gameLog = () => {},
    } = opts;

    if (!wm || typeof wm.registerCommand !== 'function') return;

    // ── Window-open commands ─────────────────────────────────────────────
    const windowCommands = [
      { id: 'gq.open.overview',    label: 'Übersicht öffnen',          icon: '◉', win: 'overview' },
      { id: 'gq.open.colony',      label: 'Kolonie öffnen',            icon: '🏠', win: 'colony' },
      { id: 'gq.open.buildings',   label: 'Gebäude öffnen',            icon: '🏗', win: 'buildings' },
      { id: 'gq.open.research',    label: 'Forschung öffnen',          icon: '🔬', win: 'research' },
      { id: 'gq.open.shipyard',    label: 'Werft öffnen',              icon: '⚙', win: 'shipyard' },
      { id: 'gq.open.fleet',       label: 'Flotte öffnen',             icon: '🚀', win: 'fleet' },
      { id: 'gq.open.galaxy',      label: 'Galaxiekarte öffnen',       icon: '🌌', win: 'galaxy' },
      { id: 'gq.open.messages',    label: 'Nachrichten öffnen',        icon: '✉', win: 'messages' },
      { id: 'gq.open.intel',       label: 'Intel öffnen',              icon: '🔭', win: 'intel' },
      { id: 'gq.open.wormholes',   label: 'Wurmlöcher öffnen',         icon: '🌀', win: 'wormholes' },
      { id: 'gq.open.trade',       label: 'Handel öffnen',             icon: '💱', win: 'trade' },
      { id: 'gq.open.economy',     label: 'Wirtschaft öffnen',         icon: '📈', win: 'economy' },
      { id: 'gq.open.quests',      label: 'Quests öffnen',             icon: '📜', win: 'quests' },
      { id: 'gq.open.factions',    label: 'Fraktionen öffnen',         icon: '⚑', win: 'factions' },
      { id: 'gq.open.alliances',   label: 'Allianzen öffnen',          icon: '🤝', win: 'alliances' },
      { id: 'gq.open.wars',        label: 'Kriege öffnen',             icon: '⚔', win: 'wars' },
      { id: 'gq.open.leaderboard', label: 'Rangliste öffnen',          icon: '🏆', win: 'leaderboard' },
      { id: 'gq.open.leaders',     label: 'Anführer öffnen',           icon: '👑', win: 'leaders' },
      { id: 'gq.open.pirates',     label: 'Piraten öffnen',            icon: '☠', win: 'pirates' },
      { id: 'gq.open.traders',     label: 'Händler öffnen',            icon: '🛒', win: 'traders' },
      { id: 'gq.open.minimap',     label: 'Minimap öffnen',            icon: '🗺', win: 'minimap' },
      { id: 'gq.open.quicknav',    label: 'QuickNav öffnen',           icon: '⌖', win: 'quicknav' },
      { id: 'gq.open.console',     label: 'Konsole öffnen',            icon: '>', win: 'console' },
    ];

    windowCommands.forEach(({ id, label, icon, win }) => {
      wm.registerCommand(id, {
        label,
        icon,
        category: 'Fenster',
        execute() { wm.open(win); },
      });
    });

    // ── Layout commands ──────────────────────────────────────────────────
    if (typeof wm.tileWindows === 'function') {
      wm.registerCommand('gq.layout.tile2x2', {
        label: 'Layout: 2×2 Kacheln',
        icon: '⊞',
        category: 'Layout',
        execute() { wm.tileWindows('2x2'); },
      });
      wm.registerCommand('gq.layout.tile3col', {
        label: 'Layout: 3 Spalten',
        icon: '⋮',
        category: 'Layout',
        execute() { wm.tileWindows('3col'); },
      });
      wm.registerCommand('gq.layout.tileSelected', {
        label: 'Layout: Auswahl kacheln',
        icon: '⊟',
        category: 'Layout',
        execute() { wm.tileSelected('2x2'); },
      });
    }

    if (typeof wm.saveLayoutProfile === 'function') {
      wm.registerCommand('gq.layout.save', {
        label: 'Layout speichern (Schnell)',
        icon: '💾',
        category: 'Layout',
        execute() {
          wm.saveLayoutProfile('quick', { scope: 'global' });
          showToast('Layout gespeichert.', 'success');
        },
      });
    }

    if (typeof wm.loadLayoutProfile === 'function') {
      wm.registerCommand('gq.layout.load', {
        label: 'Layout laden (Schnell)',
        icon: '📂',
        category: 'Layout',
        execute() {
          const ok = wm.loadLayoutProfile('quick', { scope: 'global' });
          showToast(ok ? 'Layout geladen.' : 'Kein gespeichertes Layout gefunden.', ok ? 'success' : 'info');
        },
      });
    }

    if (typeof wm.showCommandPalette === 'function') {
      wm.registerCommand('gq.palette', {
        label: 'Befehlspalette öffnen',
        icon: '⌨',
        category: 'System',
        execute() { wm.showCommandPalette({}); },
      });
    }

    // ── Theme commands ───────────────────────────────────────────────────
    if (typeof wm.listThemes === 'function') {
      const applyFn = typeof wm.applyTheme === 'function' ? wm.applyTheme.bind(wm) : null;
      const setFn   = typeof wm.setTheme   === 'function' ? wm.setTheme.bind(wm)   : null;

      const themeCommands = [
        { id: 'gq.theme.dark',      label: 'Theme: Dunkel',         theme: 'dark' },
        { id: 'gq.theme.light',     label: 'Theme: Hell',           theme: 'light' },
        { id: 'gq.theme.gq-blue',   label: 'Theme: GQ Blau',        theme: 'gq-blue' },
        { id: 'gq.theme.gq-red',    label: 'Theme: GQ Rot',         theme: 'gq-red' },
        { id: 'gq.theme.gq-green',  label: 'Theme: GQ Grün',        theme: 'gq-green' },
        { id: 'gq.theme.high-contrast', label: 'Theme: Hoher Kontrast', theme: 'high-contrast' },
      ];

      if (setFn) {
        themeCommands.forEach(({ id, label, theme }) => {
          wm.registerCommand(id, {
            label,
            icon: '🎨',
            category: 'Darstellung',
            execute() {
              setFn(theme, { scope: 'user', apply: true, persist: true });
              showToast(`Theme: ${label}`, 'success');
            },
          });
        });
      }

      wm.registerCommand('gq.theme.reset', {
        label: 'Theme: Zurücksetzen',
        icon: '↺',
        category: 'Darstellung',
        execute() {
          if (typeof wm.clearTheme === 'function') wm.clearTheme({ scope: 'user', apply: true });
          if (applyFn) applyFn({});
          showToast('Theme zurückgesetzt.', 'info');
        },
      });
    }

    gameLog('info', '[GQ] WM game commands registered');
  }

  /**
   * registerGlobalHotkeys – binds single-key and Ctrl+key shortcuts that open
   * WM windows or trigger common actions.
   *
   * Keys only fire when no text input, textarea, or contenteditable element has
   * focus, and only when no modifier key other than the declared one is held.
   *
   * opts: { wm, windowRef, showToast, gameLog }
   *
   * Default bindings:
   *   B → Buildings    R → Research    S → Shipyard    F → Fleet
   *   G → Galaxy       M → Messages    I → Intel        Q → Quests
   *   L → Leaderboard  T → Trade       W → Wormholes
   *   Ctrl+K → Command Palette
   */
  function registerGlobalHotkeys(opts = {}) {
    const {
      wm = null,
      windowRef = (typeof window !== 'undefined' ? window : null),
      showToast = () => {},
      gameLog: log = () => {},
    } = opts;

    if (!wm || !windowRef) return;

    const SINGLE_KEY_MAP = {
      b: 'buildings',
      r: 'research',
      s: 'shipyard',
      f: 'fleet',
      g: 'galaxy',
      m: 'messages',
      i: 'intel',
      q: 'quests',
      l: 'leaderboard',
      t: 'trade',
      w: 'wormholes',
    };

    function _isInputFocused() {
      const el = windowRef.document && windowRef.document.activeElement;
      if (!el) return false;
      const tag = el.tagName ? el.tagName.toUpperCase() : '';
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function _handler(e) {
      if (_isInputFocused()) return;

      const key = (e.key || '').toLowerCase();

      // Ctrl+K → command palette
      if ((e.ctrlKey || e.metaKey) && key === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (typeof wm.showCommandPalette === 'function') {
          wm.showCommandPalette({});
        }
        return;
      }

      // Single-key window toggles — no modifier keys allowed
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      const win = SINGLE_KEY_MAP[key];
      if (win && typeof wm.toggle === 'function') {
        e.preventDefault();
        wm.toggle(win);
      }
    }

    windowRef.addEventListener('keydown', _handler);
    log('info', '[GQ] Global hotkeys registered');

    return {
      destroy() {
        windowRef.removeEventListener('keydown', _handler);
      },
    };
  }

  const api = {
    createNavigationController,
    createWindowRegistry,
    selfHealGalaxyWindow,
    registerGameCommands,
    registerGlobalHotkeys,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeDesktopShell = api;
  }
})();