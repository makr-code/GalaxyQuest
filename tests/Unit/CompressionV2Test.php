<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\CompressionV2;

use PHPUnit\Framework\TestCase;

final class CompressionV2Test extends TestCase
{
    public function testEncoderWritesTheDefinedSectionEndMarker(): void
    {
        require_once __DIR__ . '/../../api/compression-v2.php';

        $binary = \encode_system_payload_binary_v2([]);

        self::assertSame(chr(\FIELD_ID_SECTION_END), substr($binary, -1));
    }

    public function testDecoderReadsGalaxyAndSystemUsingDefinedFieldIds(): void
    {
        require_once __DIR__ . '/../../api/compression-v2.php';

        $binary = pack('NnC', 0xDEADBEEF, 2, 0)
            . pack('CCn', \FIELD_ID_GALAXY, \FIELD_TYPE_U16, 12)
            . pack('CCn', \FIELD_ID_SYSTEM, \FIELD_TYPE_U16, 34)
            . pack('C', \FIELD_ID_SECTION_END);

        self::assertSame(
            ['galaxy' => 12, 'system' => 34],
            \decode_system_payload_binary_v2($binary)
        );
    }
}
