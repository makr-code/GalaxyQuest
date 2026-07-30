/**
 * data-worker.js
 *
 * WebWorker for data processing tasks that don't fit in physics or LOD.
 * Examples:
 *   - Mesh data parsing and transformation
 *   - JSON deserialization with large payloads
 *   - Texture coordinate calculations
 *   - Geometry optimization (decimation, welding)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// Import protocol
if (typeof WorkerProtocol === 'undefined') {
  importScripts('/js/engine/workers/WorkerProtocol.js');
}

/**
 * Task handlers
 */
const taskHandlers = {
  /**
   * Parse and validate JSON data.
   * @param {Object} data
   *   - json: string (JSON to parse)
   * @returns {Object} { parsed: Object, size: number }
   */
  'parseJSON': (data) => {
    const { json } = data;
    if (typeof json !== 'string') {
      throw new Error('json must be a string');
    }
    const parsed = JSON.parse(json);
    return {
      parsed,
      size: json.length,
    };
  },

  /**
   * Transform mesh data (example placeholder).
   * @param {Object} data
   *   - vertices: Float32Array
   *   - indices: Uint32Array
   * @returns {Object} { transformed: true }
   */
  'transformMesh': (data) => {
    const { vertices, indices } = data;
    if (!vertices || !indices) {
      throw new Error('vertices and indices required');
    }
    // Placeholder for actual mesh transformation
    return {
      transformed: true,
      vertexCount: vertices.length / 3,
      faceCount: indices.length / 3,
    };
  },

  /**
   * Stub: compute texture coordinates.
   */
  'computeTexCoords': (data) => {
    return {
      computed: true,
      message: 'Texture coordinate computation not yet implemented',
    };
  },
};

/**
 * Set up message listener
 */
self.onmessage = WorkerProtocol.createMessageHandler(taskHandlers);

console.log('[DataWorker] Initialized');
