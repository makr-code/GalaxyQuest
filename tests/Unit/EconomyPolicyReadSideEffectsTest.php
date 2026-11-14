<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class EconomyPolicyReadSideEffectsTest extends TestCase
{
    public function testPolicyReadHelperDoesNotInitializeMissingRows(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);

        $start = strpos($source, 'function fetch_policy(');
        $end = strpos($source, "\nfunction fetch_user_colonies(", $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        $helper = substr($source, $start, $end - $start);

        self::assertStringContainsString('SELECT * FROM economy_policies WHERE user_id = ?', $helper);
        self::assertStringNotContainsString('ensure_policy_row(', $helper);
        self::assertStringNotContainsString('INSERT ', $helper);
        self::assertStringNotContainsString('UPDATE ', $helper);
    }

    public function testPolicyMutationPathsDelegateRowInitializationToTheLedger(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);

        foreach (['action_set_policy', 'action_set_tax', 'action_set_subsidy'] as $action) {
            $start = strpos($source, 'function ' . $action . '(');
            self::assertNotFalse($start, $action . ' must exist.');
            $end = strpos($source, "\nfunction ", $start + 1);
            self::assertNotFalse($end, $action . ' must have a bounded body.');
            $handler = substr($source, $start, $end - $start);
            self::assertStringContainsString('economy_ledger_mutation($db,', $handler);
            self::assertStringContainsString('$economy->configure($uid,', $handler);
        }
    }

    public function testEconomyControlsAreExplicitCsrfProtectedMutations(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);
        foreach (['policy', 'tax', 'subsidy', 'production_method'] as $action) {
            $start = strpos($source, 'function action_set_' . $action . '(');
            $end = strpos($source, "\nfunction ", $start + 1);
            self::assertNotFalse($start);
            self::assertNotFalse($end);
            $handler = substr($source, $start, $end - $start);
            self::assertStringContainsString("only_method('POST');", $handler);
            self::assertStringContainsString('verify_csrf();', $handler);
            self::assertStringContainsString('invalidate_economy_views(', $handler);
        }
    }
}
