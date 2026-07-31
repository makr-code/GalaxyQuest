<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Application;

use GalaxyQuest\Galaxy\Domain\Interfaces\GalaxyRepositoryInterface;
use GalaxyQuest\Galaxy\Infrastructure\Interfaces\SystemPayloadEncoderInterface;

/**
 * GetSystemPayloadService – application service for fetching a single system's detailed payload.
 *
 * Orchestrates:
 * - Coordinate validation
 * - Repository lookup
 * - Payload encoding
 * - Error handling
 *
 * Used by Presentation layer to handle system detail requests.
 */
final class GetSystemPayloadService
{
    public function __construct(
        private GalaxyRepositoryInterface $galaxyRepository,
        private SystemPayloadEncoderInterface $encoder,
    ) {
    }

    /**
     * Execute the service.
     *
     * @param int $x X coordinate
     * @param int $y Y coordinate
     * @return GetSystemPayloadResult
     *
     * @throws \DomainException if system not found
     */
    public function execute(int $x, int $y): GetSystemPayloadResult
    {
        $systemData = $this->galaxyRepository->getSystemByCoordinates($x, $y);

        $encoded = $this->encoder->encode($systemData);

        return new GetSystemPayloadResult(
            rawData: $systemData,
            encoded: $encoded,
            mimeType: $this->encoder->getMimeType(),
            encodingName: $this->encoder->getEncodingName(),
        );
    }
}

/**
 * GetSystemPayloadResult – result DTO for GetSystemPayloadService.
 */
final class GetSystemPayloadResult
{
    /**
     * @param array<string, mixed> $rawData Raw system data
     * @param string|array<string, mixed> $encoded Encoded payload (format depends on encoder)
     * @param string $mimeType MIME type of encoded data
     * @param string $encodingName Encoding name (e.g., 'binary', 'utf-8')
     */
    public function __construct(
        public readonly array $rawData,
        public readonly string|array $encoded,
        public readonly string $mimeType,
        public readonly string $encodingName,
    ) {
    }

    /**
     * Export as associative array for JSON response.
     *
     * Only includes raw data; encoded binary is handled separately by controller.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'system' => $this->rawData,
            'encoding' => $this->encodingName,
        ];
    }

    /**
     * Get the encoded payload (for sending as response body).
     *
     * @return string|array<string, mixed>
     */
    public function getEncoded()
    {
        return $this->encoded;
    }

    /**
     * Get MIME type for Content-Type header.
     *
     * @return string
     */
    public function getMimeType(): string
    {
        return $this->mimeType;
    }
}
