<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Infrastructure\Encoders;

use GalaxyQuest\Galaxy\Infrastructure\Interfaces\SystemPayloadEncoderInterface;

/**
 * BinarySystemPayloadEncoder – binary implementation of SystemPayloadEncoderInterface.
 *
 * Encodes system payloads as binary for optimal network performance.
 * Used for high-frequency galaxy data transfers where bandwidth matters.
 *
 * Binary format (v1):
 * [4 bytes: x coord] [4 bytes: y coord] [4 bytes: data length] [N bytes: JSON data]
 */
final class BinarySystemPayloadEncoder implements SystemPayloadEncoderInterface
{
    public function encode(array $systemData)
    {
        $json = json_encode($systemData, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $x = (int)($systemData['x'] ?? 0);
        $y = (int)($systemData['y'] ?? 0);
        $jsonLen = strlen($json);

        // Pack as binary: 4 bytes x + 4 bytes y + 4 bytes length + json
        return pack('NNN', $x, $y, $jsonLen) . $json;
    }

    public function getMimeType(): string
    {
        return 'application/octet-stream';
    }

    public function getEncodingName(): string
    {
        return 'binary';
    }
}
