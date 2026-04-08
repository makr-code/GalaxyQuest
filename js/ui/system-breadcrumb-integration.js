/**
 * System Bodies Breadcrumb Integration
 *
 * Initialisiert und verwaltet die Breadcrumb-Navigation fuer Himmelskoerper
 * in der System-View sowie die Stellaris-Systemuebersicht (WebGPU-Canvas
 * pro Himmelskoerper).
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
   * Rufe auf wenn ein System geladen wird
   */
  onSystemEnter(payload, renderer) {
    this.renderer = renderer;
    this.currentSystemPayload = payload;

    if (!this.breadcrumb) {
      console.warn('[SystemBreadcrumbIntegration] Breadcrumb not initialized');
    } else {
      // Update breadcrumb mit Bodies aus dem System
      this.breadcrumb.updateBodies(payload, renderer);
      this.showBreadcrumb();
    }

    if (this.stellarisOverview) {
      this.stellarisOverview.updateBodies(payload, renderer);
    }
  }

  /**
   * Rufe auf wenn System verlassen wird
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
   * Breadcrumb anzeigen
   */
  showBreadcrumb() {
    const nav = document.getElementById('system-breadcrumb-nav');
    if (nav) {
      nav.classList.add('visible');
    }
  }

  /**
   * Breadcrumb verstecken
   */
  hideBreadcrumb() {
    const nav = document.getElementById('system-breadcrumb-nav');
    if (nav) {
      nav.classList.remove('visible');
    }
  }

  /**
   * Setze fokussierten Body
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
    // Hier koennte auf Renderer-Events gelauscht werden
    // z.B. fuer Sphere-Raycasting Updates
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

// Globale Instanz
window.SystemBreadcrumbIntegration = SystemBreadcrumbIntegration;
