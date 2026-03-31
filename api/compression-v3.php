<?php
/**
 * Binary V3 encoder (delta-aware) for system payload transport.
 *
 * Goals:
 * - Keep response schema compatible with existing client expectations
 * - Reduce entropy for gzip via delta fields where beneficial
 * - Keep decoding simple and robust
 */

const V3_MAGIC = 0xDEADBEEF;
const V3_VERSION = 3;

const V3_SECTION_STARS = 50;
const V3_SECTION_PLANETS = 51;
const V3_SECTION_FLEETS = 52;
const V3_SECTION_END = 255;

const V3_FIELD_GALAXY = 1;
const V3_FIELD_SYSTEM = 2;

const V3_FIELD_STAR_NAME = 10;
const V3_FIELD_STAR_SPECTRAL = 11;
const V3_FIELD_STAR_X = 12;
const V3_FIELD_STAR_Y = 13;
const V3_FIELD_STAR_Z = 14;
const V3_FIELD_STAR_HZ_INNER = 15;
const V3_FIELD_STAR_HZ_OUTER = 16;
const V3_FIELD_STAR_PLANET_COUNT = 17;

const V3_FIELD_PLANET_POSITION = 20;
const V3_FIELD_PLANET_KIND = 21;      // 1=player, 2=generated
const V3_FIELD_PLANET_NAME = 22;
const V3_FIELD_PLANET_CLASS = 23;
const V3_FIELD_PLANET_OWNER = 24;
const V3_FIELD_BODY_ID = 25; // wire-compat: field number unchanged
const V3_FIELD_PLANET_IN_HZ = 26;
const V3_FIELD_PLANET_SMA = 27;
const V3_FIELD_PLANET_DIAMETER = 28;
const V3_FIELD_PLANET_ORB_PERIOD = 29;
const V3_FIELD_PLANET_SURF_GRAV = 30;

const V3_FIELD_FLEET_MISSION = 40;
const V3_FIELD_FLEET_ORIGIN = 41;
const V3_FIELD_FLEET_TARGET = 42;
const V3_FIELD_FLEET_VESSEL_TYPE = 43;
const V3_FIELD_FLEET_VESSEL_COUNT = 44;

const V3_TYPE_NULL = 0;
const V3_TYPE_BOOL = 1;
const V3_TYPE_U8 = 2;
const V3_TYPE_U16 = 3;
const V3_TYPE_I32 = 4;
const V3_TYPE_F32 = 5;
const V3_TYPE_STRING = 6;
const V3_TYPE_POOL_REF = 7;
const V3_TYPE_DELTA_I32 = 8;
const V3_TYPE_DELTA_F32 = 9;
const V3_TYPE_ZIGZAG_I32 = 11;

function v3_zigzag_encode(int $n): int
{
    return (($n << 1) ^ ($n >> 31)) & 0xFFFFFFFF;
}

function v3_float_to_u32(float $value): int
{
    $packed = pack('f', $value);
    $bytes = unpack('C4', $packed);
    return ((($bytes[4] << 24) | ($bytes[3] << 16) | ($bytes[2] << 8) | $bytes[1]) & 0xFFFFFFFF);
}

final class V3StringPool
{
    /** @var array<string,int> */
    private array $indexByString = [];

    /** @var array<int,string> */
    private array $strings = [];

    public function add(string $value): int
    {
        if (!array_key_exists($value, $this->indexByString)) {
            $idx = count($this->strings);
            $this->indexByString[$value] = $idx;
            $this->strings[] = $value;
        }
        return $this->indexByString[$value];
    }

    public function indexOf(string $value): int
    {
        return $this->add($value);
    }

    /** @return array<int,string> */
    public function values(): array
    {
        return $this->strings;
    }
}

final class V3Writer
{
    private string $buf = '';

    public function u8(int $value): void
    {
        $this->buf .= chr($value & 0xFF);
    }

    public function u16(int $value): void
    {
        $this->buf .= pack('n', $value & 0xFFFF);
    }

    public function u32(int $value): void
    {
        $this->buf .= pack('N', $value & 0xFFFFFFFF);
    }

