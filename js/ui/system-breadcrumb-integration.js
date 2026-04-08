/**
 * System Bodies Breadcrumb Integration
 *
 * Initializes and manages the breadcrumb navigation for celestial bodies
 * in the System-View as well as the Stellaris system overview (one WebGPU
 * canvas per celestial body).
 */

class SystemBreadcrumbIntegration {
  constructor() {
    this.breadcrumb = null;
    this.renderer = null;
    this.currentSystemPayload = null;
    this.stellarisOverview = null;
    this._initBreadcrumb();
    this._initStellarisOverview();
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
  }

  /**
   * Call when a system is exited.
   */
  onSystemExit() {
    this.hideBreadcrumb();
    if (this.stellarisOverview) {
      this.stellarisOverview.hide();
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
  }
}

// Global instance
window.SystemBreadcrumbIntegration = SystemBreadcrumbIntegration;
