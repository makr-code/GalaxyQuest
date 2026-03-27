/*
 * GalaxyQuest browser database adapter for the frontend galaxy model.
 * Uses Dexie/IndexedDB when available and falls back to in-memory no-op persistence.
 */
(function () {
  class GQGalaxyDB {
    constructor() {
      this.ready = false;
      this.db = null;
      this.mode = 'memory';
      this.policies = {
        starMaxAgeMs: 24 * 60 * 60 * 1000,
        systemMaxAgeMs: 15 * 60 * 1000,
        maxStars: 45000,
        maxSystems: 30000,
        maxPlanets: 220000,
      };
    }

    _isFresh(ts, maxAgeMs) {
      if (!ts || !maxAgeMs || maxAgeMs <= 0) return true;
      return (Date.now() - Number(ts)) <= maxAgeMs;
    }

    async init() {
      if (!window.Dexie) {
        this.mode = 'memory';
        this.ready = true;
        return this;
      }

      this.db = new Dexie('GalaxyQuestFrontendDB');
      this.db.version(1).stores({
        stars: '&id, galaxy_index, system_index, cached_at',
        systems: '&id, galaxy_index, system_index, [galaxy_index+system_index], fetched_at',
        planets: '&id, galaxy_index, system_index, [galaxy_index+system_index], [galaxy_index+system_index+position], position, updated_at',
      });

      await this.db.open();
      this.mode = 'indexeddb';
      this.ready = true;
      return this;
    }

    async upsertStars(stars, timestampMs) {
      if (this.mode !== 'indexeddb' || !Array.isArray(stars) || !stars.length) return;
      const now = Number(timestampMs || Date.now());
      const rows = stars.map((s) => ({
        id: `g:${s.galaxy_index}:s:${s.system_index}`,
        galaxy_index: Number(s.galaxy_index),
        system_index: Number(s.system_index),
        cached_at: now,
        data: s,
      }));
      await this.db.stars.bulkPut(rows);
      const sysRows = rows.map((r) => ({
        id: r.id,
        galaxy_index: r.galaxy_index,
        system_index: r.system_index,
        fetched_at: now,
      }));
      await this.db.systems.bulkPut(sysRows);
    }

    async getStars(galaxyIndex, fromSystem, toSystem, opts = {}) {
      if (this.mode !== 'indexeddb') return [];
      const g = Number(galaxyIndex);
      const from = Number(fromSystem || 1);
      const to = Number(toSystem || Number.MAX_SAFE_INTEGER);
      const maxAgeMs = Number(opts.maxAgeMs || this.policies.starMaxAgeMs);
      const rows = await this.db.stars
        .where('galaxy_index')
        .equals(g)
        .filter((r) => r.system_index >= from && r.system_index <= to)
        .sortBy('system_index');
      return rows
        .filter((r) => this._isFresh(r.cached_at, maxAgeMs))
        .map((r) => r.data);
    }

    async upsertSystemPayload(galaxyIndex, systemIndex, payload, timestampMs) {
      if (this.mode !== 'indexeddb') return;
      const g = Number(galaxyIndex);
      const s = Number(systemIndex);
      const sid = `g:${g}:s:${s}`;
      const now = Number(timestampMs || Date.now());

      await this.db.systems.put({
        id: sid,
        galaxy_index: g,
        system_index: s,
        fetched_at: now,
        payload,
      });

      if (payload?.star_system) {
        await this.db.stars.put({
          id: sid,
          galaxy_index: g,
          system_index: s,
          cached_at: now,
          data: payload.star_system,
        });
      }

      await this.db.planets
        .where('[galaxy_index+system_index]')
        .equals([g, s])
        .delete();

      const planets = Array.isArray(payload?.planets) ? payload.planets : [];
      if (planets.length) {
        const rows = planets.map((slot) => ({
          id: `g:${g}:s:${s}:p:${Number(slot.position || 1)}`,
          galaxy_index: g,
          system_index: s,
          position: Number(slot.position || 1),
          updated_at: now,
          data: slot,
        }));
        await this.db.planets.bulkPut(rows);
      }
    }

    async getSystemPayload(galaxyIndex, systemIndex, opts = {}) {
      if (this.mode !== 'indexeddb') return null;
      const g = Number(galaxyIndex);
      const s = Number(systemIndex);
      const sid = `g:${g}:s:${s}`;
      const maxAgeMs = Number(opts.maxAgeMs || this.policies.systemMaxAgeMs);
      const system = await this.db.systems.get(sid);
      if (!system) return null;
      if (!this._isFresh(system.fetched_at, maxAgeMs)) return null;
      if (system.payload) return system.payload;

      const star = await this.db.stars.get(sid);
      const planets = await this.db.planets
        .where('[galaxy_index+system_index]')
        .equals([g, s])
        .sortBy('position');
      if (!star && !planets.length) return null;
      return {
        success: true,
        galaxy: g,
        system: s,
        star_system: star?.data || null,
        planets: planets.map((p) => p.data),
      };
    }

    async prune(opts = {}) {
      if (this.mode !== 'indexeddb') return;

      const policy = Object.assign({}, this.policies, opts || {});
      const now = Date.now();
      const starCutoff = now - Number(policy.starMaxAgeMs || this.policies.starMaxAgeMs);
      const systemCutoff = now - Number(policy.systemMaxAgeMs || this.policies.systemMaxAgeMs);

      await this.db.stars.where('cached_at').below(starCutoff).delete();
      await this.db.systems.where('fetched_at').below(systemCutoff).delete();
      await this.db.planets.where('updated_at').below(systemCutoff).delete();

      const [starCount, systemCount, planetCount] = await Promise.all([
        this.db.stars.count(),
        this.db.systems.count(),
        this.db.planets.count(),
      ]);

      if (starCount > policy.maxStars) {
        const excess = starCount - policy.maxStars;
        const toDelete = await this.db.stars.orderBy('cached_at').limit(excess).primaryKeys();
        if (toDelete.length) await this.db.stars.bulkDelete(toDelete);
      }

      if (systemCount > policy.maxSystems) {
        const excess = systemCount - policy.maxSystems;
        const toDelete = await this.db.systems.orderBy('fetched_at').limit(excess).primaryKeys();
        if (toDelete.length) await this.db.systems.bulkDelete(toDelete);
      }

      if (planetCount > policy.maxPlanets) {
        const excess = planetCount - policy.maxPlanets;
        const toDelete = await this.db.planets.orderBy('updated_at').limit(excess).primaryKeys();
        if (toDelete.length) await this.db.planets.bulkDelete(toDelete);
      }
    }

    async clearAll() {
      if (this.mode !== 'indexeddb') return;
      await Promise.all([
        this.db.stars.clear(),
        this.db.systems.clear(),
        this.db.planets.clear(),
      ]);
    }
  }

  window.GQGalaxyDB = GQGalaxyDB;
})();
