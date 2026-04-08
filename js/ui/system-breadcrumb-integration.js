/**
 * System Bodies Breadcrumb Integration
 *
 * Initializes and manages:
 *  1. The text breadcrumb navigation for celestial bodies (SystemBodiesBreadcrumb)
 *  2. The Stellaris system overview strip — one WebGPU canvas per body (StellarisSystemOverview)
 *  3. The System Bodies Card Window — a floating GQWM window with a card layout
 *     per body, toggled via the "Bodies" footer context-menu button
 */

class SystemBreadcrumbIntegration {
  constructor() {
    this.breadcrumb = null;
    this.renderer = null;
    this.currentSystemPayload = null;
    this.stellarisOverview = null;
    this.cardWindow = null;
    this._initBreadcrumb();
    this._initStellarisOverview();
    this._initCardWindow();
    this._bindRendererEvents();
  }

  _initBreadcrumb() {
    if (window.SystemBodiesBreadcrumb) {
      this.breadcrumb = new window.SystemBodiesBreadcrumb('system-breadcrumb-nav');
      console.log('[SystemBreadcrumbIntegration] Breadcrumb initialized');
    } else {
      console.warn('[SystemBreadcrumbIntegration] SystemBodiesBreadcrumb class not available');
    }
  }

  _initStellarisOverview() {
    if (!window.StellarisSystemOverview) {
      console.warn('[SystemBreadcrumbIntegration] StellarisSystemOverview not available');
      return;
    }
    this.stellarisOverview = new window.StellarisSystemOverview('stellaris-system-overview');
    this.stellarisOverview.init().catch(function (err) {
      console.warn('[SystemBreadcrumbIntegration] StellarisSystemOverview init failed:', err);
    });
    console.log('[SystemBreadcrumbIntegration] StellarisSystemOverview initialized');
  }

  _initCardWindow() {
    if (!window.SystemBodiesCardWindow) {
      console.warn('[SystemBreadcrumbIntegration] SystemBodiesCardWindow not available');
      return;
    }
    this.cardWindow = new window.SystemBodiesCardWindow('system-bodies-cards');
    this.cardWindow.init();
    console.log('[SystemBreadcrumbIntegration] SystemBodiesCardWindow initialized');
  }

  /**
   * Call when a system is entered.
   */
  onSystemEnter(payload, renderer) {
    this.renderer = renderer;
    this.currentSystemPayload = payload;

    if (!this.breadcrumb) {
      console.warn('[SystemBreadcrumbIntegration] Breadcrumb not initialized');
    } else {
      this.breadcrumb.updateBodies(payload, renderer);
      this.showBreadcrumb();
    }

    if (this.stellarisOverview) {
      this.stellarisOverview.updateBodies(payload, renderer);
    }

    if (this.cardWindow) {
      this.cardWindow.updateBodies(payload, renderer, this.stellarisOverview);
    }
  }

  /**
   * Call when a system is exited.
   */
  onSystemExit() {
    this.hideBreadcrumb();
    if (this.stellarisOverview) {
      this.stellarisOverview.hide();
    }
    if (this.cardWindow) {
      this.cardWindow.clear();
    }
    this.currentSystemPayload = null;
    this.renderer = null;
  }

  /**
   * Show the breadcrumb nav.
   */
  showBreadcrumb() {
    const nav = document.getElementById('system-breadcrumb-nav');
    if (nav) {
      nav.classList.add('visible');
    }
  }

  /**
   * Hide the breadcrumb nav.
   */
  hideBreadcrumb() {
    const nav = document.getElementById('system-breadcrumb-nav');
    if (nav) {
      nav.classList.remove('visible');
    }
  }

  /**
   * Set the focused body by id.
   */
  setFocusedBody(bodyId) {
    if (this.breadcrumb) {
      this.breadcrumb.setFocusedBody(bodyId);
    }
    if (this.stellarisOverview) {
      this.stellarisOverview.setFocusedBody(bodyId);
    }
  }

  _bindRendererEvents() {
    // Here we could listen to renderer events, e.g., for Sphere-Raycasting updates.
  }

  destroy() {
    if (this.breadcrumb) {
      this.breadcrumb.destroy();
    }
    if (this.stellarisOverview) {
      this.stellarisOverview.destroy();
    }
    if (this.cardWindow) {
      this.cardWindow.destroy();
    }
  }
}

// Global instance
window.SystemBreadcrumbIntegration = SystemBreadcrumbIntegration;