    public function i32(int $value): void
    {
        $this->u32($value);
    }

    public function f32(float $value): void
    {
        $this->u32(v3_float_to_u32($value));
    }

    public function str(string $value): void
    {
        $bytes = substr($value, 0, 65535);
        $this->u16(strlen($bytes));
        $this->buf .= $bytes;
    }

    public function field(int $id, int $type): void
    {
        $this->u8($id);
        $this->u8($type);
    }

    public function raw(string $value): void
    {
        $this->buf .= $value;
    }

    public function toString(): string
    {
        return $this->buf;
    }
}

/**
 * @param mixed $node
 */
function v3_collect_strings(V3StringPool $pool, $node): void
{
    if (is_string($node)) {
        if ($node !== '') {
            $pool->add($node);
        }
        return;
    }

    if (!is_array($node)) {
        return;
    }

    foreach ($node as $v) {
        v3_collect_strings($pool, $v);
    }
}

function v3_write_pool(V3Writer $w, V3StringPool $pool): void
{
    $values = $pool->values();
    $w->u16(count($values));
    foreach ($values as $s) {
        $w->str($s);
    }
}

function v3_write_pool_ref(V3Writer $w, V3StringPool $pool, int $fieldId, string $value): void
{
    $w->field($fieldId, V3_TYPE_POOL_REF);
    $w->u16($pool->indexOf($value));
}

