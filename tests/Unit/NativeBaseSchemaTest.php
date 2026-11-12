<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Deployment\NativeBaseSchema;

require_once __DIR__ . '/../../lib/MigrationRunner.php';
require_once __DIR__ . '/../../lib/NativeBaseSchema.php';

final class NativeBaseSchemaTest extends TestCase
{
    private function runner(): MigrationRunner
    {
        return new MigrationRunner(new PDO('sqlite::memory:'), __DIR__ . '/../../sql', 'TEST');
    }

    public function testReviewedSchemaExcludesOnlyTheDatabasePreamble(): void
    {
        $source = file_get_contents(__DIR__ . '/../../sql/schema.sql');
        self::assertIsString($source);
        $runner = $this->runner();
        $all = $runner->splitStatements(str_replace("\r\n", "\n", $source));
        $expected = array_slice($all, 2);
        self::assertNotEmpty($expected);
        self::assertSame($expected, NativeBaseSchema::statements($runner, $source));
        self::assertSame($expected, NativeBaseSchema::statements($runner, str_replace("\n", "\r\n", str_replace("\r\n", "\n", $source))));
    }

    public function testChangedSchemaFailsClosed(): void
    {
        $source = file_get_contents(__DIR__ . '/../../sql/schema.sql');
        self::assertIsString($source);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('differs from the reviewed native import contract');
        NativeBaseSchema::statements($this->runner(), $source . "\nUSE unrelated_database;\n");
    }
}
