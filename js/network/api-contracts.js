/*
 * API Contract Validators
 * Defines contracts (schemas) for data transfer objects (DTOs) exchanged with the backend.
 * Ensures type safety, required fields, and value ranges are enforced client-side.
 *
 * Usage:
 *   const validation = GQAPIContracts.validateBootstrapResponse(payload);
 *   if (!validation.ok) {
 *     console.error('Contract violation:', validation.errors);
 *   }
 */

const GQAPIContracts = {
  VERSION: '1.0.0',

  /**
   * Bootstrap endpoint contract: GET /api/galaxy.php?action=bootstrap
   * @typedef {Object} BootstrapResponse
   * @property {string} action - Always 'bootstrap'
   * @property {number} render_schema_version - Renderer capability version
   * @property {number} assets_manifest_version - Asset pack version
   * @property {number} galaxy - Galaxy index (1-based)
   * @property {number} system_max - Total systems in galaxy
   * @property {string} server_ts - ISO 8601 timestamp
   * @property {number} server_ts_ms - Unix milliseconds
   * @property {Object} initial_range - {from, to, max_points}
   * @property {Object} endpoints - {stars, system, search, star_info}
   * @property {Array<string>} capabilities - Feature flags
   *
   * @param {Object} payload
   * @returns {Object} {ok, errors: string[]}
   */
  validateBootstrapResponse(payload) {
    const errors = [];

    if (!payload || typeof payload !== 'object') {
      return { ok: false, errors: ['Payload is null/undefined/not an object'] };
    }

    // Type checks
    if (payload.action !== 'bootstrap') {
      errors.push(`action should be 'bootstrap', got: "${payload.action}"`);
    }

    if (!Number.isFinite(Number(payload.render_schema_version))) {
      errors.push(`render_schema_version must be a finite number, got: ${payload.render_schema_version}`);
    } else if (Number(payload.render_schema_version) <= 0) {
      errors.push(`render_schema_version must be > 0, got: ${payload.render_schema_version}`);
    }

    if (!Number.isFinite(Number(payload.assets_manifest_version))) {
      errors.push(`assets_manifest_version must be a finite number, got: ${payload.assets_manifest_version}`);
    } else if (Number(payload.assets_manifest_version) <= 0) {
      errors.push(`assets_manifest_version must be > 0, got: ${payload.assets_manifest_version}`);
    }

    if (!Number.isFinite(Number(payload.galaxy))) {
      errors.push(`galaxy must be a finite number, got: ${payload.galaxy}`);
    } else if (Number(payload.galaxy) < 1) {
      errors.push(`galaxy must be >= 1, got: ${payload.galaxy}`);
    }

    if (!Number.isFinite(Number(payload.system_max))) {
      errors.push(`system_max must be a finite number, got: ${payload.system_max}`);
    } else if (Number(payload.system_max) < 1) {
      errors.push(`system_max must be >= 1, got: ${payload.system_max}`);
    }

    if (typeof payload.server_ts !== 'string') {
      errors.push(`server_ts must be a string (ISO 8601), got: ${typeof payload.server_ts}`);
    }

    if (!Number.isFinite(Number(payload.server_ts_ms))) {
      errors.push(`server_ts_ms must be a finite number, got: ${payload.server_ts_ms}`);
    }

    // initial_range validation
    if (typeof payload.initial_range !== 'object' || payload.initial_range === null) {
      errors.push(`initial_range must be an object, got: ${typeof payload.initial_range}`);
    } else {
      const ir = payload.initial_range;
      if (!Number.isFinite(Number(ir.from)) || Number(ir.from) < 1) {
        errors.push(`initial_range.from must be a finite number >= 1, got: ${ir.from}`);
      }
      if (!Number.isFinite(Number(ir.to)) || Number(ir.to) < Number(ir.from)) {
        errors.push(`initial_range.to must be >= from, got: ${ir.to} (from=${ir.from})`);
      }
      if (!Number.isFinite(Number(ir.max_points)) || Number(ir.max_points) < 100) {
        errors.push(`initial_range.max_points must be >= 100, got: ${ir.max_points}`);
      }
    }

    // endpoints validation
    if (typeof payload.endpoints !== 'object' || payload.endpoints === null) {
      errors.push(`endpoints must be an object, got: ${typeof payload.endpoints}`);
    } else {
      const required = ['stars', 'system', 'search', 'star_info'];
      for (const name of required) {
        if (typeof payload.endpoints[name] !== 'string' || !payload.endpoints[name].length) {
          errors.push(`endpoints.${name} must be a non-empty string, got: ${payload.endpoints[name]}`);
        }
      }
    }

    // capabilities should be array of strings (optional but recommended)
    if (payload.capabilities !== undefined) {
      if (!Array.isArray(payload.capabilities)) {
        errors.push(`capabilities must be an array if present, got: ${typeof payload.capabilities}`);
      } else {
        for (const cap of payload.capabilities) {
          if (typeof cap !== 'string') {
            errors.push(`capabilities must contain strings, found: ${typeof cap}`);
          }
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  },

  /**
   * System data contract: GET /api/galaxy.php?galaxy=N&system=N
   * @typedef {Object} SystemResponse
   * @property {number} galaxy
   * @property {number} system
   * @property {number} system_max
   * @property {number} server_ts_ms
   * @property {Object} star_system - {name, spectral_class, x_ly, y_ly, z_ly, hz_inner_au, hz_outer_au, planet_count}
   * @property {Array<Object>} planets - Planet slots
   * @property {Array<Object>} fleets_in_system
   * @property {Object} planet_texture_manifest - {planet_class: [textureUrls...]}
   *
   * @param {Object} payload
   * @returns {Object} {ok, errors: string[]}
   */
  validateSystemResponse(payload) {
    const errors = [];

    if (!payload || typeof payload !== 'object') {
      return { ok: false, errors: ['Payload is null/undefined/not an object'] };
    }

    // Galaxy & system indices
    if (!Number.isFinite(Number(payload.galaxy)) || Number(payload.galaxy) < 1) {
      errors.push(`galaxy must be a finite number >= 1, got: ${payload.galaxy}`);
    }

    if (!Number.isFinite(Number(payload.system)) || Number(payload.system) < 1) {
      errors.push(`system must be a finite number >= 1, got: ${payload.system}`);
    }

    if (!Number.isFinite(Number(payload.system_max)) || Number(payload.system_max) < 1) {
      errors.push(`system_max must be a finite number >= 1, got: ${payload.system_max}`);
    }

    // Timestamp
    if (!Number.isFinite(Number(payload.server_ts_ms))) {
      errors.push(`server_ts_ms must be a finite number, got: ${payload.server_ts_ms}`);
    }

    // Star system object
    if (typeof payload.star_system !== 'object' || payload.star_system === null) {
      errors.push(`star_system must be an object, got: ${typeof payload.star_system}`);
    } else {
      const ss = payload.star_system;
      if (typeof ss.name !== 'string' || !ss.name.length) {
        errors.push(`star_system.name must be a non-empty string, got: "${ss.name}"`);
      }
      if (typeof ss.spectral_class !== 'string' || !/^[OBAFGKM]/.test(ss.spectral_class)) {
        errors.push(`star_system.spectral_class must match [OBAFGKM], got: "${ss.spectral_class}"`);
      }
      if (!Number.isFinite(Number(ss.x_ly))) {
        errors.push(`star_system.x_ly must be a finite number, got: ${ss.x_ly}`);
      }
      if (!Number.isFinite(Number(ss.y_ly))) {
        errors.push(`star_system.y_ly must be a finite number, got: ${ss.y_ly}`);
      }
      if (!Number.isFinite(Number(ss.z_ly))) {
        errors.push(`star_system.z_ly must be a finite number, got: ${ss.z_ly}`);
      }
      if (!Number.isFinite(Number(ss.hz_inner_au)) || Number(ss.hz_inner_au) <= 0) {
        errors.push(`star_system.hz_inner_au must be > 0, got: ${ss.hz_inner_au}`);
      }
      if (!Number.isFinite(Number(ss.hz_outer_au)) || Number(ss.hz_outer_au) <= Number(ss.hz_inner_au || 0)) {
        errors.push(`star_system.hz_outer_au must be > hz_inner_au, got: ${ss.hz_outer_au}`);
      }
      if (!Number.isFinite(Number(ss.planet_count)) || Number(ss.planet_count) < 0) {
        errors.push(`star_system.planet_count must be >= 0, got: ${ss.planet_count}`);
      }
    }

    // Planets array
    if (!Array.isArray(payload.planets)) {
      errors.push(`planets must be an array, got: ${typeof payload.planets}`);
    } else {
      for (let i = 0; i < payload.planets.length; i++) {
        const planet = payload.planets[i];
        if (typeof planet !== 'object' || planet === null) {
          errors.push(`planets[${i}] must be an object, got: ${typeof planet}`);
          continue;
        }
        if (!Number.isFinite(Number(planet.position)) || Number(planet.position) < 0 || Number(planet.position) > 255) {
          errors.push(`planets[${i}].position must be in range [0, 255], got: ${planet.position}`);
        }
      }
    }

    // Fleets array
    if (!Array.isArray(payload.fleets_in_system)) {
      errors.push(`fleets_in_system must be an array, got: ${typeof payload.fleets_in_system}`);
    }

    // Texture manifest
    if (typeof payload.planet_texture_manifest !== 'object' || payload.planet_texture_manifest === null) {
      errors.push(`planet_texture_manifest must be an object, got: ${typeof payload.planet_texture_manifest}`);
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  },

  /**
   * Flight telemetry contract (internal, from SpaceCameraFlightDriver)
   * @typedef {Object} FlightTelemetry
   * @property {string} phase - 'idle', 'acquire', 'cruise', 'approach', 'brake', 'complete'
   * @property {number} targetId - System ID
   * @property {string} targetLabel - System name
   * @property {number} progress - [0, 1] Bezier parameter
   * @property {number} distance - LY  
   * @property {number} eta - Seconds
   * @property {number} speed - LY/s smoothed
   * @property {number} speedRaw - LY/s unsmoothed (optional)
   *
   * @param {Object} telemetry
   * @returns {Object} {ok, errors: string[]}
   */
  validateFlightTelemetry(telemetry) {
    const errors = [];

    if (!telemetry || typeof telemetry !== 'object') {
      return { ok: false, errors: ['Telemetry is null/undefined/not an object'] };
    }

    const allowedPhases = new Set(['idle', 'acquire', 'cruise', 'approach', 'brake', 'complete']);
    if (!allowedPhases.has(String(telemetry.phase).toLowerCase())) {
      errors.push(`phase must be one of ${Array.from(allowedPhases).join(', ')}, got: "${telemetry.phase}"`);
    }

    if (!Number.isFinite(Number(telemetry.targetId)) || Number(telemetry.targetId) < 0) {
      errors.push(`targetId must be >= 0, got: ${telemetry.targetId}`);
    }

    if (typeof telemetry.targetLabel !== 'string') {
      errors.push(`targetLabel must be a string, got: ${typeof telemetry.targetLabel}`);
    }

    if (!Number.isFinite(Number(telemetry.progress)) || Number(telemetry.progress) < 0 || Number(telemetry.progress) > 1) {
      errors.push(`progress must be in range [0, 1], got: ${telemetry.progress}`);
    }

    if (!Number.isFinite(Number(telemetry.distance)) || Number(telemetry.distance) < 0) {
      errors.push(`distance must be >= 0, got: ${telemetry.distance}`);
    }

    if (!Number.isFinite(Number(telemetry.eta)) || Number(telemetry.eta) < 0) {
      errors.push(`eta must be >= 0, got: ${telemetry.eta}`);
    }

    if (!Number.isFinite(Number(telemetry.speed)) || Number(telemetry.speed) < 0) {
      errors.push(`speed must be >= 0, got: ${telemetry.speed}`);
    }

    if (telemetry.speedRaw !== undefined) {
      if (!Number.isFinite(Number(telemetry.speedRaw)) || Number(telemetry.speedRaw) < 0) {
        errors.push(`speedRaw must be >= 0 if present, got: ${telemetry.speedRaw}`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  },

  /**
   * Serializes validation result for logging to backend.
   * @param {Object} result - {ok, errors}
   * @param {Object} opts - {contractName, context}
   * @returns {Object} serialized
   */
  serializeValidation(result, opts = {}) {
    return {
      timestamp: Date.now(),
      contractName: String(opts.contractName || 'unknown'),
      context: opts.context || {},
      result: {
        ok: result.ok,
        errorCount: result.errors?.length || 0,
        errors: result.errors || [],
      },
    };
  },

  /**
   * Reports contract status for monitoring.
   * @param {Map<string, Object>} results - Map of contractName → validation result
   * @returns {Object} report
   */
  generateReport(results) {
    if (!results || typeof results.get !== 'function') {
      return {
        ok: false,
        totalContracts: 0,
        passedContracts: 0,
        failedContracts: 0,
        violations: [],
      };
    }

    let passed = 0;
    let failed = 0;
    const violations = [];

    for (const [name, result] of results) {
      if (result.ok) {
        passed++;
      } else {
        failed++;
        for (const error of result.errors || []) {
          violations.push(`${name}: ${error}`);
        }
      }
    }

    return {
      ok: failed === 0,
      totalContracts: results.size,
      passedContracts: passed,
      failedContracts: failed,
      violations: violations.slice(0, 50), // Keep first 50
    };
  },
};

// Export to global namespace
if (typeof window !== 'undefined') {
  window.GQAPIContracts = GQAPIContracts;
}

// Export as module if in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GQAPIContracts;
}
