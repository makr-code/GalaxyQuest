/**
 * js/engine/lod/index.js
 * Export LOD system modules
 */

'use strict';

const { LODConfig } = typeof require !== 'undefined'
  ? require('./LODConfig.js')
  : { LODConfig: window.GQLODConfig?.LODConfig };

const { LODManager } = typeof require !== 'undefined'
  ? require('./LODManager.js')
  : { LODManager: window.GQLODManager?.LODManager };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LODConfig,
    LODManager,
  };
}

if (typeof window !== 'undefined') {
  window.GQLOD = { LODConfig, LODManager };
}
