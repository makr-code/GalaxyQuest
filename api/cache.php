<?php
/**
 * GalaxyQuest – Chunk Cache
 *
 * Zwei-Tier-Cache (APCu → Datei-Fallback) für bereits serialisierte,
 * komprimierte Binary-Payloads (Binary-V3, JSON-Strings, gzip-Bytes, …).
 * Der Cache speichert und liefert die rohen Bytes direkt – kein doppeltes
 * Encode/Decode im Hot-Path.
 *
 * ── Dateiformat (binär) ─────────────────────────────────────────────────────
 *   Byte  0– 3  : Magic  "GQC\x01"  (4 Byte)
 *   Byte  4–35  : CACHE_VERSION, null-padded auf 32 Byte
 *   Byte 36–43  : Expires-Timestamp als uint64 LE (0 = kein Ablauf)
 *   Byte 44+    : Roher Payload (Binary / JSON / gzip-komprimiert)
 *
 * ── Verifikationsmaßstab ────────────────────────────────────────────────────
 * CACHE_VERSION (config/config.php) ist in Bytes 4–35 jeder Cache-Datei
 * gespeichert. Ein Increment verwaist alle bestehenden Einträge sofort –
 * kein manuelles Flush nötig. Verwaiste Einträge werden lazy beim nächsten
 * Lese-Zugriff gelöscht.
 *
 * ── Primäre API (Raw-Bytes) ──────────────────────────────────────────────────
 *   $bytes = gq_cache_get_raw('stars', $params);          // ?string
 *   if ($bytes === null) {
 *       $bytes = build_binary_payload(...);
 *       gq_cache_set_raw('stars', $params, $bytes, CACHE_TTL_STARS);
 *   }
 *   // Bytes direkt ausgeben:
 *   header('Content-Type: application/octet-stream');
 *   echo $bytes;
 *
 * ── Sekundäre API (PHP-Arrays, automatisch JSON-serialisiert) ────────────────
 *   $arr = gq_cache_get('factions', $params);
 *   gq_cache_set('factions', $params, $arr, CACHE_TTL_FACTIONS);
 *
 * ── Sicherheit ───────────────────────────────────────────────────────────────
 * Cache-Dateien liegen außerhalb des Web-Roots (sys_get_temp_dir / CACHE_DIR).
 * Benutzerspezifische Daten (Fog-of-War, Spieler-Session) NICHT cachen.
 */

if (!defined('CACHE_VERSION')) {
    require_once __DIR__ . '/../config/config.php';
}

// ── Binäres Dateiformat ──────────────────────────────────────────────────────
// Offset  0–  3 : Magic "GQC\x01" (4 Byte)
// Offset  4– 35 : CACHE_VERSION, null-padded auf 32 Byte
// Offset 36– 43 : Expires als uint64 little-endian (0 = kein Ablauf)
// Offset 44+    : Roher Payload
define('_GQ_CACHE_MAGIC',    "GQC\x01");
define('_GQ_CACHE_HDR_SIZE', 44);  // 4 + 32 + 8

// ── Interne Hilfsfunktionen ──────────────────────────────────────────────────

/**
 * Deterministischer Cache-Schlüssel.
 * Format: "{scope}_{sha256(CACHE_VERSION:json(params))}"
 * @internal
 */
function _gq_cache_key(string $scope, array $params): string
{
    $digest = hash('sha256', CACHE_VERSION . ':' . json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    return preg_replace('/[^a-z0-9_]/i', '_', $scope) . '_' . $digest;
}

/** @internal */
function _gq_cache_file(string $key): string
{
    return rtrim(CACHE_DIR, '/\\') . DIRECTORY_SEPARATOR . $key . '.cache';
}

/** @internal */
function _gq_cache_index_file(string $scope): string
{
    $safe = preg_replace('/[^a-z0-9_]/i', '_', $scope);
    return rtrim(CACHE_DIR, '/\\') . DIRECTORY_SEPARATOR . $safe . '__index.json';
}

/** @internal */
function _gq_cache_init_dir(): void
{
    static $done = false;
    if ($done) return;
    $dir = rtrim(CACHE_DIR, '/\\');
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        error_log('[GQ Cache] Konnte Verzeichnis nicht anlegen: ' . $dir);
    }
    $done = true;
}

