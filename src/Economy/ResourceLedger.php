<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use DomainException;
use PDO;
use Throwable;

final class ResourceLedger
{
    private bool $mysql;
    private static int $transactionSequence = 0;

    public function __construct(private PDO $db)
    {
        $this->mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    }

    /**
     * @param array<string, int|float|string> $cost
     * @param callable(): mixed $commit
     */
    public function spend(int $colonyId, int $userId, array $cost, callable $commit): mixed
    {
        $normalized = self::normalizeCost($cost);
        return $this->transactionWithColony(
            $colonyId,
            $userId,
            function () use ($normalized, $colonyId, $userId, $commit): mixed {
                $deductions = [];
                $conditions = [];
                $params = [];
                foreach ($normalized as $resource => $quantity) {
                    if ($quantity <= 0) {
                        continue;
                    }
                    $deductions[] = "`$resource` = `$resource` - ?";
                    $conditions[] = "`$resource` >= ?";
                    $params[] = $quantity;
                }

                if ($deductions !== []) {
                    $params[] = $colonyId;
                    $params[] = $userId;
                    foreach ($normalized as $resource => $quantity) {
                        if ($quantity > 0) {
                            $params[] = $quantity;
                        }
                    }
                    $update = $this->db->prepare(
                        'UPDATE colonies SET ' . implode(', ', $deductions)
                        . ' WHERE id = ? AND user_id = ? AND ' . implode(' AND ', $conditions)
                    );
                    $update->execute($params);
                    if ($update->rowCount() !== 1) {
                        throw new DomainException('Insufficient resources.', 409);
                    }
                }

                return $commit();
            }
        );
    }

    /**
     * @param callable(): mixed $operation
     */
    public function transactionWithColony(int $colonyId, int $userId, callable $operation): mixed
    {
        $outer = $this->db->inTransaction();
        $savepoint = 'resource_ledger_' . ++self::$transactionSequence;

        if ($outer) {
            $this->db->exec('SAVEPOINT ' . $savepoint);
        } else {
            $this->db->beginTransaction();
        }

        try {
            $lock = $this->mysql ? ' FOR UPDATE' : '';
            $user = $this->db->prepare('SELECT id FROM users WHERE id = ?' . $lock);
            $user->execute([$userId]);
            if ($user->fetchColumn() === false) {
                throw new DomainException('User not found.', 404);
            }

            $colony = $this->db->prepare('SELECT user_id FROM colonies WHERE id = ?' . $lock);
            $colony->execute([$colonyId]);
            $ownerId = $colony->fetchColumn();
            if ($ownerId === false || (int)$ownerId !== $userId) {
                throw new DomainException('Colony not found.', 404);
            }

            $result = $operation();
            if ($outer) {
                $this->db->exec('RELEASE SAVEPOINT ' . $savepoint);
            } else {
                $this->db->commit();
            }
            return $result;
        } catch (Throwable $error) {
            if ($outer) {
                $this->db->exec('ROLLBACK TO SAVEPOINT ' . $savepoint);
                $this->db->exec('RELEASE SAVEPOINT ' . $savepoint);
            } elseif ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }

    /**
     * @param array<string, int|float|string> $cost
     * @return array{metal: float, crystal: float, deuterium: float, rare_earth: float, food: float}
     */
    private static function normalizeCost(array $cost): array
    {
        $normalized = [
            'metal' => 0.0,
            'crystal' => 0.0,
            'deuterium' => 0.0,
            'rare_earth' => 0.0,
            'food' => 0.0,
        ];
        foreach ($cost as $resource => $quantity) {
            if (!array_key_exists($resource, $normalized) || !is_numeric($quantity)) {
                throw new DomainException('Invalid resource cost.', 400);
            }
            $amount = (float)$quantity;
            if (!is_finite($amount) || $amount < 0) {
                throw new DomainException('Invalid resource cost.', 400);
            }
            $normalized[$resource] = $amount;
        }
        return $normalized;
    }
}
