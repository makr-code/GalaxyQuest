/**
 * System Bodies Breadcrumb Navigator
 * 
 * Zeigt alle Himmelskörper im System (Stern, Planeten, Monde) als fokussierbarer Buttons-Liste.
 * - Single-Click: Fokussiert Himmelskörper (Camera Zoom/Pan)
 * - Double-Click: "Transmission" zur nächsten View (z.B. Planet Details)
 */

class SystemBodiesBreadcrumb {
  constructor(containerId = 'system-breadcrumb-nav') {
    this.containerId = String(containerId || '');
    this.container = null;
    this.renderer = null;
    this.bodies = [];
    this.currentFocusedBody = null;
    this.clickTimers = new Map();
    this.doubleClickTimeMs = 320;
    
    this._init();
  }

  _init() {
    const el = document.getElementById(this.containerId);
    if (!el) {
      console.warn(`[SystemBodiesBreadcrumb] Container #${this.containerId} nicht gefunden`);
      return;
    }
    this.container = el;
  }

  /**
   * Aktualisiere Breadcrumb mit Himmelskörpern aus System-Payload
   * @param {Object} payload - System dataPayload (planets, star info)
   * @param {Object} renderer - Galaxy3DRenderer instance
   */
  updateBodies(payload, renderer) {
    this.renderer = renderer;
    this.bodies = [];

    if (!payload) {
      this.render();
      return;
    }

    // Star als erstes Element
    if (payload.star_system) {
      this.bodies.push({
        id: 'star',
        kind: 'star',
        name: String(payload.star_system?.name || 'Star'),
        icon: 'star',
        body: payload.star_system,
      });
    }

    // Planeten + deren Monde
    const planets = Array.isArray(payload.planets) ? payload.planets : [];
    planets.forEach((planetSlot, planetIndex) => {
      const genPlanet = planetSlot?.generated_planet;
      const playerPlanet = planetSlot?.player_planet;
      const planet = genPlanet || playerPlanet;
      
      if (!planet) return;

      const planetName = String(planet.name || `Planet ${planetIndex + 1}`);
      this.bodies.push({
        id: `planet-${planetSlot.position || planetIndex}`,
        kind: 'planet',
        name: planetName,
        icon: 'globe',
        body: planet,
        position: planetSlot.position || planetIndex,
        parentIndex: null,
        orbitRadius: Number(planetSlot?.body?.semi_major_axis_au || 0),
      });

      // Monde dieses Planeten
      const moons = Array.isArray(planet.moons) ? planet.moons : [];
      moons.forEach((moon, moonIndex) => {
        const moonName = String(moon.name || `${planetName} ${String.fromCharCode(97 + moonIndex)}`);
        this.bodies.push({
          id: `moon-${planetSlot.position || planetIndex}-${moonIndex}`,
          kind: 'moon',
          name: moonName,
          icon: 'moon',
          body: moon,
          parentPlanetId: `planet-${planetSlot.position || planetIndex}`,
          orbitRadius: Number(moon.semi_major_axis_km || 0) / 1000, // Convert km to AU-ish scale
        });
      });
    });

    this.render();
  }

  /**
   * Markiere einen Body als fokussiert
   */
  setFocusedBody(bodyId) {
    this.currentFocusedBody = bodyId;
    this.render();
  }

