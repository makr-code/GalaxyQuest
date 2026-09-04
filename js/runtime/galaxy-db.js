/*
 * GalaxyQuest browser database adapter for the frontend galaxy model.
 * Uses Dexie/IndexedDB when available and falls back to in-memory no-op persistence.
 */
(function () {
  class GQGalaxyDB {
    constructor() {
      if (!window.GQGalaxyChunkUtils) throw new Error('GQGalaxyChunkUtils is required');
      this.chunkUtils = window.GQGalaxyChunkUtils;
      this.ready = false;
      this.db = null;
      this.mode = 'memory';
      this.policies = {
        starMaxAgeMs: 24 * 60 * 60 * 1000,
        systemMaxAgeMs: 15 * 60 * 1000,
        maxStars: 250000,
        maxSystems: 30000,
        maxPlanets: 220000,
        maxStarChunks: 12000,
        sectorSpanLy: 256,
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
      this.db.version(2).stores({
        stars: '&id, galaxy_index, system_index, cached_at',
        systems: '&id, galaxy_index, system_index, [galaxy_index+system_index], fetched_at',
        planets: '&id, galaxy_index, system_index, [galaxy_index+system_index], [galaxy_index+system_index+position], position, updated_at',
        star_chunks: '&id, galaxy_index, [galaxy_index+sector_x], [galaxy_index+sector_y], [galaxy_index+sector_x+sector_y], updated_at',
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
      await this.upsertStarChunksFromStars(rows.map((r) => r.data), now);
    }

    _sectorCoord(value, sectorSpanLy) {
      return this.chunkUtils.sectorCoord(value, sectorSpanLy || this.policies.sectorSpanLy);
    }

    _buildChunkRows(stars, timestampMs, opts = {}) {
      return this.chunkUtils.buildStarChunkSummaries(stars, {
        sectorSpanLy: opts.sectorSpanLy || this.policies.sectorSpanLy,
        sampleLimit: opts.sampleLimit || 12,
        timestampMs,
      });
    }

    async upsertStarChunks(chunks, timestampMs) {
      if (this.mode !== 'indexeddb' || !this.db?.star_chunks || !Array.isArray(chunks) || !chunks.length) return;
      const now = Number(timestampMs || Date.now());
      const rows = chunks.map((chunk) => Object.assign({}, chunk, { updated_at: now }));
      await this.db.star_chunks.bulkPut(rows);
    }

    async deleteStarChunks(chunkIds) {
      if (this.mode !== 'indexeddb' || !this.db?.star_chunks || !Array.isArray(chunkIds) || !chunkIds.length) return;
      const ids = chunkIds.map((id) => String(id || '')).filter(Boolean);
      if (!ids.length) return;
      await this.db.star_chunks.bulkDelete(ids);
    }

    async upsertStarChunksFromStars(stars, timestampMs, opts = {}) {
      if (this.mode !== 'indexeddb' || !this.db?.star_chunks || !Array.isArray(stars) || !stars.length) return;
      const rows = this._buildChunkRows(stars, timestampMs, opts);
      await this.upsertStarChunks(rows, timestampMs);
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

    async getStarChunkSummaries(galaxyIndex, opts = {}) {
      if (this.mode !== 'indexeddb' || !this.db?.star_chunks) return [];
      const g = Number(galaxyIndex || 0);
      const maxAgeMs = Number(opts.maxAgeMs || this.policies.starMaxAgeMs);
      const rows = await this.db.star_chunks.where('galaxy_index').equals(g).toArray();
      const minX = Number.isFinite(Number(opts.minX)) ? Number(opts.minX) : Number.NEGATIVE_INFINITY;
      const maxX = Number.isFinite(Number(opts.maxX)) ? Number(opts.maxX) : Number.POSITIVE_INFINITY;
      const minY = Number.isFinite(Number(opts.minY)) ? Number(opts.minY) : Number.NEGATIVE_INFINITY;
      const maxY = Number.isFinite(Number(opts.maxY)) ? Number(opts.maxY) : Number.POSITIVE_INFINITY;
      return rows
        .filter((row) => this._isFresh(row.updated_at, maxAgeMs))
        .filter((row) => (
          Number(row.max_x_ly || 0) >= minX
          && Number(row.min_x_ly || 0) <= maxX
          && Number(row.max_y_ly || 0) >= minY
          && Number(row.min_y_ly || 0) <= maxY
        ))
        .sort((a, b) => (Number(a.sector_y || 0) - Number(b.sector_y || 0)) || (Number(a.sector_x || 0) - Number(b.sector_x || 0)));
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
      if (this.db.star_chunks) {
        await this.db.star_chunks.where('updated_at').below(starCutoff).delete();
      }

      const [starCount, systemCount, planetCount, starChunkCount] = await Promise.all([
        this.db.stars.count(),
        this.db.systems.count(),
        this.db.planets.count(),
        this.db.star_chunks ? this.db.star_chunks.count() : Promise.resolve(0),
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
      if (this.db.star_chunks && starChunkCount > policy.maxStarChunks) {
        const excess = starChunkCount - policy.maxStarChunks;
        const toDelete = await this.db.star_chunks.orderBy('updated_at').limit(excess).primaryKeys();
        if (toDelete.length) await this.db.star_chunks.bulkDelete(toDelete);
      }
    }

    async clearAll() {
      if (this.mode !== 'indexeddb') return;
      await Promise.all([
        this.db.stars.clear(),
        this.db.systems.clear(),
        this.db.planets.clear(),
        this.db.star_chunks ? this.db.star_chunks.clear() : Promise.resolve(),
      ]);
    }
  }

  window.GQGalaxyDB = GQGalaxyDB;
})();
