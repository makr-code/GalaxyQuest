/**
 * Binary format decoder v2: Dynamic schema with string pooling.
 * Decodes fields from pool references instead of fixed positions.
 */

const BinaryDecoderV2 = (() => {
  // Field IDs (must match PHP constants)
  const FIELD_ID = {
    GALAXY: 1,
    SYSTEM: 2,
    STAR_NAME: 10,
    STAR_SPECTRAL: 11,
    STAR_X: 12,
    STAR_Y: 13,
    STAR_Z: 14,
    STAR_HZ_INNER: 15,
    STAR_HZ_OUTER: 16,
    
    PLANET_POSITION: 20,
    PLANET_NAME: 21,
    PLANET_CLASS: 22,
    PLANET_DIAMETER: 23,
    PLANET_IN_HZ: 24,
    PLANET_SMA: 25,
    PLANET_ORB_PERIOD: 26,
    PLANET_SURF_GRAV: 27,
    PLANET_OWNER: 28,
    
    FLEET_MISSION: 30,
    FLEET_ORIGIN: 31,
    FLEET_TARGET: 32,
    FLEET_VESSEL_TYPE: 33,
    FLEET_VESSEL_COUNT: 34,
    
    SECTION_STARS: 50,
    SECTION_PLANETS: 51,
    SECTION_FLEETS: 52,
    SECTION_END: 255,
  };

  // Value types
  const VALUE_TYPE = {
    NULL: 0,
    BOOL: 1,
    U8: 2,
    U16: 3,
    I32: 4,
    F32: 5,
    STRING: 6,
    POOL_REF: 7,
  };

  function readU8(buffer, offset) {
    return [buffer.getUint8(offset), offset + 1];
  }

  function readU16(buffer, offset) {
    return [buffer.getUint16(offset, false), offset + 2];
  }

  function readI32(buffer, offset) {
    return [buffer.getInt32(offset, false), offset + 4];
  }

  function readF32(buffer, offset) {
    return [buffer.getFloat32(offset, false), offset + 4];
  }

  function readString(buffer, offset) {
    const [len, off1] = readU8(buffer, offset);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset + off1, len);
    const str = new TextDecoder().decode(bytes);
    return [str, off1 + len];
  }

  /**
   * Decode binary v2 payload with dynamic field schema.
   * @param {ArrayBuffer} buffer - Binary data from server
   * @returns {object} Decoded system payload (or null if invalid)
   */
  function decode(buffer) {
    try {
      const dv = new DataView(buffer);
      let offset = 0;

      // Validate magic
      const magic = dv.getUint32(offset, false);
      if (magic !== 0xDEADBEEF) {
        console.error('[GQ-V2] Invalid magic:', hex(magic));
        return null;
      }
      offset += 4;

      // Validate version
      const version = dv.getUint16(offset, false);
      if (version !== 2) {
        console.warn('[GQ-V2] Unknown version:', version);
        return null;
      }
      offset += 2;

      // Decode string pool
      const [poolMetaSize, off1] = readU8(dv, offset);
      offset = off1;
      
      const pool = [];
      if (poolMetaSize > 0) {
        const [poolCount, off2] = readU8(dv, offset);
        offset = off2;
        
        for (let i = 0; i < poolCount; i++) {
          const [str, off3] = readString(dv, offset);
          offset = off3;
          pool.push(str);
        }
      }

      // Initialize result structure
      const result = {
        galaxy: 0,
        system: 0,
        star_system: {},
        planets: [],
        fleets_in_system: [],
      };

      let currentPlanet = null;
      let currentFleet = null;

      // Decode field chunks
      while (offset < dv.byteLength) {
        const [fieldId, off4] = readU8(dv, offset);
        offset = off4;

        if (fieldId === FIELD_ID.SECTION_END) break;

        const [type, off5] = readU8(dv, offset);
        offset = off5;

        // Section markers
        if (fieldId === FIELD_ID.SECTION_STARS) {
          continue;  // Marker only
        }
        if (fieldId === FIELD_ID.SECTION_PLANETS) {
          currentPlanet = null;
          continue;
        }
        if (fieldId === FIELD_ID.SECTION_FLEETS) {
          currentFleet = null;
          continue;
        }

        // Decode value based on type
        let value;
        const [val, newOffset] = _decodeValue(dv, offset, type, pool);
        value = val;
        offset = newOffset;

        // Route to appropriate container
        switch (fieldId) {
          case FIELD_ID.GALAXY:
            result.galaxy = value;
            break;
          case FIELD_ID.SYSTEM:
            result.system = value;
            break;

          case FIELD_ID.STAR_NAME:
            result.star_system.name = value;
            break;
          case FIELD_ID.STAR_SPECTRAL:
            result.star_system.spectral_class = value;
            break;
          case FIELD_ID.STAR_X:
            result.star_system.x_ly = value;
            break;
          case FIELD_ID.STAR_Y:
            result.star_system.y_ly = value;
            break;
          case FIELD_ID.STAR_Z:
            result.star_system.z_ly = value;
            break;
          case FIELD_ID.STAR_HZ_INNER:
            result.star_system.hz_inner_au = value;
            break;
          case FIELD_ID.STAR_HZ_OUTER:
            result.star_system.hz_outer_au = value;
            break;

          case FIELD_ID.PLANET_POSITION:
            currentPlanet = { position: value };
            result.planets.push(currentPlanet);
            break;
          case FIELD_ID.PLANET_NAME:
            if (!currentPlanet.planet_name) {
              if (!currentPlanet.player_planet) currentPlanet.player_planet = {};
              currentPlanet.player_planet.name = value;
            } else {
              if (!currentPlanet.generated_planet) currentPlanet.generated_planet = {};
              currentPlanet.generated_planet.name = value;
            }
            break;
          case FIELD_ID.PLANET_CLASS:
            if (!currentPlanet.planet_class) {
              if (!currentPlanet.player_planet) currentPlanet.player_planet = {};
              currentPlanet.player_planet.planet_class = value;
            } else {
              if (!currentPlanet.generated_planet) currentPlanet.generated_planet = {};
              currentPlanet.generated_planet.planet_class = value;
            }
            break;
          case FIELD_ID.PLANET_DIAMETER:
            if (!currentPlanet.generated_planet) currentPlanet.generated_planet = {};
            currentPlanet.generated_planet.diameter_km = value * 100;
            break;
          case FIELD_ID.PLANET_IN_HZ:
            if (!currentPlanet.player_planet) currentPlanet.player_planet = {};
            if (!currentPlanet.generated_planet) currentPlanet.generated_planet = {};
            currentPlanet.player_planet.in_habitable_zone = value;
            currentPlanet.generated_planet.in_habitable_zone = value;
            break;
          case FIELD_ID.PLANET_SMA:
            if (currentPlanet.player_planet) currentPlanet.player_planet.semi_major_axis_au = value;
            if (currentPlanet.generated_planet) currentPlanet.generated_planet.semi_major_axis_au = value;
            break;
          case FIELD_ID.PLANET_ORB_PERIOD:
            if (!currentPlanet.generated_planet) currentPlanet.generated_planet = {};
            currentPlanet.generated_planet.orbital_period_days = value;
            break;
          case FIELD_ID.PLANET_SURF_GRAV:
            if (!currentPlanet.generated_planet) currentPlanet.generated_planet = {};
            currentPlanet.generated_planet.surface_gravity_g = value;
            break;
          case FIELD_ID.PLANET_OWNER:
            if (!currentPlanet.player_planet) currentPlanet.player_planet = {};
            currentPlanet.player_planet.owner = value;
            break;

          case FIELD_ID.FLEET_MISSION:
            currentFleet = { mission: value, vessels: {} };
            result.fleets_in_system.push(currentFleet);
            break;
          case FIELD_ID.FLEET_ORIGIN:
            if (!currentFleet) currentFleet = { vessels: {} };
            currentFleet.origin_position = value;
            break;
          case FIELD_ID.FLEET_TARGET:
            if (!currentFleet) currentFleet = { vessels: {} };
            currentFleet.target_position = value;
            break;
          case FIELD_ID.FLEET_VESSEL_TYPE:
            if (!currentFleet) currentFleet = { vessels: {} };
            currentFleet._lastVesselType = value;
            break;
          case FIELD_ID.FLEET_VESSEL_COUNT:
            if (currentFleet && currentFleet._lastVesselType) {
              currentFleet.vessels[currentFleet._lastVesselType] = value;
              delete currentFleet._lastVesselType;
            }
            break;
        }
      }

      // Cleanup
      for (const fleet of result.fleets_in_system) {
        delete fleet._lastVesselType;
      }

      return result;
    } catch (err) {
      console.error('[GQ-V2] Decode failed:', err);
      return null;
    }
  }

  /**
   * Decode a single value based on type.
   */
  function _decodeValue(buffer, offset, type, pool) {
    switch (type) {
      case VALUE_TYPE.NULL:
        return [null, offset];
      
      case VALUE_TYPE.BOOL:
        const [b, o1] = readU8(buffer, offset);
        return [b === 1, o1];
      
      case VALUE_TYPE.U8:
        return readU8(buffer, offset);
      
      case VALUE_TYPE.U16:
        return readU16(buffer, offset);
      
      case VALUE_TYPE.I32:
        return readI32(buffer, offset);
      
      case VALUE_TYPE.F32:
        return readF32(buffer, offset);
      
      case VALUE_TYPE.STRING:
        return readString(buffer, offset);
      
      case VALUE_TYPE.POOL_REF:
        const [idx, o2] = readU8(buffer, offset);
        return [pool[idx] || '', o2];
      
      default:
        console.warn('[GQ-V2] Unknown type:', type);
        return [null, offset];
    }
  }

  function hex(val) {
    return '0x' + val.toString(16).toUpperCase().padStart(8, '0');
  }

  return { decode };
})();