  /**
   * Rendere die Breadcrumb-Buttons
   */
  render() {
    if (!this.container) {
      console.warn('[SystemBodiesBreadcrumb] Container nicht initialisiert');
      return;
    }

    this.container.innerHTML = '';

    if (!this.bodies.length) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'flex';
    const listEl = document.createElement('div');
    listEl.className = 'breadcrumb-list';

    this.bodies.forEach((body, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'breadcrumb-btn';
      if (body.id === this.currentFocusedBody) {
        btn.classList.add('focused');
      }

      // Hierarchie-Einrückung für Monde
      if (body.kind === 'moon') {
        btn.style.marginLeft = '12px';
        btn.classList.add('breadcrumb-moon-btn');
      } else if (body.kind === 'planet') {
        btn.classList.add('breadcrumb-planet-btn');
      } else {
        btn.classList.add('breadcrumb-star-btn');
      }

      // Icon + Name
      const icon = this._getIconSvg(body.icon);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = body.name;

      btn.innerHTML = icon;
      btn.appendChild(nameSpan);

      // Click Handler mit Single/Double-Click Logik
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        this._handleBodyClick(body);
      });

      listEl.appendChild(btn);
    });

    this.container.appendChild(listEl);
  }

  /**
   * Vereinheitlichte Click-Handler: Single = Focus, Double = Transmission
   */
  _handleBodyClick(body) {
    const bodyId = body.id;
    const now = performance.now();

    if (this.clickTimers.has(bodyId)) {
      // Zweiter Click innerhalb des Doppelklick-Fensters → Double-Click
      const firstClickTime = this.clickTimers.get(bodyId);
      if (now - firstClickTime < this.doubleClickTimeMs) {
        this.clickTimers.delete(bodyId);
        this._onBodyDoubleClick(body);
        return;
      }
    }

    // Single Click: Nur Timer setzen, focussieren
    this.clickTimers.set(bodyId, now);
    this._onBodySingleClick(body);

    // Timer löschen nach Doppelklick-Fenster
    setTimeout(() => {
      if (this.clickTimers.get(bodyId) === now) {
        this.clickTimers.delete(bodyId);
      }
    }, this.doubleClickTimeMs + 50);
  }

  /**
   * Single-Click: Fokussiere Body (Kamera zoomen/pannen)
   */
  _onBodySingleClick(body) {
    this.setFocusedBody(body.id);

    if (!this.renderer || typeof this.renderer.focusOnSystemPlanet !== 'function') {
      console.warn('[SystemBodiesBreadcrumb] Renderer oder focusOnSystemPlanet nicht verfügbar');
      return;
    }

    // Gebe dem Renderer den Body direkt oder als Wrapper-Objekt
    const focusTarget = {
      body: body.body,
      kind: body.kind,
      name: body.name,
    };

    if (body.kind === 'star') {
      // Star fokussieren: Zoom auf Stern
      this.renderer.focusOnStar(body.body, true);
    } else {
      // Planet/Mond fokussieren
      this.renderer.focusOnSystemPlanet(focusTarget, true);
    }

    console.log(`[SystemBodiesBreadcrumb] Fokussiert: ${body.name}`);
  }

  /**
   * Double-Click: Transmission zur nächsten View
   * - Planet → Planet-Details/Colonies
   * - Mond → Mond-Details
   */
  _onBodyDoubleClick(body) {
    console.log(`[SystemBodiesBreadcrumb] Double-Click: Transmission zu ${body.name}`);

    // Hier könnte z.B. eine View-Navigation stattfinden
    // Z.B. triggerTransmissionToPlanet(body.position)
    if (body.kind === 'planet') {
      this._triggerPlanetTransmission(body);
    } else if (body.kind === 'moon') {
      this._triggerMoonTransmission(body);
    }
  }

  /**
   * Transmission zu Planeten-Details-View
   */
  _triggerPlanetTransmission(body) {
    // Emit event oder trigger window manager action
    const event = new CustomEvent('gq:transmission-to-planet', {
      detail: {
        planet: body,
        position: body.position,
      },
    });
    window.dispatchEvent(event);
    console.log(`[SystemBodiesBreadcrumb] Transmission zu ${body.name} gestartet`);
  }

  /**
   * Transmission zu Mond-Details-View
   */
  _triggerMoonTransmission(body) {
    const event = new CustomEvent('gq:transmission-to-moon', {
      detail: {
        moon: body,
        parentPlanetId: body.parentPlanetId,
      },
    });
    window.dispatchEvent(event);
    console.log(`[SystemBodiesBreadcrumb] Transmission zu ${body.name} gestartet`);
  }

  /**
   * Gebe SVG Icon basierend auf Body-Typ
   */
  _getIconSvg(iconType) {
    const iconId = {
      star: 'icon-star',
      globe: 'icon-globe',
      moon: 'icon-moon',
    }[iconType] || 'icon-question';

    return `<svg class="breadcrumb-icon" aria-hidden="true" focusable="false"><use href="gfx/icons/mono/${iconId}.svg#${iconId}"></use></svg>`;
  }

  /**
   * Clearup
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.clickTimers.clear();
    this.bodies = [];
  }
}

// Export auf window für globale Verwendung
window.SystemBodiesBreadcrumb = SystemBodiesBreadcrumb;
