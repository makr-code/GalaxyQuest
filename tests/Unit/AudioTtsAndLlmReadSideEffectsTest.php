<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class AudioTtsAndLlmReadSideEffectsTest extends TestCase
{
    public function testAudioCatalogOnlyServesGetRequestsAndDoesNotMutateFiles(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/audio.php');
        self::assertIsString($source);

        self::assertStringContainsString("only_method('GET');", $source);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_put_contents|unlink|rename|mkdir|touch)\\s*\\(/',
            $source
        );
    }

    public function testTtsStatusAndVoiceReadsAreGetOnlyAndSynthesisIsPostCsrf(): void
    {
        $api = file_get_contents(__DIR__ . '/../../api/tts.php');
        $client = file_get_contents(__DIR__ . '/../../api/tts_client.php');
        self::assertIsString($api);
        self::assertIsString($client);

        foreach ([
            ["case 'status':", "case 'voices':"],
            ["case 'voices':", "case 'synthesise':"],
        ] as [$action, $nextAction]) {
            $handler = $this->caseBody($api, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:file_put_contents|unlink|rename|mkdir|apcu_store|apcu_delete)\\s*\\(/',
                $handler
            );
        }

        $synthesis = $this->caseBody($api, "case 'synthesise':", "default:");
        self::assertMatchesRegularExpression(
            "/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $synthesis
        );

        foreach (['tts_health', 'tts_list_voices'] as $function) {
            $body = $this->functionBody($client, $function);
            self::assertStringContainsString("tts_request(", $body);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:file_put_contents|unlink|rename|mkdir)\\s*\\(/',
                $body
            );
        }
    }

    public function testLlmCatalogGetReadsProfilesWithoutMutation(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/llm.php');
        $repository = file_get_contents(__DIR__ . '/../../api/llm_soc/PromptCatalogRepository.php');
        self::assertIsString($source);
        self::assertIsString($repository);

        $catalog = $this->caseBody($source, "case 'catalog':", "case 'compose':");
        self::assertStringContainsString("only_method('GET');", $catalog);
        self::assertStringContainsString('$promptService->catalog($db)', $catalog);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
            $repository
        );
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_put_contents|unlink|rename|mkdir|touch)\\s*\\(/',
            $repository
        );
    }

    public function testOllamaStatusUsesOnlyTheReadOnlyModelCatalogRequest(): void
    {
        $api = file_get_contents(__DIR__ . '/../../api/ollama.php');
        $client = file_get_contents(__DIR__ . '/../../api/ollama_client.php');
        self::assertIsString($api);
        self::assertIsString($client);

        $status = $this->caseBody($api, "case 'status':", "case 'chat':");
        self::assertStringContainsString("only_method('GET');", $status);
        self::assertStringContainsString('ollama_list_models(', $status);
        self::assertStringNotContainsString('ollama_chat(', $status);
        self::assertStringNotContainsString('ollama_generate(', $status);

        $listModels = $this->functionBody($client, 'ollama_list_models');
        self::assertStringContainsString("ollama_request('/api/tags', null, \$options, 'GET')", $listModels);
        self::assertStringNotContainsString('ollama_chat(', $listModels);
        self::assertStringNotContainsString('ollama_generate(', $listModels);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_put_contents|unlink|rename|mkdir|INSERT|UPDATE|DELETE|REPLACE)\\b/',
            $status . $listModels
        );
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $start = strpos($source, $action);
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = strpos($source, $nextAction, $start + strlen($action));
        self::assertNotFalse($end, $action . ' action must have a bounded body.');
        return substr($source, $start, $end - $start);
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
