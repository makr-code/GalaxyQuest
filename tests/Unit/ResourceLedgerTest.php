<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\ResourceLedger;

use DomainException;
use GalaxyQuest\Economy\ResourceLedger;
use PDO;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class ResourceLedgerTest extends TestCase
{
    private PDO $db;
    private ResourceLedger $ledger;

    protected function setUp(): void
    {
        require_once __DIR__ . '/../../src/Economy/ResourceLedger.php';
        $this->db = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
        $this->db->exec('INSERT INTO users VALUES (3), (4)');
        $this->db->exec(
            'CREATE TABLE colonies (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                metal REAL NOT NULL,
                crystal REAL NOT NULL,
                deuterium REAL NOT NULL,
                rare_earth REAL NOT NULL,
                food REAL NOT NULL
            )'
        );
        $this->db->exec(
            'INSERT INTO colonies VALUES (7, 3, 100, 80, 60, 30, 40), (8, 4, 20, 20, 20, 5, 6)'
        );
        $this->ledger = new ResourceLedger($this->db);
    }

    public function testSpendDebitsResourcesAndRunsMutationInTheTransaction(): void
    {
        $result = $this->ledger->spend(7, 3, ['metal' => 25, 'crystal' => 10], function (): string {
            self::assertTrue($this->db->inTransaction());
            return 'queued';
        });

        self::assertSame('queued', $result);
        self::assertSame([75.0, 70.0, 60.0], $this->resources(7));
        self::assertFalse($this->db->inTransaction());
    }

    public function testSpendSupportsRareEarthAndFoodCargo(): void
    {
        $this->ledger->spend(7, 3, ['rare_earth' => 12, 'food' => 15], static fn(): null => null);

        $stmt = $this->db->query('SELECT rare_earth, food FROM colonies WHERE id = 7');
        self::assertSame([18.0, 25.0], array_map('floatval', $stmt->fetch(PDO::FETCH_NUM)));
    }

    public function testInsufficientBalanceDoesNotDebitAnyResource(): void
    {
        $this->expectException(DomainException::class);
        $this->expectExceptionCode(409);

        try {
            $this->ledger->spend(7, 3, ['metal' => 101, 'crystal' => 10], static fn(): null => null);
        } finally {
            self::assertSame([100.0, 80.0, 60.0], $this->resources(7));
        }
    }

    public function testSpendRejectsColonyOwnedByAnotherUser(): void
    {
        try {
            $this->ledger->spend(8, 3, ['metal' => 1], static fn(): null => null);
            self::fail('Expected colony ownership failure.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        self::assertSame([20.0, 20.0, 20.0], $this->resources(8));
    }

    public function testMissingUserCannotSpendColonyResources(): void
    {
        try {
            $this->ledger->spend(7, 99, ['metal' => 1], static fn(): null => null);
            self::fail('Expected user ownership failure.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        self::assertSame([100.0, 80.0, 60.0], $this->resources(7));
    }

    public function testFailedMutationRollsBackResourceDebits(): void
    {
        $this->db->exec('CREATE TABLE ship_build_queue (id INTEGER PRIMARY KEY, ship_type TEXT NOT NULL)');
        try {
            $this->ledger->spend(7, 3, ['metal' => 25], function (): void {
                $this->db->exec("INSERT INTO ship_build_queue (ship_type) VALUES ('scout')");
                throw new RuntimeException('queue insert failed');
            });
            self::fail('Expected mutation failure.');
        } catch (RuntimeException $error) {
            self::assertSame('queue insert failed', $error->getMessage());
        }
        self::assertSame([100.0, 80.0, 60.0], $this->resources(7));
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM ship_build_queue')->fetchColumn());
    }

    public function testCallerTransactionRemainsOpenAndCanRollBackLedgerSpend(): void
    {
        $this->db->beginTransaction();
        $this->ledger->spend(7, 3, ['metal' => 25], static fn(): null => null);

        self::assertTrue($this->db->inTransaction());
        self::assertSame([75.0, 80.0, 60.0], $this->resources(7));

        $this->db->rollBack();
        self::assertSame([100.0, 80.0, 60.0], $this->resources(7));
    }

    public function testColonyTransactionRollsBackArbitraryMarketMutation(): void
    {
        $this->db->exec('ALTER TABLE users ADD COLUMN credits REAL NOT NULL DEFAULT 0');
        $this->db->exec('UPDATE users SET credits = 500 WHERE id = 3');
        $this->db->exec(
            'CREATE TABLE economy_processed_goods (
                colony_id INTEGER NOT NULL,
                good_type TEXT NOT NULL,
                quantity REAL NOT NULL,
                capacity REAL NOT NULL,
                PRIMARY KEY (colony_id, good_type)
            )'
        );

        try {
            $this->ledger->transactionWithColony(7, 3, function (): void {
                $this->db->exec('UPDATE users SET credits = credits - 100 WHERE id = 3 AND credits >= 100');
                $this->db->exec("INSERT INTO economy_processed_goods VALUES (7, 'food', 25, 100)");
                throw new RuntimeException('market audit insert failed');
            });
            self::fail('Expected market transaction failure.');
        } catch (RuntimeException $error) {
            self::assertSame('market audit insert failed', $error->getMessage());
        }

        self::assertSame(500.0, (float)$this->db->query('SELECT credits FROM users WHERE id = 3')->fetchColumn());
        self::assertSame(
            0,
            (int)$this->db->query('SELECT COUNT(*) FROM economy_processed_goods')->fetchColumn()
        );
    }

    public function testResearchLikeEmpireMutationRejectsSecondSpendAndRollsItBack(): void
    {
        $this->db->exec(
            'CREATE TABLE research (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                level INTEGER NOT NULL,
                research_end TEXT
            )'
        );
        $this->db->exec("INSERT INTO research (user_id, type, level, research_end) VALUES (3, 'physics', 0, NULL)");

        $startResearch = function (string $end): void {
            $busy = $this->db->prepare(
                'SELECT id FROM research WHERE user_id = ? AND research_end IS NOT NULL'
            );
            $busy->execute([3]);
            if ($busy->fetch()) {
                throw new DomainException('Another research is already in progress.', 409);
            }
            $update = $this->db->prepare(
                'UPDATE research SET research_end = ? WHERE user_id = ? AND type = ? AND research_end IS NULL'
            );
            $update->execute([$end, 3, 'physics']);
            if ($update->rowCount() !== 1) {
                throw new DomainException('Research state changed.', 409);
            }
        };

        $this->ledger->spend(7, 3, ['metal' => 10], fn() => $startResearch('2099-01-01 00:00:00'));

        try {
            $this->ledger->spend(7, 3, ['metal' => 10], fn() => $startResearch('2099-01-02 00:00:00'));
            self::fail('Expected the active research to reject a second start.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }

        self::assertSame([90.0, 80.0, 60.0], $this->resources(7));
        self::assertSame('2099-01-01 00:00:00', $this->db->query('SELECT research_end FROM research')->fetchColumn());
    }

    public function testUnavailableFleetReservationRollsBackResourceDebit(): void
    {
        $this->db->exec(
            'CREATE TABLE ships (
                colony_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (colony_id, type)
            )'
        );
        $this->db->exec("INSERT INTO ships VALUES (7, 'scout', 2)");

        try {
            $this->ledger->spend(7, 3, ['metal' => 25], function (): void {
                $reserve = $this->db->prepare(
                    'UPDATE ships SET count = count - ? WHERE colony_id = ? AND type = ? AND count >= ?'
                );
                $reserve->execute([3, 7, 'scout', 3]);
                if ($reserve->rowCount() !== 1) {
                    throw new DomainException('Ships are no longer available.', 409);
                }
            });
            self::fail('Expected unavailable ships to reject fleet dispatch.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }

        self::assertSame([100.0, 80.0, 60.0], $this->resources(7));
        self::assertSame(2, (int)$this->db->query('SELECT count FROM ships')->fetchColumn());
    }

    public function testSuccessfulFleetReservationCommitsCargoAndShipDebitTogether(): void
    {
        $this->db->exec(
            'CREATE TABLE ships (
                colony_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (colony_id, type)
            )'
        );
        $this->db->exec('CREATE TABLE fleets (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
        $this->db->exec("INSERT INTO ships VALUES (7, 'scout', 2)");

        $fleetId = $this->ledger->spend(7, 3, ['metal' => 25], function (): int {
            $reserve = $this->db->prepare(
                'UPDATE ships SET count = count - ? WHERE colony_id = ? AND type = ? AND count >= ?'
            );
            $reserve->execute([1, 7, 'scout', 1]);
            if ($reserve->rowCount() !== 1) {
                throw new DomainException('Ships are no longer available.', 409);
            }
            $this->db->exec("INSERT INTO fleets (payload) VALUES ('launched')");
            return (int)$this->db->lastInsertId();
        });

        self::assertSame(1, $fleetId);
        self::assertSame([75.0, 80.0, 60.0], $this->resources(7));
        self::assertSame(1, (int)$this->db->query('SELECT count FROM ships')->fetchColumn());
        self::assertSame('launched', $this->db->query('SELECT payload FROM fleets')->fetchColumn());
    }

    public function testInvalidCostsAreRejectedWithoutMutation(): void
    {
        $costs = [
            ['metal' => -1],
            ['metal' => INF],
            ['credits' => 1],
            ['metal' => 'invalid'],
        ];
        foreach ($costs as $cost) {
            try {
                $this->ledger->spend(7, 3, $cost, static fn(): null => null);
                self::fail('Expected invalid resource cost.');
            } catch (DomainException $error) {
                self::assertSame(400, $error->getCode());
            }
        }
        self::assertSame([100.0, 80.0, 60.0], $this->resources(7));
    }

    private function resources(int $colonyId): array
    {
        $stmt = $this->db->prepare('SELECT metal, crystal, deuterium FROM colonies WHERE id = ?');
        $stmt->execute([$colonyId]);
        return array_map('floatval', $stmt->fetch(PDO::FETCH_NUM));
    }
}
