<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Infrastructure\Encoders;

use GalaxyQuest\Galaxy\Infrastructure\Interfaces\SystemPayloadEncoderInterface;

/**
 * JsonSystemPayloadEncoder – JSON implementation of SystemPayloadEncoderInterface.
 *
 * Encodes system payloads as JSON for API responses.
 * Useful for debugging, web clients, and compatibility with non-binary decoders.
 */
final class JsonSystemPayloadEncoder implements SystemPayloadEncoderInterface
{
    public function encode(array $systemData)
    {
        return $systemData; // Return array; controller will json_encode
    }

    public function getMimeType(): string
    {
        return 'application/json';
    }

    public function getEncodingName(): string
    {
        return 'utf-8';
    }
}
