/**
 * Binary Decoder V3
 * Must match api/compression-v3.php wire format.
 */

const BinaryDecoderV3 = (() => {
  const MAGIC = 0xDEADBEEF;
  const VERSION = 3;

  const SECTION_STARS = 50;
  const SECTION_PLANETS = 51;
  const SECTION_FLEETS = 52;
  const SECTION_END = 255;

  const FIELD_GALAXY = 1;
  const FIELD_SYSTEM = 2;

  const FIELD_STAR_NAME = 10;
  const FIELD_STAR_SPECTRAL = 11;
  const FIELD_STAR_X = 12;
  const FIELD_STAR_Y = 13;
  const FIELD_STAR_Z = 14;
  const FIELD_STAR_HZ_INNER = 15;
  const FIELD_STAR_HZ_OUTER = 16;
  const FIELD_STAR_PLANET_COUNT = 17;

  const FIELD_PLANET_POSITION = 20;
  const FIELD_PLANET_KIND = 21;
  const FIELD_PLANET_NAME = 22;
  const FIELD_PLANET_CLASS = 23;
  const FIELD_PLANET_OWNER = 24;
  const FIELD_BODY_ID = 25; // wire-compat: field number unchanged
  const FIELD_PLANET_IN_HZ = 26;
  const FIELD_PLANET_SMA = 27;
  const FIELD_PLANET_DIAMETER = 28;
  const FIELD_PLANET_ORB_PERIOD = 29;
  const FIELD_PLANET_SURF_GRAV = 30;

  const FIELD_FLEET_MISSION = 40;
  const FIELD_FLEET_ORIGIN = 41;
  const FIELD_FLEET_TARGET = 42;
  const FIELD_FLEET_VESSEL_TYPE = 43;
  const FIELD_FLEET_VESSEL_COUNT = 44;

  const TYPE_NULL = 0;
  const TYPE_BOOL = 1;
  const TYPE_U8 = 2;
  const TYPE_U16 = 3;
  const TYPE_I32 = 4;
  const TYPE_F32 = 5;
  const TYPE_STRING = 6;
  const TYPE_POOL_REF = 7;
  const TYPE_DELTA_I32 = 8;
  const TYPE_DELTA_F32 = 9;
  const TYPE_ZIGZAG_I32 = 11;

  function zigzagDecode(u32) {
    return (u32 >>> 1) ^ -(u32 & 1);
  }

  function readU8(dv, off) { return [dv.getUint8(off), off + 1]; }
  function readU16(dv, off) { return [dv.getUint16(off, false), off + 2]; }
  function readU32(dv, off) { return [dv.getUint32(off, false), off + 4]; }
  function readI32(dv, off) { return [dv.getInt32(off, false), off + 4]; }
  function readF32(dv, off) { return [dv.getFloat32(off, false), off + 4]; }

  function readString16(dv, off) {
    let len;
    [len, off] = readU16(dv, off);
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset + off, len);
    const str = new TextDecoder().decode(bytes);
    return [str, off + len];
  }

  function readValue(dv, off, type, pool) {
    if (type === TYPE_NULL) return [null, off];
    if (type === TYPE_BOOL) {
      let v;
      [v, off] = readU8(dv, off);
      return [v === 1, off];
    }
    if (type === TYPE_U8) return readU8(dv, off);
    if (type === TYPE_U16) return readU16(dv, off);
    if (type === TYPE_I32 || type === TYPE_DELTA_I32) return readI32(dv, off);
    if (type === TYPE_F32 || type === TYPE_DELTA_F32) return readF32(dv, off);
    if (type === TYPE_STRING) return readString16(dv, off);
    if (type === TYPE_POOL_REF) {
      let idx;
      [idx, off] = readU16(dv, off);
      return [pool[idx] || '', off];
    }
    if (type === TYPE_ZIGZAG_I32) {
      let raw;
      [raw, off] = readU32(dv, off);
      return [zigzagDecode(raw), off];
    }
    return [null, off];
  }

  function decode(buffer) {
    try {
      const dv = new DataView(buffer);
      let off = 0;

      let magic;
      [magic, off] = readU32(dv, off);
      if (magic !== MAGIC) return null;

      let version;
      [version, off] = readU16(dv, off);
      if (version !== VERSION) return null;

      let poolCount;
      [poolCount, off] = readU16(dv, off);
      const pool = [];
      for (let i = 0; i < poolCount; i++) {
        let s;
        [s, off] = readString16(dv, off);
        pool.push(s);
      }

      const out = {
        galaxy: 0,
        system: 0,
        star_system: {
          name: 'Unknown',
          spectral_class: 'G',
          x_ly: 0,
          y_ly: 0,
          z_ly: 0,
          hz_inner_au: 0.95,
          hz_outer_au: 1.37,
          planet_count: 0,
        },
        planets: [],
        fleets_in_system: [],
      };

      let section = 0;
      let currentSlot = null;
      let currentKind = 0; // 1=player, 2=generated
      let prevSma = 0;
      let prevDiameter = 0;

      let currentFleet = null;
      let pendingVesselType = '';

      while (off < dv.byteLength) {
        let fieldId;
        [fieldId, off] = readU8(dv, off);

        if (fieldId === SECTION_END) break;
        if (fieldId === SECTION_STARS || fieldId === SECTION_PLANETS || fieldId === SECTION_FLEETS) {
          section = fieldId;
          continue;
        }

        let type;
        [type, off] = readU8(dv, off);
        let value;
        [value, off] = readValue(dv, off, type, pool);

        if (fieldId === FIELD_GALAXY) {
          out.galaxy = Number(value || 0);
          continue;
        }
        if (fieldId === FIELD_SYSTEM) {
          out.system = Number(value || 0);
          continue;
        }

        if (section === SECTION_STARS) {
          if (fieldId === FIELD_STAR_NAME) out.star_system.name = String(value || 'Unknown');
          else if (fieldId === FIELD_STAR_SPECTRAL) out.star_system.spectral_class = String(value || 'G');
          else if (fieldId === FIELD_STAR_X) out.star_system.x_ly = Number(value || 0);
          else if (fieldId === FIELD_STAR_Y) out.star_system.y_ly = Number(value || 0);
          else if (fieldId === FIELD_STAR_Z) out.star_system.z_ly = Number(value || 0);
          else if (fieldId === FIELD_STAR_HZ_INNER) out.star_system.hz_inner_au = Number(value || 0);
          else if (fieldId === FIELD_STAR_HZ_OUTER) out.star_system.hz_outer_au = Number(value || 0);
          else if (fieldId === FIELD_STAR_PLANET_COUNT) out.star_system.planet_count = Number(value || 0);
          continue;
        }

        if (section === SECTION_PLANETS) {
          if (fieldId === FIELD_PLANET_POSITION) {
            currentSlot = { position: Number(value || 0), player_planet: null, generated_planet: null };
            out.planets.push(currentSlot);
            currentKind = 0;
            continue;
          }
          if (!currentSlot) continue;

          if (fieldId === FIELD_PLANET_KIND) {
            currentKind = Number(value || 0);
            if (currentKind === 1 && !currentSlot.player_planet) currentSlot.player_planet = {};
            if (currentKind === 2 && !currentSlot.generated_planet) currentSlot.generated_planet = {};
            continue;
          }

          const target = currentKind === 1
            ? (currentSlot.player_planet || (currentSlot.player_planet = {}))
            : (currentSlot.generated_planet || (currentSlot.generated_planet = {}));

          if (fieldId === FIELD_BODY_ID) {
            const bodyId = String(value || '');
            target.id = bodyId; // legacy consumer compatibility
            target.body_id = bodyId;
          }
          else if (fieldId === FIELD_PLANET_NAME) target.name = String(value || '');
          else if (fieldId === FIELD_PLANET_CLASS) target.planet_class = String(value || 'rocky');
          else if (fieldId === FIELD_PLANET_OWNER) target.owner = String(value || '');
          else if (fieldId === FIELD_PLANET_IN_HZ) target.in_habitable_zone = !!value;
          else if (fieldId === FIELD_PLANET_SMA) {
            const sma = type === TYPE_DELTA_F32 ? (prevSma + Number(value || 0)) : Number(value || 0);
            target.semi_major_axis_au = sma;
            prevSma = sma;
          }
          else if (fieldId === FIELD_PLANET_DIAMETER) {
            const diam = type === TYPE_DELTA_I32 ? (prevDiameter + Number(value || 0)) : Number(value || 0);
            target.diameter_km = diam;
            prevDiameter = diam;
          }
          else if (fieldId === FIELD_PLANET_ORB_PERIOD) target.orbital_period_days = Number(value || 0);
          else if (fieldId === FIELD_PLANET_SURF_GRAV) target.surface_gravity_g = Number(value || 0);

          continue;
        }

        if (section === SECTION_FLEETS) {
          if (fieldId === FIELD_FLEET_MISSION) {
            currentFleet = { mission: String(value || 'transport'), vessels: {} };
            out.fleets_in_system.push(currentFleet);
            pendingVesselType = '';
            continue;
          }
          if (!currentFleet) continue;

          if (fieldId === FIELD_FLEET_ORIGIN) currentFleet.origin_position = Number(value || 0);
          else if (fieldId === FIELD_FLEET_TARGET) currentFleet.target_position = Number(value || 0);
          else if (fieldId === FIELD_FLEET_VESSEL_TYPE) pendingVesselType = String(value || '');
          else if (fieldId === FIELD_FLEET_VESSEL_COUNT && pendingVesselType) {
            currentFleet.vessels[pendingVesselType] = Number(value || 0);
            pendingVesselType = '';
          }
        }
      }

      if (!out.star_system.planet_count) {
        out.star_system.planet_count = out.planets.length;
      }

      return out;
    } catch (err) {
      console.error('[GQ-V3] Decode failed:', err);
      return null;
    }
  }

  return { decode };
})();
