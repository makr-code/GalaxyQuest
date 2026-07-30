/**
 * js/engine/procedural/index.js
 * Export procedural generation modules
 */

'use strict';

const { ProceduralMeshGenerator } = typeof require !== 'undefined'
  ? require('./ProceduralMeshGenerator.js')
  : { ProceduralMeshGenerator: window.GQProceduralMeshGenerator?.ProceduralMeshGenerator };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ProceduralMeshGenerator,
  };
}

if (typeof window !== 'undefined') {
  window.GQProcedural = { ProceduralMeshGenerator };
}
