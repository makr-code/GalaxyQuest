<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class CacheDiagnosticsReadSideEffectsTest extends TestCase
{
    public function testCacheDiagnosticsReadsAreGetOnlyAndDoNotMutateCacheState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/cache_diagnostics.php');
        self::assertIsString($source);

        foreach ([
            ['summary', 'scope_detail'],
            ['scope_detail', 'invalidation_hooks'],
            ['invalidation_hooks', 'system_info'],
            ['system_info', 'clear_scope'],
        ] as [$action, $nextAction]) {
            $readAction = $this->caseBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $readAction, $action);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:gq_cache_flush|gq_metrics_flush|gq_metrics_record_hit)\\s*\\(/',
                $readAction,
                $action
            );
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:file_put_contents|unlink|rename|mkdir|apcu_store|apcu_delete)\\s*\\(/',
                $readAction,
                $action
            );
        }

        foreach ([
            ['clear_scope', 'clear_all'],
            ['clear_all', 'reset_metrics'],
            ['reset_metrics', null],
        ] as [$action, $nextAction]) {
            $mutation = $this->caseBody($source, $action, $nextAction);
            self::assertMatchesRegularExpression(
                "/case '" . preg_quote($action, '/') . "':\\s*only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
                $mutation,
                $action
            );
        }

        foreach ([
            'output_cache_summary',
            'output_scope_detail',
            'output_invalidation_hooks',
            'output_system_info',
            'disk_usage_mb',
        ] as $function) {
            $body = $this->functionBody($source, $function);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:gq_cache_flush|gq_metrics_flush|gq_metrics_record_hit)\\s*\\(/',
                $body,
                $function
            );
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:file_put_contents|unlink|rename|mkdir|apcu_store|apcu_delete)\\s*\\(/',
                $body,
                $function
            );
        }
    }

    public function testAdminCheckPropagatesDatabaseErrorsInsteadOfTreatingThemAsForbidden(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/cache_diagnostics.php');
        self::assertIsString($source);

        $adminCheck = $this->functionBody($source, 'check_user_is_admin');
        self::assertStringContainsString('->execute([$uid]);', $adminCheck);
        self::assertStringNotContainsString('catch (', $adminCheck);
        self::assertStringNotContainsString('return false;', $adminCheck);
    }

    private function caseBody(string $source, string $action, ?string $nextAction): string
    {
        $start = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = $nextAction === null
            ? strpos($source, 'default:', $start + 1)
            : strpos($source, "case '" . $nextAction . "':", $start + 1);
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