/**
 * @internal
 * @return array<int,array<string,mixed>>
 */
function _gq_cache_index_load(string $scope): array
{
    $file = _gq_cache_index_file($scope);
    if (!is_file($file)) return [];
    $raw = @file_get_contents($file);
    if (!is_string($raw) || $raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/** @internal */
function _gq_cache_index_save(string $scope, array $rows): void
{
    _gq_cache_init_dir();
    $file = _gq_cache_index_file($scope);
    $tmp = $file . '.tmp.' . getmypid();
    $json = json_encode(array_values($rows), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) return;
    if (file_put_contents($tmp, $json, LOCK_EX) !== false) {
        @rename($tmp, $file);
    } else {
        @unlink($tmp);
    }
}

/** @internal */
function _gq_cache_index_prune(string $scope): void
{
    $now = time();
    $rows = _gq_cache_index_load($scope);
    if (!$rows) return;
    $changed = false;
    $out = [];
    foreach ($rows as $row) {
        $key = (string)($row['key'] ?? '');
        $expires = (int)($row['expires'] ?? 0);
        if ($key === '') {
            $changed = true;
            continue;
        }
        if ($expires > 0 && $expires < $now) {
            $changed = true;
            continue;
        }
        if (!is_file(_gq_cache_file($key))) {
            $changed = true;
            continue;
        }
        $out[] = $row;
    }
    if ($changed) {
        _gq_cache_index_save($scope, $out);
    }
}

/** @internal */
function _gq_cache_index_upsert(string $scope, string $key, array $params, int $expires, array $meta = []): void
{
    $rows = _gq_cache_index_load($scope);
    $now = time();
    $found = false;
    foreach ($rows as &$row) {
        if ((string)($row['key'] ?? '') !== $key) continue;
        $row['params'] = $params;
        $row['meta'] = $meta;
        $row['expires'] = $expires;
        $row['updated_at'] = $now;
        $found = true;
        break;
    }
    unset($row);
    if (!$found) {
        $rows[] = [
            'scope' => $scope,
            'key' => $key,
            'params' => $params,
            'meta' => $meta,
            'expires' => $expires,
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }
    _gq_cache_index_save($scope, $rows);
}

/** @internal */
function _gq_cache_index_remove_key(string $scope, string $key): void
{
    $rows = _gq_cache_index_load($scope);
    if (!$rows) return;
    $out = [];
    $changed = false;
    foreach ($rows as $row) {
        if ((string)($row['key'] ?? '') === $key) {
            $changed = true;
            continue;
        }
        $out[] = $row;
    }
    if ($changed) _gq_cache_index_save($scope, $out);
}

/**
 * Baut den binären 44-Byte-Header.
 * @internal
 */
function _gq_cache_build_header(int $expires): string
{
    $ver = str_pad(substr((string) CACHE_VERSION, 0, 32), 32, "\x00");
    // uint64 LE: zwei uint32 LE (hi=0 für Timestamps bis 2106)
    $lo = $expires & 0xFFFFFFFF;
    $hi = ($expires >> 32) & 0xFFFFFFFF;
    return _GQ_CACHE_MAGIC . $ver . pack('VV', $lo, $hi);
}

/**
 * Parst und validiert einen binären Cache-Header.
 * Gibt null zurück bei Magic-Mismatch, Versions-Mismatch oder Ablauf.
 * @internal
 * @return array{payload: string}|null
 */
function _gq_cache_parse(string $raw, int $now): ?array
{
    if (strlen($raw) < _GQ_CACHE_HDR_SIZE) {
        return null;
    }
    if (substr($raw, 0, 4) !== _GQ_CACHE_MAGIC) {
        return null;
    }
    // Verifikationsmaßstab: gespeicherte Version muss mit CACHE_VERSION übereinstimmen
    $storedVer = rtrim(substr($raw, 4, 32), "\x00");
    if ($storedVer !== (string) CACHE_VERSION) {
        return null;
    }
    $parts   = unpack('Vlo/Vhi', substr($raw, 36, 8));
    $expires = (int) $parts['lo'] | ((int) $parts['hi'] << 32);
    if ($expires > 0 && $expires < $now) {
        return null;  // Abgelaufen
    }
    return ['payload' => substr($raw, _GQ_CACHE_HDR_SIZE)];
}

// ── Primäre API: Raw-Bytes ───────────────────────────────────────────────────

/**
 * Liest rohe serialisierte Bytes aus dem Cache.
 * Gibt null zurück bei Miss, abgelaufenem Eintrag oder deaktiviertem Cache.
 *
 * @param  string $scope   Logische Gruppe, z. B. 'stars', 'system_payload'
 * @param  array  $params  Eindeutige Parameter (werden zu Schlüssel gehasht)
 * @return string|null     Roher Payload (Binary / JSON-String / gzip-Bytes)
 */
function gq_cache_get_raw(string $scope, array $params): ?string
{
    if (!CACHE_ENABLED) return null;

    $key = _gq_cache_key($scope, $params);
    $now = time();

    // ── Tier 1: APCu ─────────────────────────────────────────────────────────
    if (function_exists('apcu_fetch')) {
        $success = false;
        $hit     = apcu_fetch('gq:' . $key, $success);
        if ($success && is_string($hit)) {
            return $hit;
        }
    }

    // ── Tier 2: Datei-Cache ───────────────────────────────────────────────────
    $file = _gq_cache_file($key);
    if (!is_file($file)) return null;

    $raw = @file_get_contents($file);
    if ($raw === false) return null;

    $parsed = _gq_cache_parse($raw, $now);
    if ($parsed === null) {
        @unlink($file);  // Lazy-Prune: veraltet oder abgelaufen
        _gq_cache_index_remove_key($scope, $key);
        return null;
    }

    $payload = $parsed['payload'];

    // APCu aufwärmen – verbleibende TTL aus Expires berechnen
    if (function_exists('apcu_store')) {
        $parts   = unpack('Vlo/Vhi', substr($raw, 36, 8));
        $expires = (int) $parts['lo'] | ((int) $parts['hi'] << 32);
        $remaining = $expires > 0 ? max(1, $expires - $now) : 0;
        apcu_store('gq:' . $key, $payload, $remaining);
    }

    return $payload;
}

/**
 * Speichert rohe serialisierte Bytes im Cache.
 *
 * @param string $scope
 * @param array  $params
 * @param string $bytes  Bereits serialisierter / komprimierter Payload
 * @param int    $ttl    Time-to-live in Sekunden; 0 = kein Ablauf
 */
function gq_cache_set_raw(string $scope, array $params, string $bytes, int $ttl = 0): void
{
    if (!CACHE_ENABLED) return;

    $key     = _gq_cache_key($scope, $params);
    $expires = $ttl > 0 ? time() + $ttl : 0;

    // ── Tier 1: APCu ─────────────────────────────────────────────────────────
    if (function_exists('apcu_store')) {
        apcu_store('gq:' . $key, $bytes, $ttl);
    }

    // ── Tier 2: Datei-Cache ───────────────────────────────────────────────────
    _gq_cache_init_dir();

    $file = _gq_cache_file($key);
    $tmp  = $file . '.tmp.' . getmypid();

    $content = _gq_cache_build_header($expires) . $bytes;
    if (file_put_contents($tmp, $content, LOCK_EX) !== false) {
        rename($tmp, $file);
    } else {
        @unlink($tmp);
    }

    _gq_cache_index_upsert($scope, $key, $params, $expires, []);
}

/**
 * Speichert rohe serialisierte Bytes im Cache plus optionale Metadaten
 * für Chunk-/Range-Lookups.
 */
function gq_cache_set_raw_meta(string $scope, array $params, string $bytes, int $ttl = 0, array $meta = []): void
{
    if (!CACHE_ENABLED) return;

    $key     = _gq_cache_key($scope, $params);
    $expires = $ttl > 0 ? time() + $ttl : 0;

    if (function_exists('apcu_store')) {
        apcu_store('gq:' . $key, $bytes, $ttl);
    }

    _gq_cache_init_dir();
    $file = _gq_cache_file($key);
    $tmp  = $file . '.tmp.' . getmypid();
    $content = _gq_cache_build_header($expires) . $bytes;
    if (file_put_contents($tmp, $content, LOCK_EX) !== false) {
        rename($tmp, $file);
    } else {
        @unlink($tmp);
    }

    _gq_cache_index_upsert($scope, $key, $params, $expires, $meta);
}

/**
 * Liefert valide Index-Einträge eines Scopes (abgelaufene/fehlende werden gepruned).
 *
 * @return array<int,array<string,mixed>>
 */
function gq_cache_index_entries(string $scope): array
{
    if (!CACHE_ENABLED) return [];
    _gq_cache_index_prune($scope);
    return _gq_cache_index_load($scope);
}

// ── Sekundäre API: PHP-Arrays (JSON-serialisiert) ────────────────────────────

/**
 * Liest einen gecachten PHP-Wert (JSON-deserialisiert).
 * Wrapper um gq_cache_get_raw für Endpoints, die kein Binary produzieren.
 *
 * @return mixed|null
 */
function gq_cache_get(string $scope, array $params): mixed
{
    $raw = gq_cache_get_raw($scope, $params);
    if ($raw === null) return null;
    return json_decode($raw, true);
}

/**
 * Speichert einen PHP-Wert (JSON-serialisiert) im Cache.
 *
 * @param mixed $data  Muss JSON-serialisierbar sein
 * @param int   $ttl
 */
function gq_cache_set(string $scope, array $params, mixed $data, int $ttl = 0): void
{
    try {
        $bytes = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        return;
    }
    gq_cache_set_raw($scope, $params, $bytes, $ttl);
}

/**
 * Löscht einen einzelnen Cache-Eintrag.
 *
 * @param string $scope
 * @param array  $params
 */
function gq_cache_delete(string $scope, array $params): void
{
    $key = _gq_cache_key($scope, $params);

    if (function_exists('apcu_delete')) {
        apcu_delete('gq:' . $key);
    }

    $file = _gq_cache_file($key);
    if (is_file($file)) {
        @unlink($file);
    }
    _gq_cache_index_remove_key($scope, $key);
}

/**
 * Leert alle Einträge eines Scopes oder – bei $scope = null – den gesamten Cache.
 *
 * @param  string|null $scope  Scope-Name oder null für vollständiges Flush
 * @return int                 Anzahl entfernter Einträge
 */
function gq_cache_flush(?string $scope = null): int
{
    $removed = 0;

    // ── APCu ──────────────────────────────────────────────────────────────────
    if (function_exists('apcu_delete') && function_exists('apcu_cache_info')) {
        $apcuPrefix = 'gq:' . ($scope !== null
            ? preg_replace('/[^a-z0-9_]/i', '_', $scope) . '_'
            : '');
        try {
            $info = apcu_cache_info(false);
            foreach ($info['cache_list'] ?? [] as $entry) {
                $entryKey = (string) ($entry['info'] ?? $entry['key'] ?? '');
                if (str_starts_with($entryKey, $apcuPrefix)) {
                    apcu_delete($entryKey);
                    $removed++;
                }
            }
        } catch (\Throwable) {
            // APCu nicht verfügbar oder kein Zugriff
        }
    }

    // ── Datei-Cache ───────────────────────────────────────────────────────────
    $dir = rtrim(CACHE_DIR, '/\\');
    if (!is_dir($dir)) {
        return $removed;
    }

    $pattern = $scope !== null
        ? $dir . DIRECTORY_SEPARATOR . preg_replace('/[^a-z0-9_]/i', '_', $scope) . '_*.cache'
        : $dir . DIRECTORY_SEPARATOR . '*.cache';

    foreach (glob($pattern) ?: [] as $file) {
        if ($scope === null) {
            @unlink($file);
            $removed++;
        } else {
            // Binären Header lesen und Scope-Prefix im Dateinamen prüfen.
            // Da der Dateiname den Scope enthält, reicht der Glob bereits;
            // wir löschen nur Dateien mit korrektem Magic (eigene Dateien).
            $hdr = @file_get_contents($file, false, null, 0, _GQ_CACHE_HDR_SIZE);
            if ($hdr !== false && strlen($hdr) === _GQ_CACHE_HDR_SIZE
                && substr($hdr, 0, 4) === _GQ_CACHE_MAGIC) {
                @unlink($file);
                $removed++;
            }
        }
    }

    if ($scope !== null) {
        $index = _gq_cache_index_file($scope);
        if (is_file($index)) {
            @unlink($index);
        }
    } else {
        foreach (glob($dir . DIRECTORY_SEPARATOR . '*__index.json') ?: [] as $idx) {
            @unlink($idx);
        }
    }

    return $removed;
}
