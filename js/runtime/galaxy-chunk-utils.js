/*
 * Shared galaxy chunk summary helpers used by runtime, cache and renderer layers.
 */
(function () {
  function resolveChunkPolicy(opts = {}, defaults = {}) {
    return {
      sectorSpanLy: Math.max(1, Number(opts.sectorSpanLy || defaults.sectorSpanLy || 256)),
      sampleLimit: Math.max(1, Number(opts.sampleLimit || defaults.sampleLimit || 8)),
      timestampMs: Number(opts.timestampMs || Date.now()),
    };
  }

  function sectorCoord(value, sectorSpanLy) {
    return Math.floor(Number(value || 0) / Math.max(1, Number(sectorSpanLy || 256)));
  }

  function chunkId(galaxyIndex, sectorX, sectorY) {
    return `g:${Number(galaxyIndex || 0)}:chunk:${Number(sectorX || 0)}:${Number(sectorY || 0)}`;
  }

  function starIdForChunk(star, galaxyIndex) {
    return String(star?.id || `g:${Number(galaxyIndex || star?.galaxy_index || 0)}:s:${Number(star?.system_index || 0)}`);
  }

  function createStarChunkRecord(galaxyIndex, sectorX, sectorY, opts = {}) {
    const policy = resolveChunkPolicy(opts);
    return {
      id: chunkId(galaxyIndex, sectorX, sectorY),
      galaxy_index: Number(galaxyIndex || 0),
      sector_x: Number(sectorX || 0),
      sector_y: Number(sectorY || 0),
      sector_span_ly: policy.sectorSpanLy,
      star_count: 0,
      min_x_ly: Number.POSITIVE_INFINITY,
      max_x_ly: Number.NEGATIVE_INFINITY,
      min_y_ly: Number.POSITIVE_INFINITY,
      max_y_ly: Number.NEGATIVE_INFINITY,
      sample_star_ids: [],
      updated_at: policy.timestampMs,
    };
  }

  function addStarToChunkRecord(record, star, opts = {}) {
    if (!record || !star) return record;
    const policy = resolveChunkPolicy(opts, { sectorSpanLy: record.sector_span_ly || 256 });
    const x = Number(star?.x_ly || star?.x || 0);
    const y = Number(star?.y_ly || star?.y || 0);
    record.star_count = Number(record.star_count || 0) + 1;
    record.min_x_ly = Math.min(Number(record.min_x_ly), x);
    record.max_x_ly = Math.max(Number(record.max_x_ly), x);
    record.min_y_ly = Math.min(Number(record.min_y_ly), y);
    record.max_y_ly = Math.max(Number(record.max_y_ly), y);
    record.updated_at = policy.timestampMs;
    if (!Array.isArray(record.sample_star_ids)) record.sample_star_ids = [];
    if (record.sample_star_ids.length < policy.sampleLimit) {
      const id = starIdForChunk(star, record.galaxy_index);
      if (!record.sample_star_ids.includes(id)) record.sample_star_ids.push(id);
    }
    return record;
  }

  function buildStarChunkSummaries(stars, opts = {}) {
    const list = Array.isArray(stars) ? stars : [];
    const policy = resolveChunkPolicy(opts);
    const chunkMap = new Map();
    for (const star of list) {
      const galaxyIndex = Number(star?.galaxy_index || 0);
      if (!galaxyIndex) continue;
      const x = Number(star?.x_ly || star?.x || 0);
      const y = Number(star?.y_ly || star?.y || 0);
      const sectorX = sectorCoord(x, policy.sectorSpanLy);
      const sectorY = sectorCoord(y, policy.sectorSpanLy);
      const id = chunkId(galaxyIndex, sectorX, sectorY);
      const entry = chunkMap.get(id) || createStarChunkRecord(galaxyIndex, sectorX, sectorY, policy);
      addStarToChunkRecord(entry, star, policy);
      chunkMap.set(id, entry);
    }
    return Array.from(chunkMap.values());
  }

  function normalizeStarChunkRecord(record) {
    if (!record || typeof record !== 'object') return null;
    return Object.assign({}, record, {
      min_x_ly: Number.isFinite(record.min_x_ly) ? Number(record.min_x_ly) : 0,
      max_x_ly: Number.isFinite(record.max_x_ly) ? Number(record.max_x_ly) : 0,
      min_y_ly: Number.isFinite(record.min_y_ly) ? Number(record.min_y_ly) : 0,
      max_y_ly: Number.isFinite(record.max_y_ly) ? Number(record.max_y_ly) : 0,
      sample_star_ids: Array.isArray(record.sample_star_ids) ? record.sample_star_ids.slice() : [],
    });
  }

  window.GQGalaxyChunkUtils = {
    resolveChunkPolicy,
    sectorCoord,
    chunkId,
    starIdForChunk,
    createStarChunkRecord,
    addStarToChunkRecord,
    buildStarChunkSummaries,
    normalizeStarChunkRecord,
  };
})();
