/**
 * System Bodies Breadcrumb Integration
 * 
 * Initialisiert und verwaltet die Breadcrumb-Navigation für Himmelskörper
 * in der System-View.
 */

class SystemBreadcrumbIntegration {
  constructor() {
    this.breadcrumb = null;
    this.renderer = null;
    this.currentSystemPayload = null;
    this._initBreadcrumb();
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

  /**
   * Rufe auf wenn ein System geladen wird
   */
  onSystemEnter(payload, renderer) {
    this.renderer = renderer;
    this.currentSystemPayload = payload;

    if (!this.breadcrumb) {
      console.warn('[SystemBreadcrumbIntegration] Breadcrumb not initialized');
      return;
    }

    // Update breadcrumb mit Bodies aus dem System
    this.breadcrumb.updateBodies(payload, renderer);
    this.showBreadcrumb();
  }

  /**
   * Rufe auf wenn System verlassen wird
   */
  onSystemExit() {
    this.hideBreadcrumb();
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
  }

  _bindRendererEvents() {
    // Hier könnten Renderer-Events gelauscht werden
    // z.B. für Sphere-Raycasting Updates
  }

  destroy() {
    if (this.breadcrumb) {
      this.breadcrumb.destroy();
    }
  }
}

// Globale Instanz
window.SystemBreadcrumbIntegration = SystemBreadcrumbIntegration;
