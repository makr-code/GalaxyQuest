# Binary Encoding V1 vs V2 Comparison

## Overview

| Aspekt | V1 (Static) | V2 (Dynamic) |
|--------|-----------|-----------|
| **Byte-Order** | Fixed positions | Self-describing fields |
| **String Handling** | Every string inline | Deduplicated pool |
| **New Fields** | Format break | Backward compatible |
| **Flexibility** | Low | High |
| **Size** | ~1 KB | ~600-800 B |
| **Complexity** | Simple | Medium |

---

## V1: Static Binary Format

**Structure**: Fixed byte offsets, enum-based compression.

```
Bytes 0-3:   Magic (0xDEADBEEF)
Bytes 4-5:   Version (0x0001)
Bytes 6-7:   Galaxy (u16)
Bytes 8-9:   System (u16)
Bytes 10-N:  Star data (fixed offsets for name, spectral, coords)
Bytes N-M:   Planets (each 50-200 bytes, fixed layout)
Bytes M-K:   Fleets (each 20-100 bytes, fixed layout)
```

**Pros**:
- Fast decode (know exact offsets)
- Small spec (no schema needed)
- Works offline (no metadata)

**Cons**:
- Adding a field = new version
- Wastes storage on repeated values ("terrestrial" appears 5x)
- Rigid structure

---

## V2: Dynamic Field-Based Format

**Structure**: Self-describing with string pool and field tags.

```
Bytes 0-3:   Magic (0xDEADBEEF)
Bytes 4-5:   Version (0x0002)
Byte 6:      Pool metadata size
Byte 7:      Pool entry count
Bytes 8-N:   [StringPool: count, len1, str1, len2, str2, ...]
Bytes N-M:   [Fields: FieldID, Type, Value, ...]
             [FieldID, Type, Value, ...]
             ...
Byte K:      SECTION_END (255)
```

**Field Structure** (1-7 bytes each):
```
[1] FieldID    (identifies what this value is)
[1] Type       (BOOL, U8, U16, I32, F32, STRING, POOL_REF)
[0-4] Value    (size depends on type)
```

**Example: Star Name**
- V1: `[1_byte_len][N_bytes_string]` (inline, only once)
- V2: `[FieldID=10][Type=POOL_REF][pool_index]` (3 bytes, deduplicated)

**String Pool Example**:
```
Pool Entry 0: "terrestrial"
Pool Entry 1: "transport"
Pool Entry 2: "rocky"
Pool Entry 3: "Sol"

Field: PLANET_CLASS → POOL_REF → 2 (= "rocky")
Field: PLANET_CLASS → POOL_REF → 0 (= "terrestrial")
Field: PLANET_CLASS → POOL_REF → 0 (= "terrestrial")  ← Reused!
Field: FLEET_MISSION → POOL_REF → 1 (= "transport")
```

**Pros**:
- Add new fields without breaking older decoders
- String deduplication (20-30% savings)
- Self-documenting (field names in spec)
- Extensible (new field IDs just get ignored if unknown)

**Cons**:
- Slightly larger decoder
- Pool lookup overhead (negligible)

---

## Size Comparison

**Typical 10-Planet + 3-Fleet System**:

| Format | Encoded Size | w/ Gzip | Notes |
|--------|------------|---------|--------|
| Raw JSON | 12-15 KB | — | Baseline |
| V1 Binary | ~1.0 KB | 300-500 B | Fixed structure |
| **V2 Binary** | **~700-850 B** | **250-400 B** | **With string pool** |

**Savings Breakdown (V2 vs Raw JSON)**:
- String dedup: 20% (5-6 strings appear 2-3x each)
- Field tagging: 10% (FieldID+Type metadata)
- Value packing: 20% (u8/u16 instead of ASCII)
- **Total: ~50% smaller than V1, 95% smaller than JSON**

---

## Field Catalog

### Star System Fields (10-16)
```
10: STAR_NAME (string, 1 per payload)
11: STAR_SPECTRAL (string, enum-like: G/F/A/B/O/K/M)
12-14: STAR_X/Y/Z (i32, coordinates in light-years)
15-16: STAR_HZ_INNER/OUTER (f32, AU)
```

### Planet Fields (20-28)
```
20: PLANET_POSITION (u8, slot 0-255)
21: PLANET_NAME (string, per planet ×N)
22: PLANET_CLASS (string, enum-like, appears ×N)
23: PLANET_DIAMETER (u16, in 100-km units)
24: PLANET_IN_HZ (bool)
25: PLANET_SMA (f32, semi-major axis)
26: PLANET_ORB_PERIOD (f32, days)
27: PLANET_SURF_GRAV (f32, G)
28: PLANET_OWNER (string, player colonized only)
```

### Fleet Fields (30-34)
```
30: FLEET_MISSION (string: transport/military/exploration/colonization)
31: FLEET_ORIGIN (u8, position)
32: FLEET_TARGET (u8, position)
33: FLEET_VESSEL_TYPE (string: corvette/frigate/etc, appears ×M)
34: FLEET_VESSEL_COUNT (u16, count)
```

### Section Markers (50-52, 255)
```
50: SECTION_STARS (marks start of star block)
51: SECTION_PLANETS (marks start of planets block)
52: SECTION_FLEETS (marks start of fleets block)
255: SECTION_END (marks end of payload)
```

---

## Usage

### PHP Encoding
```php
// V1 (fixed structure)
$binary = encode_system_payload_binary($payload);

// V2 (dynamic with pooling)
$binary = encode_system_payload_binary_v2($payload);
```

### JavaScript Decoding
```javascript
// V1 decoder
const payload = BinaryDecoder.decode(buffer);

// V2 decoder
const payload = BinaryDecoderV2.decode(buffer);
```

---

## Backward Compatibility

**Migration Path**:
1. **Phase 1**: V1 live (current)
2. **Phase 2**: Server offers both (detect via version byte)
3. **Phase 3**: Client upgrades decoders to V2
4. **Phase 4**: Server deprecates V1

**Feature Parity**:
- V2 can encode all data V1 could
- Decoder auto-detects version (byte 4-5)
- Fallback to JSON if neither version supported

---

## Future Extensions (V3+)

**Possible Optimizations**:

### Delta Encoding
```
[1] DELTA_PLANET_COUNT (u8)
[4] PLANETS_SINCE_VERSION (u32, timestamp or version)
[Fields for changed planets only]
```

### Coordinate Compression
```
Instead of [i32][i32][i32] for X/Y/Z,
Use [i16] relative to star cluster center
Saves 4 bytes per star × 1M systems = 4 MB
```

### Vessel Type Interning
```
Common types (corvette, frigate, dreadnought) → u8 enums
Custom types (Zeravector_Mark_III) → pool refs
```

### Texture Manifest Compression
```
Instead of full manifest in every response,
Send [hash(manifest)] and cache server-side
Client requests full manifest only on miss
Saves 2-3 KB per response
```

---

## Recommendation

**Use V2 for**:
- Mobile clients (bandwidth-constrained)
- High-frequency updates (1000s of systems)
- Future extensibility

**Use V1 for**:
- Latency-critical endpoints
- Simplicity over savings

**Hybrid Approach** (Recommended):
- Default to V2 (`?format=bin` → V2)
- V1 as fallback for old clients
- Server serves whichever client prefers (Accept-Encoding-like negotiation)

