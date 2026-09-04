import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modelPath = path.resolve(process.cwd(), 'js/runtime/galaxy-model.js');
const chunkUtilsPath = path.resolve(process.cwd(), 'js/runtime/galaxy-chunk-utils.js');
const helperPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeGalaxyStarLoadingHelpers.js');
const persistencePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeGalaxyStarPersistence.js');

function evalBrowserScript(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  window.eval(src);
}

describe('galaxy scale foundation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.GQGalaxyChunkUtils;
    delete window.GQGalaxyModel;
    delete window.GQRuntimeGalaxyStarLoadingHelpers;
    delete window.GQRuntimeGalaxyStarPersistence;
  });

  it('builds chunk summaries in the galaxy model during star upsert', () => {
    evalBrowserScript(chunkUtilsPath);
    evalBrowserScript(modelPath);
    const model = new window.GQGalaxyModel();
    model.rebuildStarChunks = vi.fn(model.rebuildStarChunks.bind(model));
    model.upsertStarBatch(1, [
      { galaxy_index: 1, system_index: 1, x_ly: 10, y_ly: 10, name: 'Sol' },
      { galaxy_index: 1, system_index: 2, x_ly: 30, y_ly: 40, name: 'Alpha' },
      { galaxy_index: 1, system_index: 3, x_ly: 310, y_ly: 20, name: 'Vega' },
    ], { sectorSpanLy: 256 });

    const chunks = model.listStarChunks(1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].star_count + chunks[1].star_count).toBe(3);

    const visible = model.queryStarChunks(1, { minX: 0, maxX: 255, minY: 0, maxY: 255 });
    expect(visible).toHaveLength(1);
    expect(visible[0].star_count).toBe(2);
    expect(model.stats().starChunks).toBe(2);
    expect(model.rebuildStarChunks).not.toHaveBeenCalled();
  });

  it('bridges runtime star loads through snapshot-based renderer updates', () => {
    evalBrowserScript(chunkUtilsPath);
    evalBrowserScript(helperPath);
    const api = window.GQRuntimeGalaxyStarLoadingHelpers;
    const renderer = {
      applyGalaxySnapshot: vi.fn(),
    };

    api.configureGalaxyStarLoadingHelpersRuntime({
      getGalaxy3d: () => renderer,
      getGalaxyStars: () => [],
      getUiState: () => ({}),
      getDisplayedGalaxyStars: (stars) => stars,
      getDisplayedGalaxyClusterSummary: (clusters) => clusters,
      getGalaxyFleets: () => [{ id: 'fleet-1' }],
      getFtlMap: () => ({ gates: [{ id: 'gate-1' }], resonance_nodes: [{ id: 'node-1' }] }),
    });

    const ok = api.applyStarsToRenderer({
      stars: [
        { galaxy_index: 1, system_index: 1, x_ly: 10, y_ly: 10 },
        { galaxy_index: 1, system_index: 2, x_ly: 300, y_ly: 10 },
      ],
      clusterSummary: [{ id: 'cluster-1', systems: [1, 2] }],
      galaxyIndex: 1,
      galaxyMeta: { id: 1, name: 'Milky Way' },
    });

    expect(ok).toBe(true);
    expect(renderer.applyGalaxySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        stars: expect.any(Array),
        chunkSummaries: expect.any(Array),
        clusterAuras: expect.any(Array),
        fleets: expect.any(Array),
      }),
      expect.objectContaining({ preserveView: false }),
    );
  });

  it('updates chunk summaries incrementally when deleting stars and systems', () => {
    evalBrowserScript(chunkUtilsPath);
    evalBrowserScript(modelPath);
    const model = new window.GQGalaxyModel();
    model.upsertStarBatch(1, [
      { galaxy_index: 1, system_index: 1, x_ly: 10, y_ly: 10, name: 'Sol' },
      { galaxy_index: 1, system_index: 2, x_ly: 30, y_ly: 40, name: 'Alpha' },
      { galaxy_index: 1, system_index: 3, x_ly: 310, y_ly: 20, name: 'Vega' },
    ], { sectorSpanLy: 256 });

    expect(model.listStarChunks(1).map((chunk) => chunk.star_count)).toEqual([2, 1]);

    model.delete('star', { galaxy_index: 1, system_index: 2 });
    let chunks = model.listStarChunks(1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].star_count).toBe(1);
    expect(chunks[0].sample_star_ids).not.toContain('g:1:s:2');

    model.delete('system', { galaxy_index: 1, system_index: 3 });
    chunks = model.listStarChunks(1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].star_count).toBe(1);
    expect(model.stats().starChunks).toBe(1);
  });

  it('persists only touched chunk summaries and deletes emptied chunk ids', () => {
    evalBrowserScript(chunkUtilsPath);
    evalBrowserScript(modelPath);
    evalBrowserScript(persistencePath);
    const model = new window.GQGalaxyModel();
    const db = {
      upsertStars: vi.fn(() => Promise.resolve()),
      upsertStarChunks: vi.fn(() => Promise.resolve()),
      deleteStarChunks: vi.fn(() => Promise.resolve()),
    };
    const api = window.GQRuntimeGalaxyStarPersistence;
    api.configureGalaxyStarPersistenceRuntime({
      getGalaxyModel: () => model,
      getGalaxyDb: () => db,
      hasDenseSystemCoverage: () => true,
    });

    api.persistNetworkStars({
      galaxyIndex: 1,
      fromSystem: 1,
      toSystem: 1,
      data: { server_ts_ms: 100, stride: 1, stars: [] },
      galaxyStars: [{ galaxy_index: 1, system_index: 1, x_ly: 12, y_ly: 12, name: 'Sol' }],
    });
    expect(db.upsertStarChunks).toHaveBeenLastCalledWith(
      [expect.objectContaining({ id: 'g:1:chunk:0:0', star_count: 1 })],
      100,
    );

    db.upsertStarChunks.mockClear();
    db.deleteStarChunks.mockClear();
    api.persistNetworkStars({
      galaxyIndex: 1,
      fromSystem: 1,
      toSystem: 1,
      data: { server_ts_ms: 200, stride: 1, stars: [] },
      galaxyStars: [{ galaxy_index: 1, system_index: 1, x_ly: 400, y_ly: 12, name: 'Sol' }],
    });

    expect(db.deleteStarChunks).toHaveBeenCalledWith(['g:1:chunk:0:0']);
    expect(db.upsertStarChunks).toHaveBeenLastCalledWith(
      [expect.objectContaining({ id: 'g:1:chunk:1:0', star_count: 1 })],
      200,
    );
  });
});
