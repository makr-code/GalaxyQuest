/**
 * Binary format decoder for GalaxyQuest API responses.
 * Counterpart to api/compression.php encode_system_payload_binary()
 */

const BinaryDecoder = (() => {
  // Enums (must match PHP constants)
  const SPECTRAL_CLASS_MAP = {
    0: 'G', 1: 'F', 2: 'A', 3: 'B', 4: 'O', 5: 'K', 6: 'M'
  };
  
  const PLANET_CLASS_MAP = {
    0: 'rocky', 1: 'terrestrial', 2: 'super_earth', 3: 'ice',
    4: 'gas_giant', 5: 'ice_giant', 6: 'terrestrial_high_metal'
  };
  
  const MISSION_MAP = {
    0: 'transport', 1: 'military', 2: 'exploration', 3: 'colonization'
  };

  /**
   * Read unsigned 8-bit integer
   */
  function readU8(buffer, offset) {
    return [buffer.getUint8(offset), offset + 1];
  }

  /**
   * Read signed 8-bit integer
   */
  function readI8(buffer, offset) {
    return [buffer.getInt8(offset), offset + 1];
  }

  /**
   * Read unsigned 16-bit integer (big-endian, matching PHP pack('n'))
   */
  function readU16(buffer, offset) {
    return [buffer.getUint16(offset, false), offset + 2];
  }

  /**
   * Read signed 32-bit integer (big-endian, matching PHP pack('i'))
   */
  function readI32(buffer, offset) {
    return [buffer.getInt32(offset, false), offset + 4];
  }

  /**
   * Read 32-bit float (big-endian, matching PHP pack('f'))
   */
  function readF32(buffer, offset) {
    return [buffer.getFloat32(offset, false), offset + 4];
  }

  /**
   * Read variable-length string (prefixed with u8 length)
   */
  function readString(buffer, offset) {
    const [len, off1] = readU8(buffer, offset);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset + off1, len);
    const str = new TextDecoder().decode(bytes);
    return [str, off1 + len];
  }

  /**
   * Decode binary system payload to JSON structure
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
        console.error('[GQ] Binary decode: invalid magic', hex(magic));
        return null;
      }
      offset += 4;

      // Validate version
      const version = dv.getUint16(offset, false);
      if (version !== 1) {
        console.warn('[GQ] Binary decode: unknown version', version);
        return null;
      }
      offset += 2;

      // Decode header
      const [galaxy, off1] = readU16(dv, offset);
      offset = off1;
      const [system, off2] = readU16(dv, offset);
      offset = off2;

      // Decode star system
      const [starName, off3] = readString(dv, offset);
      offset = off3;

      const [spectralIdx, off4] = readU8(dv, offset);
      offset = off4;
      const spectralClass = SPECTRAL_CLASS_MAP[spectralIdx] || 'G';

      const [xLy, off5] = readI32(dv, offset);
      offset = off5;
      const [yLy, off6] = readI32(dv, offset);
      offset = off6;
      const [zLy, off7] = readI32(dv, offset);
      offset = off7;

      const [hzInner, off8] = readF32(dv, offset);
      offset = off8;
      const [hzOuter, off9] = readF32(dv, offset);
      offset = off9;

      const starSystem = {
        name: starName,
        spectral_class: spectralClass,
        x_ly: xLy,
        y_ly: yLy,
        z_ly: zLy,
        hz_inner_au: hzInner,
        hz_outer_au: hzOuter,
        planet_count: 0
      };

      // Decode planets
      const [planetCount, off10] = readU8(dv, offset);
      offset = off10;
      const planets = [];

      for (let i = 0; i < planetCount; i++) {
        const [position, off11] = readU8(dv, offset);
        offset = off11;
        const [flags, off12] = readU8(dv, offset);
        offset = off12;

        const hasPlayer = (flags & 0x01) !== 0;
        const hasGenerated = (flags & 0x02) !== 0;

        const slot = { position };

        if (hasPlayer) {
          const [playerId, off13] = readString(dv, offset);
          offset = off13;
          const [ppName, off14] = readString(dv, offset);
          offset = off14;
          const [owner, off15] = readString(dv, offset);
          offset = off15;

          const [classIdx, off16] = readU8(dv, offset);
          offset = off16;
          const [inHz, off17] = readU8(dv, offset);
          offset = off17;
          const [sma, off18] = readF32(dv, offset);
          offset = off18;

          slot.player_planet = {
            id: playerId,
            name: ppName,
            owner,
            planet_class: PLANET_CLASS_MAP[classIdx] || 'rocky',
            in_habitable_zone: inHz === 1,
            semi_major_axis_au: sma
          };
        }

        if (hasGenerated) {
          const [gpName, off19] = readString(dv, offset);
          offset = off19;
          const [classIdx, off20] = readU8(dv, offset);
          offset = off20;
          const [diamCode, off21] = readU16(dv, offset);
          offset = off21;
          const [inHz, off22] = readU8(dv, offset);
          offset = off22;
          const [sma, off23] = readF32(dv, offset);
          offset = off23;
          const [orbPeriod, off24] = readF32(dv, offset);
          offset = off24;
          const [surfGrav, off25] = readF32(dv, offset);
          offset = off25;

          slot.generated_planet = {
            name: gpName,
            planet_class: PLANET_CLASS_MAP[classIdx] || 'rocky',
            diameter_km: diamCode * 100,
            in_habitable_zone: inHz === 1,
            semi_major_axis_au: sma,
            orbital_period_days: orbPeriod,
            surface_gravity_g: surfGrav
          };
        }

        planets.push(slot);
      }

      starSystem.planet_count = planetCount;

      // Decode fleets
      const [fleetCount, off26] = readU8(dv, offset);
      offset = off26;
      const fleets = [];

      for (let i = 0; i < fleetCount; i++) {
        const [missionIdx, off27] = readU8(dv, offset);
        offset = off27;
        const [originPos, off28] = readU8(dv, offset);
        offset = off28;
        const [targetPos, off29] = readU8(dv, offset);
        offset = off29;
        const [vesselCount, off30] = readU8(dv, offset);
        offset = off30;

        const vessels = {};
        for (let j = 0; j < vesselCount; j++) {
          const [vType, off31] = readString(dv, offset);
          offset = off31;
          const [vCount, off32] = readU16(dv, offset);
          offset = off32;
          vessels[vType] = vCount;
        }

        fleets.push({
          mission: MISSION_MAP[missionIdx] || 'transport',
          origin_position: originPos,
          target_position: targetPos,
          vessels
        });
      }

      const result = {
        galaxy,
        system,
        star_system: starSystem,
        planets,
        fleets_in_system: fleets
      };

      return result;
    } catch (err) {
      console.error('[GQ] Binary decode failed:', err);
      return null;
    }
  }

  function hex(val) {
    return '0x' + val.toString(16).toUpperCase().padStart(8, '0');
  }

  return { decode };
})();
