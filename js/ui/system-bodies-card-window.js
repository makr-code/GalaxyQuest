/**
 * SystemBodiesCardWindow.js
 *
 * Populates the GQWM window "system-bodies-cards" with one wm-card per
 * celestial body (star, planet, moon).  Each card embeds the body's
 * WebGPU canvas (reused from StellarisSystemOverview when available) and
 * shows relevant metadata.
 *
 * Usage (automatic via SystemBreadcrumbIntegration):
 *
 *   const win = new SystemBodiesCardWindow('system-bodies-cards');
 *   win.init();
 *   win.updateBodies(systemPayload, renderer);
 *   // later …
 *   win.destroy();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Planet-class keyword → human-readable label */
function _kindBadge(entry) {
  if (entry.kind === 'star') return String(entry.spectralClass || 'G') + '-Star';
  if (entry.kind === 'moon') return 'Moon';
  const cls = String(entry.planetClass || '');
  if (!cls) return 'Planet';
  return cls.charAt(0).toUpperCase() + cls.slice(1);
}

/** Safe HTML escape */
function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── SystemBodiesCardWindow ────────────────────────────────────────────────────

class SystemBodiesCardWindow {
  /**
   * @param {string} winId            data-wm-window id of the container
   * @param {{ documentRef?: Document, windowRef?: Window }} [opts]
   */
  constructor(winId, opts = {}) {
    this._winId       = String(winId || 'system-bodies-cards');
    this._documentRef = opts.documentRef  || (typeof document !== 'undefined' ? document : null);
    this._windowRef   = opts.windowRef    || (typeof window   !== 'undefined' ? window   : null);

    /** @type {HTMLElement|null} */
    this._gridEl  = null;
    /** @type {HTMLElement|null} */
    this._countEl = null;
    /** @type {Object|null} */
    this._renderer = null;
    /** @type {Array} */
    this._entries = [];
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Bind the persistent grid element inside the window body. */
  init() {
    const doc = this._documentRef;
    if (!doc) return;
    this._gridEl  = doc.getElementById(`${this._winId}-grid`);
    this._countEl = doc.getElementById(`${this._winId}-count`);
  }

  /**
   * Populate the window cards from a system payload.
   * Mirrors the payload shape used by StellarisSystemOverview.
   *
   * @param {Object|null} payload
   * @param {Object|null} renderer
   * @param {Object|null} [sso]  StellarisSystemOverview instance (optional,
   *                              used to reuse already-rendered canvases)
   */
  updateBodies(payload, renderer, sso) {
    this._renderer = renderer || null;
    this._entries  = [];

    if (!payload) {
      this._renderCards(sso);
      return;
    }

    // 1. Star
    const starData = payload.star_system || payload.star || null;
    if (starData) {
      this._entries.push({
        id:           'star',
        kind:         'star',
        name:         String(starData.name || starData.catalog_name || 'Star'),
        spectralClass:String(starData.spectral_class || starData.spectralClass || 'G'),
        planetClass:  '',
        ownerColor:   null,
        body:         starData,
      });
    }

    // 2. Planets + moons
    const planets = Array.isArray(payload.planets) ? payload.planets : [];
    planets.forEach((slot, idx) => {
      const planet = slot.generated_planet || slot.player_planet || slot.body || null;
      if (!planet) return;

      const pos  = slot.position || idx;
      const pId  = `planet-${pos}`;
      const pName = String(planet.name || `Planet ${pos}`);

      this._entries.push({
        id:           pId,
        kind:         'planet',
        name:         pName,
        spectralClass:'',
        planetClass:  String(planet.planet_class || ''),
        ownerColor:   planet.owner_color || slot.player_planet?.owner_color || null,
        body:         planet,
        position:     pos,
      });

      (Array.isArray(planet.moons) ? planet.moons : []).forEach((moon, mi) => {
        const mName = String(moon.name || `${pName} ${String.fromCharCode(97 + mi)}`);
        this._entries.push({
          id:          `moon-${pos}-${mi}`,
          kind:        'moon',
          name:        mName,
          spectralClass:'',
          planetClass: String(moon.planet_class || moon.body_type || 'moon'),
          ownerColor:  moon.owner_color || null,
          body:        moon,
          parentId:    pId,
        });
      });
    });

    this._renderCards(sso);
  }

  /** Clear cards (e.g. on system exit) */
  clear() {
    this._entries = [];
    if (this._gridEl) this._gridEl.innerHTML = '';
    if (this._countEl) this._countEl.textContent = '';
  }

  /** Open the WM window via the global WM instance */
  open() {
    const wm = this._windowRef?.WM;
    if (wm && typeof wm.open === 'function') wm.open(this._winId);
  }

  /** Close the WM window */
  close() {
    const wm = this._windowRef?.WM;
    if (wm && typeof wm.close === 'function') wm.close(this._winId);
  }

  destroy() {
    this.clear();
    this._gridEl  = null;
    this._countEl = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _renderCards(sso) {
    if (!this._gridEl) return;

    this._gridEl.innerHTML = '';

    if (this._countEl) {
      this._countEl.textContent = this._entries.length
        ? `${this._entries.length} bodies`
        : '';
    }

    const doc = this._documentRef;
    if (!doc) return;

    for (const entry of this._entries) {
      const card = this._buildCard(entry, sso, doc);
      this._gridEl.appendChild(card);
    }
  }

  _buildCard(entry, sso, doc) {
    const card = doc.createElement('div');
    card.className = `wm-card is-outlined sbcw-card sbcw-card--${entry.kind}`;
    card.setAttribute('data-sbcw-id', entry.id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', entry.name);

    // ── Canvas area (reuse SSO canvas if available, else placeholder) ──
    const canvasWrap = doc.createElement('div');
    canvasWrap.className = 'sbcw-canvas-wrap';

    let canvas = null;
    if (sso && Array.isArray(sso._entries)) {
      const ssoEntry = sso._entries.find((e) => e.id === entry.id);
      if (ssoEntry?.canvas instanceof HTMLCanvasElement) {
        canvas = ssoEntry.canvas.cloneNode();
        canvas.className = 'sbcw-canvas';
      }
    }
    if (!canvas) {
      canvas = doc.createElement('canvas');
      canvas.className = 'sbcw-canvas';
      canvas.width  = 64;
      canvas.height = 64;
      canvas.setAttribute('aria-hidden', 'true');
    }
    canvasWrap.appendChild(canvas);
    card.appendChild(canvasWrap);

    // ── Card body ──
    const body = doc.createElement('div');
    body.className = 'wm-card-body';

    const title = doc.createElement('div');
    title.className   = 'wm-card-title';
    title.textContent = entry.name;
    body.appendChild(title);

    const badge = doc.createElement('div');
    badge.className   = 'wm-card-subtitle';
    badge.textContent = _kindBadge(entry);
    body.appendChild(badge);

    // Extra meta for planets
    if (entry.kind === 'planet' || entry.kind === 'moon') {
      const meta = doc.createElement('div');
      meta.className = 'wm-card-content sbcw-meta';
      const lines = [];
      if (entry.planetClass) lines.push(`<span class="sbcw-meta-label">Class:</span> ${_esc(entry.planetClass)}`);
      if (entry.ownerColor) {
        lines.push(
          `<span class="sbcw-meta-label">Owner:</span> `
          + `<span class="sbcw-owner-dot" style="background:${_esc(entry.ownerColor)}"></span>`
        );
      }
      meta.innerHTML = lines.join('<br>');
      body.appendChild(meta);
    }

    card.appendChild(body);

    // ── Click: focus in renderer or transmit ──
    card.addEventListener('click', () => this._onCardClick(entry));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._onCardClick(entry);
      }
    });

    return card;
  }

  _onCardClick(entry) {
    if (!this._renderer) return;
    if (entry.kind === 'star' && typeof this._renderer.focusOnStar === 'function') {
      this._renderer.focusOnStar(entry.body, true);
    } else if (typeof this._renderer.focusOnSystemPlanet === 'function') {
      this._renderer.focusOnSystemPlanet(
        { body: entry.body, kind: entry.kind, name: entry.name }, true
      );
    }
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.SystemBodiesCardWindow = SystemBodiesCardWindow;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SystemBodiesCardWindow };
}
