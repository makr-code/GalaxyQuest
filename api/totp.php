<?php
/**
 * Minimal TOTP implementation – RFC 6238 / RFC 4226.
 * No Composer dependency required.
 *
 * Compatible with: Microsoft Authenticator, Google Authenticator, Authy, etc.
 *
 * Algorithm: HMAC-SHA1, 6 digits, 30 s window.
 * Secret:    Base32-encoded (RFC 4648), 20 bytes = 160-bit key.
 */

/**
 * Generate a new random Base32-encoded TOTP secret.
 *
 * @param int $bytes Raw entropy bytes (20 = 160 bit, recommended by RFC 4226).
 */
function totp_generate_secret(int $bytes = 20): string {
    return totp_base32_encode(random_bytes($bytes));
}

/**
 * Encode raw bytes to padded Base32 (RFC 4648, uppercase, with '=' padding).
 */
function totp_base32_encode(string $data): string {
    static $alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    $bits   = '';
    $len    = strlen($data);
    for ($i = 0; $i < $len; $i++) {
        $bits .= str_pad(decbin(ord($data[$i])), 8, '0', STR_PAD_LEFT);
    }

    $output = '';
    foreach (str_split($bits, 5) as $chunk) {
        $output .= $alpha[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
    }

    // Pad to multiple of 8
    $pad = (8 - (strlen($output) % 8)) % 8;
    return $output . str_repeat('=', $pad);
}

/**
 * Decode a padded or unpadded Base32 string to raw bytes.
 */
function totp_base32_decode(string $data): string {
    static $alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    $data = strtoupper(rtrim($data, '='));
    $bits = '';
    $dlen = strlen($data);
    for ($i = 0; $i < $dlen; $i++) {
        $pos = strpos($alpha, $data[$i]);
        if ($pos === false) {
            continue; // ignore invalid chars
        }
        $bits .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
    }

    $output = '';
    foreach (str_split($bits, 8) as $chunk) {
        if (strlen($chunk) < 8) {
            break;
        }
        $output .= chr(bindec($chunk));
    }
    return $output;
}

/**
 * Calculate a single HOTP value (RFC 4226).
 *
 * @param string $secret_b32 Base32-encoded shared secret.
 * @param int    $counter    8-byte big-endian counter value.
 */
function totp_hotp(string $secret_b32, int $counter): int {
    $key          = totp_base32_decode($secret_b32);
    $counter_bin  = pack('J', $counter); // 8-byte big-endian (requires PHP 5.6.3+)
    $hmac         = hash_hmac('sha1', $counter_bin, $key, true);

    // Dynamic truncation (RFC 4226 §5.4)
    $offset = ord($hmac[19]) & 0x0F;
    $code   = (
          ((ord($hmac[$offset])     & 0x7F) << 24)
        | ((ord($hmac[$offset + 1]) & 0xFF) << 16)
        | ((ord($hmac[$offset + 2]) & 0xFF) << 8)
        |  (ord($hmac[$offset + 3]) & 0xFF)
    ) % 1_000_000;

    return $code;
}

/**
 * Verify a 6-digit TOTP code.
 *
 * Allows ±$window time steps (30 s each) to tolerate clock skew.
 * Default window=1 permits one step in each direction (±30 s).
 *
 * @param string $secret_b32 Active Base32 secret.
 * @param string $code       6-digit string from user.
 * @param int    $window     Allowed drift in 30-second steps.
 */
function totp_verify(string $secret_b32, string $code, int $window = 1): bool {
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) {
        return false;
    }

    $t = (int) floor(time() / 30);
    for ($i = -$window; $i <= $window; $i++) {
        $expected = str_pad((string) totp_hotp($secret_b32, $t + $i), 6, '0', STR_PAD_LEFT);
        if (hash_equals($expected, $code)) {
            return true;
        }
    }
    return false;
}

/**
 * Build the otpauth:// URI for QR-code generation.
 *
 * Scan this with Microsoft Authenticator / Google Authenticator / Authy.
 *
 * @param string $secret_b32 Base32 secret (without padding, as most apps prefer).
 * @param string $account    Display label (usually the username).
 * @param string $issuer     App / service name shown in the authenticator.
 */
function totp_uri(string $secret_b32, string $account, string $issuer = 'GalaxyQuest'): string {
    // strip padding – most authenticator apps accept unpadded secrets
    $secret = rtrim($secret_b32, '=');

    return sprintf(
        'otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30',
        rawurlencode($issuer),
        rawurlencode($account),
        $secret,
        rawurlencode($issuer)
    );
}
