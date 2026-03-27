/*
 * GalaxyQuest frontend galaxy data model
 * In-memory tree with full CRUD operations for galaxies, systems, stars and planets.
 */
(function () {
  class GQGalaxyModel {
    constructor() {
      this.galaxies = new Map();
      this.systemIndex = new Map();
      this.starIndex = new Map();
      this.planetIndex = new Map();
      this.listeners = new Set();
    }

    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    _emit(event, payload) {
      for (const fn of this.listeners) {
        try { fn(event, payload); } catch (_) {}
      }
    }

    _galaxyId(galaxyIndex) { return `g:${galaxyIndex}`; }
    _systemId(galaxyIndex, systemIndex) { return `g:${galaxyIndex}:s:${systemIndex}`; }
    _starId(galaxyIndex, systemIndex) { return `g:${galaxyIndex}:s:${systemIndex}`; }
    _planetId(galaxyIndex, systemIndex, position) { return `g:${galaxyIndex}:s:${systemIndex}:p:${position}`; }

    ensureGalaxy(galaxyIndex) {
      const key = this._galaxyId(galaxyIndex);
      if (!this.galaxies.has(key)) {
        this.galaxies.set(key, {
          id: key,
          galaxy_index: galaxyIndex,
          systems: new Map(),
          loaded_star_ranges: [],
          lazy_state: {
            stars: 'empty',
          },
        });
        this._emit('create:galaxy', { id: key, galaxy_index: galaxyIndex });
      }
      return this.galaxies.get(key);
    }

    _normalizeRange(fromSystem, toSystem) {
      const from = Math.max(1, Number(fromSystem || 1));
      const to = Math.max(from, Number(toSystem || from));
      return { from, to };
    }

    addLoadedStarRange(galaxyIndex, fromSystem, toSystem, fetchedAtMs) {
      const galaxy = this.ensureGalaxy(Number(galaxyIndex || 1));
      const normalized = this._normalizeRange(fromSystem, toSystem);
      const rangeEntry = {
        from: normalized.from,
        to: normalized.to,
        fetched_at: Number(fetchedAtMs || Date.now()),
      };
      const ranges = galaxy.loaded_star_ranges.concat([rangeEntry]).sort((a, b) => a.from - b.from);

      const merged = [];
      for (const r of ranges) {
        if (!merged.length) {
          merged.push({ from: r.from, to: r.to, fetched_at: Number(r.fetched_at || Date.now()) });
          continue;
        }
        const last = merged[merged.length - 1];
        if (r.from <= last.to + 1) {
          last.to = Math.max(last.to, r.to);
          last.fetched_at = Math.max(Number(last.fetched_at || 0), Number(r.fetched_at || 0));
        } else {
          merged.push({ from: r.from, to: r.to, fetched_at: Number(r.fetched_at || Date.now()) });
        }
      }

      galaxy.loaded_star_ranges = merged;
      galaxy.lazy_state.stars = merged.length ? 'partial' : 'empty';
      this._emit('update:galaxy', galaxy);
      return merged;
    }

    hasLoadedStarRange(galaxyIndex, fromSystem, toSystem, maxAgeMs) {
      const galaxy = this.read('galaxy', Number(galaxyIndex || 1));
      if (!galaxy) return false;
      const requested = this._normalizeRange(fromSystem, toSystem);
      const now = Date.now();
      return galaxy.loaded_star_ranges.some((r) => {
        const covers = r.from <= requested.from && r.to >= requested.to;
        if (!covers) return false;
        if (!maxAgeMs || maxAgeMs <= 0) return true;
        return (now - Number(r.fetched_at || 0)) <= maxAgeMs;
      });
    }

    getSystemLoadState(galaxyIndex, systemIndex) {
      const sys = this.read('system', {
        galaxy_index: Number(galaxyIndex || 1),
        system_index: Number(systemIndex || 1),
      });
      if (!sys) {
        return {
          star: 'empty',
          planets: 'empty',
          payload: 'empty',
          pending: false,
          fetched_at: 0,
        };
      }
      return Object.assign({}, sys.lazy_state || {});
    }

    setSystemLoadState(galaxyIndex, systemIndex, patch) {
      const sys = this.create('system', {
        galaxy_index: Number(galaxyIndex || 1),
        system_index: Number(systemIndex || 1),
      });
      sys.lazy_state = Object.assign({
        star: sys.star ? 'loaded' : 'empty',
        planets: sys.planets.size ? 'loaded' : 'empty',
        payload: sys.payload ? 'loaded' : 'empty',
        pending: false,
        fetched_at: Number(sys.fetched_at || 0),
      }, sys.lazy_state || {}, patch || {});
      this._emit('update:system', sys);
      return sys.lazy_state;
    }

    create(entity, payload) {
      switch (entity) {
        case 'galaxy': {
          const g = Number(payload?.galaxy_index || payload?.id || 1);
          return this.ensureGalaxy(g);
        }
        case 'system': {
          const g = Number(payload?.galaxy_index || 1);
          const s = Number(payload?.system_index || 1);
          const galaxy = this.ensureGalaxy(g);
          const id = this._systemId(g, s);
          if (this.systemIndex.has(id)) return this.systemIndex.get(id);

          const node = Object.assign({
            id,
            galaxy_index: g,
            system_index: s,
            star: null,
            planets: new Map(),
            fetched_at: Date.now(),
            lazy_state: {
              star: 'empty',
              planets: 'empty',
              payload: 'empty',
              pending: false,
              fetched_at: 0,
            },
          }, payload || {});
          galaxy.systems.set(s, node);
          this.systemIndex.set(id, node);
          this._emit('create:system', node);
          return node;
        }
        case 'star': {
          const g = Number(payload?.galaxy_index || 1);
          const s = Number(payload?.system_index || 1);
          const sys = this.create('system', { galaxy_index: g, system_index: s });
          const id = this._starId(g, s);
          if (this.starIndex.has(id)) return this.starIndex.get(id);
          const star = Object.assign({ id, galaxy_index: g, system_index: s }, payload || {});
          sys.star = star;
          sys.lazy_state.star = 'loaded';
          sys.lazy_state.fetched_at = Date.now();
          this.starIndex.set(id, star);
          this._emit('create:star', star);
          return star;
        }
        case 'planet': {
          const g = Number(payload?.galaxy_index || payload?.galaxy || 1);
          const s = Number(payload?.system_index || payload?.system || 1);
          const p = Number(payload?.position || 1);
          const sys = this.create('system', { galaxy_index: g, system_index: s });
          const id = this._planetId(g, s, p);
          if (this.planetIndex.has(id)) return this.planetIndex.get(id);
          const planet = Object.assign({ id, galaxy_index: g, system_index: s, position: p }, payload || {});
          sys.planets.set(p, planet);
          sys.lazy_state.planets = 'loaded';
          sys.lazy_state.fetched_at = Date.now();
          this.planetIndex.set(id, planet);
          this._emit('create:planet', planet);
          return planet;
        }
        default:
          return null;
      }
    }

    read(entity, idOrCoords) {
      switch (entity) {
        case 'galaxy': {
          const g = typeof idOrCoords === 'number' ? idOrCoords : Number(idOrCoords?.galaxy_index || 1);
          return this.galaxies.get(this._galaxyId(g)) || null;
        }
        case 'system': {
          if (typeof idOrCoords === 'string') return this.systemIndex.get(idOrCoords) || null;
          const g = Number(idOrCoords?.galaxy_index || 1);
          const s = Number(idOrCoords?.system_index || 1);
          return this.systemIndex.get(this._systemId(g, s)) || null;
        }
        case 'star': {
          if (typeof idOrCoords === 'string') return this.starIndex.get(idOrCoords) || null;
          const g = Number(idOrCoords?.galaxy_index || 1);
          const s = Number(idOrCoords?.system_index || 1);
          return this.starIndex.get(this._starId(g, s)) || null;
        }
        case 'planet': {
          if (typeof idOrCoords === 'string') return this.planetIndex.get(idOrCoords) || null;
          const g = Number(idOrCoords?.galaxy_index || idOrCoords?.galaxy || 1);
          const s = Number(idOrCoords?.system_index || idOrCoords?.system || 1);
          const p = Number(idOrCoords?.position || 1);
          return this.planetIndex.get(this._planetId(g, s, p)) || null;
        }
        default:
          return null;
      }
    }

    update(entity, idOrCoords, patch) {
      const node = this.read(entity, idOrCoords);
      if (!node) return null;
      Object.assign(node, patch || {});
      this._emit(`update:${entity}`, node);
      return node;
    }

    delete(entity, idOrCoords) {
      if (entity === 'planet') {
        const node = this.read('planet', idOrCoords);
        if (!node) return false;
        const sys = this.read('system', { galaxy_index: node.galaxy_index, system_index: node.system_index });
        if (sys) sys.planets.delete(node.position);
        this.planetIndex.delete(node.id);
        this._emit('delete:planet', node);
        return true;
      }

      if (entity === 'star') {
        const node = this.read('star', idOrCoords);
        if (!node) return false;
        const sys = this.read('system', { galaxy_index: node.galaxy_index, system_index: node.system_index });
        if (sys) sys.star = null;
        this.starIndex.delete(node.id);
        this._emit('delete:star', node);
        return true;
      }

      if (entity === 'system') {
        const node = this.read('system', idOrCoords);
        if (!node) return false;
        if (node.star) this.starIndex.delete(node.star.id);
        for (const planet of node.planets.values()) this.planetIndex.delete(planet.id);
        const galaxy = this.read('galaxy', node.galaxy_index);
        if (galaxy) galaxy.systems.delete(node.system_index);
        this.systemIndex.delete(node.id);
        this._emit('delete:system', node);
        return true;
      }

      if (entity === 'galaxy') {
        const galaxy = this.read('galaxy', idOrCoords);
        if (!galaxy) return false;
        for (const sys of galaxy.systems.values()) this.delete('system', sys.id);
        this.galaxies.delete(galaxy.id);
        this._emit('delete:galaxy', galaxy);
        return true;
      }

      return false;
    }

    upsertStarBatch(galaxyIndex, stars) {
      const g = Number(galaxyIndex || 1);
      this.ensureGalaxy(g);
      const list = Array.isArray(stars) ? stars : [];
      const out = [];
      for (const s of list) {
        const systemIndex = Number(s?.system_index || 1);
        const sys = this.create('system', { galaxy_index: g, system_index: systemIndex });
        const existing = this.read('star', { galaxy_index: g, system_index: systemIndex });
        if (existing) {
          Object.assign(existing, s || {});
          existing.cached_at = Date.now();
          out.push(existing);
          this._emit('update:star', existing);
        } else {
          const star = this.create('star', Object.assign({}, s || {}, {
            galaxy_index: g,
            system_index: systemIndex,
            cached_at: Date.now(),
          }));
          out.push(star);
        }
        sys.fetched_at = Date.now();
        sys.lazy_state.star = 'loaded';
        sys.lazy_state.fetched_at = sys.fetched_at;
      }
      return out;
    }

    attachSystemPayload(galaxyIndex, systemIndex, payload) {
      const g = Number(galaxyIndex || 1);
      const s = Number(systemIndex || 1);
      const sys = this.create('system', { galaxy_index: g, system_index: s });
      this.setSystemLoadState(g, s, { pending: false });

      if (payload?.star_system) {
        const existing = this.read('star', { galaxy_index: g, system_index: s });
        if (existing) Object.assign(existing, payload.star_system);
        else this.create('star', Object.assign({}, payload.star_system, { galaxy_index: g, system_index: s }));
      }

      // Replace existing planets for this system.
      for (const p of Array.from(sys.planets.values())) this.delete('planet', p.id);

      const slots = Array.isArray(payload?.planets) ? payload.planets : [];
      for (const slot of slots) {
        const pos = Number(slot?.position || 1);
        const merged = {
          galaxy_index: g,
          system_index: s,
          position: pos,
          player_planet: slot?.player_planet || null,
          generated_planet: slot?.generated_planet || null,
          updated_at: Date.now(),
        };
        this.create('planet', merged);
      }

      sys.payload = payload;
      sys.fetched_at = Date.now();
      sys.lazy_state.star = sys.star ? 'loaded' : 'empty';
      sys.lazy_state.planets = sys.planets.size ? 'loaded' : 'empty';
      sys.lazy_state.payload = payload ? 'loaded' : 'empty';
      sys.lazy_state.fetched_at = sys.fetched_at;
      this._emit('update:system', sys);
      return sys;
    }

    listStars(galaxyIndex, fromSystem, toSystem) {
      const g = Number(galaxyIndex || 1);
      const from = Number(fromSystem || 1);
      const to = Number(toSystem || Number.MAX_SAFE_INTEGER);
      const out = [];
      for (const star of this.starIndex.values()) {
        if (Number(star.galaxy_index) !== g) continue;
        const s = Number(star.system_index || 0);
        if (s < from || s > to) continue;
        out.push(star);
      }
      out.sort((a, b) => Number(a.system_index || 0) - Number(b.system_index || 0));
      return out;
    }

    listPlanets(galaxyIndex, systemIndex) {
      const sys = this.read('system', { galaxy_index: Number(galaxyIndex), system_index: Number(systemIndex) });
      if (!sys) return [];
      return Array.from(sys.planets.values()).sort((a, b) => a.position - b.position);
    }

    stats() {
      return {
        galaxies: this.galaxies.size,
        systems: this.systemIndex.size,
        stars: this.starIndex.size,
        planets: this.planetIndex.size,
      };
    }

    clearAll() {
      this.galaxies.clear();
      this.systemIndex.clear();
      this.starIndex.clear();
      this.planetIndex.clear();
      this._emit('clear:all', this.stats());
    }
  }

  window.GQGalaxyModel = GQGalaxyModel;
})();
