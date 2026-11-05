<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GlossaryGenerationMethodContractTest extends TestCase
{
    public function testRagGenerationRequiresPostAndCsrfWhileStaticDefinitionIsGetOnly(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/glossary.php');
        self::assertIsString($source);

        $generateGuard = strpos($source, 'if ($action === \'generate\')');
        $elseBranch = strpos($source, '} else {', $generateGuard);
        $postGuard = strpos($source, "only_method('POST');", $generateGuard);
        $csrfGuard = strpos($source, 'verify_csrf();', $generateGuard);
        $getGuard = strpos($source, "only_method('GET');", $elseBranch);
        $generationCall = strpos($source, 'generate_rag_definition($db, $term_key);');

        self::assertNotFalse($generateGuard);
        self::assertNotFalse($elseBranch);
        self::assertNotFalse($postGuard);
        self::assertNotFalse($csrfGuard);
        self::assertNotFalse($getGuard);
        self::assertNotFalse($generationCall);
        self::assertLessThan($csrfGuard, $postGuard);
        self::assertLessThan($generationCall, $csrfGuard);
        self::assertLessThan($getGuard, $postGuard);
        self::assertStringContainsString('$body[\'term\']', $source);
    }

    public function testRagGenerationLogsExceptionsWithoutReturningTheirDetails(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/glossary.php');
        self::assertIsString($source);

        self::assertStringContainsString("error_log('Glossary RAG error: ' . \$e->getMessage());", $source);
        self::assertStringContainsString("json_error('Glossary generation failed', 500);", $source);
        self::assertStringNotContainsString("json_error('Internal error: ' . \$e->getMessage(), 500);", $source);
    }
}