function encode_system_payload_binary_v3(array $payload): string
{
    $pool = new V3StringPool();
    v3_collect_strings($pool, $payload);

    $w = new V3Writer();
    $w->u32(V3_MAGIC);
    $w->u16(V3_VERSION);
    v3_write_pool($w, $pool);

    $w->field(V3_FIELD_GALAXY, V3_TYPE_U16);
    $w->u16((int)($payload['galaxy'] ?? 0));
    $w->field(V3_FIELD_SYSTEM, V3_TYPE_U16);
    $w->u16((int)($payload['system'] ?? 0));

    $star = is_array($payload['star_system'] ?? null) ? $payload['star_system'] : [];
    $w->u8(V3_SECTION_STARS);
    v3_write_pool_ref($w, $pool, V3_FIELD_STAR_NAME, (string)($star['name'] ?? 'Unknown'));
    v3_write_pool_ref($w, $pool, V3_FIELD_STAR_SPECTRAL, (string)($star['spectral_class'] ?? 'G'));

    $w->field(V3_FIELD_STAR_X, V3_TYPE_I32);
    $w->i32((int)($star['x_ly'] ?? 0));
    $w->field(V3_FIELD_STAR_Y, V3_TYPE_I32);
    $w->i32((int)($star['y_ly'] ?? 0));
    $w->field(V3_FIELD_STAR_Z, V3_TYPE_I32);
    $w->i32((int)($star['z_ly'] ?? 0));

    $w->field(V3_FIELD_STAR_HZ_INNER, V3_TYPE_F32);
    $w->f32((float)($star['hz_inner_au'] ?? 0.95));
    $w->field(V3_FIELD_STAR_HZ_OUTER, V3_TYPE_F32);
    $w->f32((float)($star['hz_outer_au'] ?? 1.37));
    $w->field(V3_FIELD_STAR_PLANET_COUNT, V3_TYPE_U8);
    $w->u8((int)($star['planet_count'] ?? 0));

    $planets = is_array($payload['planets'] ?? null) ? $payload['planets'] : [];
    $w->u8(V3_SECTION_PLANETS);
    $prevSma = 0.0;
    $prevDiameter = 0;

    foreach ($planets as $slot) {
        if (!is_array($slot)) {
            continue;
        }

        $position = (int)($slot['position'] ?? 0);
        $w->field(V3_FIELD_PLANET_POSITION, V3_TYPE_U8);
        $w->u8($position);

        $player = is_array($slot['player_planet'] ?? null) ? $slot['player_planet'] : null;
        if ($player) {
            $w->field(V3_FIELD_PLANET_KIND, V3_TYPE_U8);
            $w->u8(1);
            v3_write_pool_ref($w, $pool, V3_FIELD_BODY_ID, (string)($player['id'] ?? ''));
            v3_write_pool_ref($w, $pool, V3_FIELD_PLANET_NAME, (string)($player['name'] ?? ''));
            v3_write_pool_ref($w, $pool, V3_FIELD_PLANET_OWNER, (string)($player['owner'] ?? ''));
            v3_write_pool_ref($w, $pool, V3_FIELD_PLANET_CLASS, (string)($player['planet_class'] ?? 'rocky'));
            $w->field(V3_FIELD_PLANET_IN_HZ, V3_TYPE_BOOL);
            $w->u8(!empty($player['in_habitable_zone']) ? 1 : 0);

            $sma = (float)($player['semi_major_axis_au'] ?? 0.0);
            $w->field(V3_FIELD_PLANET_SMA, V3_TYPE_DELTA_F32);
            $w->f32($sma - $prevSma);
            $prevSma = $sma;
        }

        $generated = is_array($slot['generated_planet'] ?? null) ? $slot['generated_planet'] : null;
        if ($generated) {
            $w->field(V3_FIELD_PLANET_KIND, V3_TYPE_U8);
            $w->u8(2);
            v3_write_pool_ref($w, $pool, V3_FIELD_PLANET_NAME, (string)($generated['name'] ?? ''));
            v3_write_pool_ref($w, $pool, V3_FIELD_PLANET_CLASS, (string)($generated['planet_class'] ?? 'rocky'));
            $w->field(V3_FIELD_PLANET_IN_HZ, V3_TYPE_BOOL);
            $w->u8(!empty($generated['in_habitable_zone']) ? 1 : 0);

            $sma = (float)($generated['semi_major_axis_au'] ?? 0.0);
            $w->field(V3_FIELD_PLANET_SMA, V3_TYPE_DELTA_F32);
            $w->f32($sma - $prevSma);
            $prevSma = $sma;

            $diameter = (int)($generated['diameter_km'] ?? 0);
            $w->field(V3_FIELD_PLANET_DIAMETER, V3_TYPE_DELTA_I32);
            $w->i32($diameter - $prevDiameter);
            $prevDiameter = $diameter;

            $w->field(V3_FIELD_PLANET_ORB_PERIOD, V3_TYPE_F32);
            $w->f32((float)($generated['orbital_period_days'] ?? 0.0));
            $w->field(V3_FIELD_PLANET_SURF_GRAV, V3_TYPE_F32);
            $w->f32((float)($generated['surface_gravity_g'] ?? 0.0));
        }
    }

    $fleets = is_array($payload['fleets_in_system'] ?? null) ? $payload['fleets_in_system'] : [];
    $w->u8(V3_SECTION_FLEETS);
    foreach ($fleets as $fleet) {
        if (!is_array($fleet)) {
            continue;
        }

        v3_write_pool_ref($w, $pool, V3_FIELD_FLEET_MISSION, (string)($fleet['mission'] ?? 'transport'));

        $origin = (int)($fleet['origin_position'] ?? 0);
        $target = (int)($fleet['target_position'] ?? 0);
        $w->field(V3_FIELD_FLEET_ORIGIN, V3_TYPE_ZIGZAG_I32);
        $w->u32(v3_zigzag_encode($origin));
        $w->field(V3_FIELD_FLEET_TARGET, V3_TYPE_ZIGZAG_I32);
        $w->u32(v3_zigzag_encode($target));

        $vessels = is_array($fleet['vessels'] ?? null) ? $fleet['vessels'] : [];
        foreach ($vessels as $type => $count) {
            v3_write_pool_ref($w, $pool, V3_FIELD_FLEET_VESSEL_TYPE, (string)$type);
            $w->field(V3_FIELD_FLEET_VESSEL_COUNT, V3_TYPE_ZIGZAG_I32);
            $w->u32(v3_zigzag_encode((int)$count));
        }
    }

    $w->u8(V3_SECTION_END);
    return $w->toString();
}
