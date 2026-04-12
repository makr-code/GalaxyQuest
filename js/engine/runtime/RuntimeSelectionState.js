/**
 * RuntimeSelectionState.js
 *
 * Selection state normalization and commit flow for runtime/game.js.
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  const runtimeCtx = {
    getIsSystemMode: () => false,
    getClusterSummary: () => [],
    getSelectionState: () => null,
    setActiveStar: () => {},
    setActiveSystem: () => {},
    applySelectionGroupHighlight: () => {},
  };

  function configureSelectionRuntime(opts = {}) {
    if (!opts || typeof opts !== 'object') return;
    Object.assign(runtimeCtx, opts);
  }

  function normalizeSelectionPosition(pos) {
    if (!pos || typeof pos !== 'object') return null;
    const x = Number(pos.x);
    const y = Number(pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function buildSelectionKey(target) {
    if (!target || typeof target !== 'object') return null;
    const kind = String(target.__kind || 'star').trim().toLowerCase();
    if (kind === 'cluster') {
      return `cluster:${Number(target.__clusterIndex || -1)}`;
    }
    if (kind === 'planet') {
      const sourceStar = target.__sourceStar || {};
      return `planet:${Number(sourceStar.galaxy_index || target.galaxy_index || 0)}:${Number(sourceStar.system_index || target.system || 0)}:${Number(target.id || target.planet_id || target.__slot?.position || target.position || 0)}`;
    }
    if (kind === 'system_fleet' || kind === 'galaxy_fleet') {
      return `${kind}:${Number(target.id || target.fleet_id || 0)}`;
    }
    if (kind === 'orbital_facility') {
      return `orbital_facility:${Number(target.__slot?.player_planet?.colony_id || target.colony_id || 0)}:${Number(target.__slot?.position || 0)}`;
    }
    if (kind === 'star_installation') {
      return `star_installation:${Number(target.id || target.installation_id || 0)}`;
    }
    if (kind === 'system_traffic') {
      return `system_traffic:${Number(target.orbitRadius || 0)}:${Number(target.orbitSpeed || 0)}`;
    }
    if (kind === 'ftl_node') {
      return `ftl_node:${Number(target.id || target.node_id || 0)}`;
    }
    if (kind === 'ftl_gate') {
      return `ftl_gate:${Number(target.id || target.gate_id || 0)}:${String(target.__endpoint || '')}`;
    }
    return `star:${Number(target.galaxy_index || 0)}:${Number(target.system_index || 0)}`;
  }

  function normalizeRendererSelection(target, pos, eventType = 'hover') {
    const isSystemMode = !!runtimeCtx.getIsSystemMode();
    if (!target || typeof target !== 'object') {
      return {
        key: null,
        kind: null,
        target: null,
        position: normalizeSelectionPosition(pos),
        eventType: String(eventType || 'hover'),
        mode: isSystemMode ? 'system' : 'galaxy',
        sourceView: 'renderer',
      };
    }
    const kind = String(target.__kind || 'star').trim().toLowerCase();
    const sourceStar = target.__sourceStar || null;
    return {
      key: String(target.__selectionKey || buildSelectionKey(target) || ''),
      kind,
      target,
      position: normalizeSelectionPosition(pos),
      eventType: String(eventType || 'hover'),
      mode: String(target.__selectionMode || (isSystemMode ? 'system' : 'galaxy')),
      scope: String(target.__selectionScope || (kind === 'cluster' ? 'cluster' : (kind === 'planet' ? 'system' : 'galaxy'))),
      sourceView: String(target.__selectionSourceView || 'renderer'),
      galaxy: Number(target.galaxy_index || sourceStar?.galaxy_index || 0),
      system: Number(target.system_index || sourceStar?.system_index || target.system || 0),
      slot: Number(target.__slot?.position || target.position || 0),
    };
  }

  function resolveSelectionGroupMembers(normalized) {
    if (!normalized?.target || typeof normalized.target !== 'object') return { members: [], group: null };
    const target = normalized.target;
    const kind = String(normalized.kind || '').toLowerCase();

    if (kind === 'cluster') {
      const clusterSystems = Array.isArray(target.__clusterSystems)
        ? [...new Set(target.__clusterSystems.map((n) => Number(n || 0)).filter((n) => Number.isFinite(n) && n > 0))]
        : [];
      const factionId = Number(target?.faction?.id || target?.faction?.faction_id || target?.faction_id || 0);
      const factionName = String(target?.faction?.name || target?.faction_name || '').trim();
      let systems = clusterSystems.slice();
      const clusterSummary = runtimeCtx.getClusterSummary();
      if ((factionId > 0 || factionName) && Array.isArray(clusterSummary) && clusterSummary.length) {
        const factionSystems = clusterSummary
          .filter((cluster) => {
            const cf = cluster?.faction || null;
            const cid = Number(cf?.id || cf?.faction_id || 0);
            const cname = String(cf?.name || '').trim();
            if (factionId > 0 && cid > 0) return cid === factionId;
            if (factionName && cname) return cname.localeCompare(factionName, 'de', { sensitivity: 'base' }) === 0;
            return false;
          })
          .flatMap((cluster) => Array.isArray(cluster?.systems) ? cluster.systems : [])
          .map((n) => Number(n || 0))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (factionSystems.length) systems = [...new Set(factionSystems)];
      }
      const groupType = (factionId > 0 || factionName) && systems.length > clusterSystems.length
        ? 'faction'
        : 'cluster';
      const members = systems.map((systemIndex) => ({
        key: `${groupType}:${systemIndex}`,
        kind: 'star',
        system: Number(systemIndex || 0),
        mode: 'galaxy',
        sourceView: 'renderer',
      }));
      return {
        members,
        group: {
          type: groupType,
          systems,
          factionId: factionId > 0 ? factionId : 0,
          factionName: factionName || '',
        },
      };
    }

    return {
      members: normalized.key ? [normalized] : [],
      group: normalized.key
        ? {
            type: 'single',
            systems: Number.isFinite(Number(normalized.system || 0)) && Number(normalized.system || 0) > 0
              ? [Number(normalized.system || 0)]
              : [],
          }
        : null,
    };
  }

  function getSelectionGroupHighlightedSystems(selectionState) {
    const systems = Array.isArray(selectionState?.group?.systems)
      ? selectionState.group.systems
      : [];
    return [...new Set(
      systems
        .map((n) => Number(n || 0))
        .filter((n) => Number.isFinite(n) && n > 0)
    )];
  }

  function commitSelectionState(kind, target, pos, eventType = 'hover') {
    const selectionState = runtimeCtx.getSelectionState();
    const normalized = normalizeRendererSelection(target, pos, eventType);
    if (!selectionState || typeof selectionState !== 'object') {
      return normalized;
    }

    selectionState.mode = normalized.mode || selectionState.mode || 'galaxy';
    selectionState.sourceView = normalized.sourceView || 'renderer';
    selectionState.updatedAt = Date.now();

    if (kind === 'hover') {
      selectionState.hover = normalized.target ? normalized : null;
      return normalized;
    }

    if (kind === 'active') {
      selectionState.active = normalized.target ? normalized : null;
      const groupSelection = resolveSelectionGroupMembers(normalized);
      selectionState.multiSelection = normalized.target ? groupSelection.members : [];
      selectionState.group = normalized.target ? (groupSelection.group || null) : null;
      if (normalized.target && normalized.kind === 'star') {
        runtimeCtx.setActiveStar(normalized.target);
        runtimeCtx.setActiveSystem(Math.max(1, Number(normalized.target.system_index || 1)));
      }
      runtimeCtx.applySelectionGroupHighlight();
      return normalized;
    }

    return normalized;
  }

  /**
   * createSelectionStore() — Phase 1: Unified Selection Store
   *
   * Returns a properly shaped, mutable selection-state object that can be
   * assigned to uiState.selectionState (or the legacy uiState.selection alias).
   * Every field has a defined initial value so consumers never encounter
   * undefined properties.
   *
   * Shape:
   *   active         – currently selected object (normalized or null)
   *   hover          – object under pointer (normalized or null)
   *   multiSelection – array of normalized members for group/cluster selection
   *   group          – group descriptor { type, systems, factionId, factionName }
   *   mode           – 'galaxy' | 'system'
   *   sourceView     – view that last triggered a selection event
   *   updatedAt      – timestamp of last mutation (ms since epoch, 0 = never)
   */
  function createSelectionStore() {
    return {
      active: null,
      hover: null,
      multiSelection: [],
      group: null,
      mode: 'galaxy',
      sourceView: 'renderer',
      updatedAt: 0,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      configureSelectionRuntime,
      normalizeSelectionPosition,
      buildSelectionKey,
      normalizeRendererSelection,
      resolveSelectionGroupMembers,
      getSelectionGroupHighlightedSystems,
      commitSelectionState,
      createSelectionStore,
    };
  } else {
    window.GQRuntimeSelectionState = {
      configureSelectionRuntime,
      normalizeSelectionPosition,
      buildSelectionKey,
      normalizeRendererSelection,
      resolveSelectionGroupMembers,
      getSelectionGroupHighlightedSystems,
      commitSelectionState,
      createSelectionStore,
    };
  }
})();
