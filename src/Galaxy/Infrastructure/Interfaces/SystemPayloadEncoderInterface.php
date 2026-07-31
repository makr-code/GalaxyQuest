<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Infrastructure\Interfaces;

/**
 * SystemPayloadEncoderInterface – contract for encoding system data to various formats.
 *
 * Abstracts the encoding logic for system payloads (binary, JSON, etc.).
 * Allows switching between binary for performance and JSON for debugging/compatibility.
 *
 * Used by application services to format responses without coupling to encoding specifics.
 */
interface SystemPayloadEncoderInterface
{
    /**
     * Encode system data to output format.
     *
     * @param array<string, mixed> $systemData Raw system data
     * @return string|array<string, mixed> Encoded data (string for binary, array for JSON)
     */
    public function encode(array $systemData);

    /**
     * Get MIME type of encoded format.
     *
     * @return string MIME type (e.g., 'application/json', 'application/octet-stream')
     */
    public function getMimeType(): string;

    /**
     * Get content encoding name for HTTP headers.
     *
     * @return string Encoding name (e.g., 'binary', 'utf-8')
     */
    public function getEncodingName(): string;
}
