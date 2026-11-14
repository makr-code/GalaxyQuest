<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use DomainException;
use PDO;
use RuntimeException;

require_once __DIR__ . '/OnDemandEconomy.php';

/** Whole goods and integer cents keep finite contracts and refunds exact. */
final class StandingOrders
{
    public const MAX_QUANTITY = 1000000;
    public const MAX_PRICE_CENTS = 100000000;
    public const MAX_BUDGET_CENTS = 1000000000000;

    public function __construct(private PDO $db)
    {
    }

    public static function quantity(mixed $value): int
    {
        if ((!is_int($value) && !is_float($value) && !is_string($value))
            || !is_numeric($value) || !is_finite((float)$value)
            || (float)$value < 1 || (float)$value > self::MAX_QUANTITY
            || floor((float)$value) !== (float)$value) {
            throw new DomainException('Menge muss eine ganze Zahl zwischen 1 und 1000000 sein.', 400);
        }
        return (int)$value;
    }

    public static function priceCents(mixed $value): int
    {
        if ((!is_int($value) && !is_float($value) && !is_string($value))
            || !preg_match('/^\d+(?:\.\d{1,2})?$/D', (string)$value)) {
            throw new DomainException('Limitpreis benötigt höchstens zwei Nachkommastellen.', 400);
        }
        $parts = explode('.', (string)$value);
        if (strlen($parts[0]) > 7) {
            throw new DomainException('Limitpreis außerhalb des erlaubten Bereichs.', 400);
        }
        $cents = (int)$parts[0] * 100 + (int)str_pad($parts[1] ?? '', 2, '0');
        if ($cents < 1 || $cents > self::MAX_PRICE_CENTS) {
            throw new DomainException('Limitpreis muss zwischen 0,01 und 1000000 Credits liegen.', 400);
        }
        return $cents;
    }

    public static function money(int $cents): string
    {
        $amount = abs($cents);
        return ($cents < 0 ? '-' : '') . intdiv($amount, 100) . '.'
            . str_pad((string)($amount % 100), 2, '0', STR_PAD_LEFT);
    }

    /** Floor existing decimal capital to spendable cents without a float round-up. */
    public static function capitalCents(mixed $value): int
    {
        if (is_float($value)) {
            if (!is_finite($value) || $value < 0 || $value >= 100000000000000) {
                throw new RuntimeException('Invalid trader capital.');
            }
            return (int)floor($value * 100);
        }
        $text = (string)$value;
        if (!preg_match('/^\d{1,14}(?:\.\d+)?$/D', $text)) {
            throw new RuntimeException('Invalid trader capital.');
        }
        $parts = explode('.', $text);
        return (int)$parts[0] * 100 + (int)str_pad(substr($parts[1] ?? '', 0, 2), 2, '0');
    }

    /** @return array<string, int|string> */
    public function create(int $uid, int $cid, string $side, string $good, mixed $quantity, mixed $price, ?int $now = null): array
    {
        $qty = self::quantity($quantity);
        $cents = self::priceCents($price);
        if (!in_array($side, ['buy', 'sell'], true) || !isset(ColonyEconomySimulation::PRICES[$good])) {
            throw new DomainException('Ungültige Auftragsseite oder Ware.', 400);
        }
        $budget = $qty * $cents;
        if ($budget > self::MAX_BUDGET_CENTS) {
            throw new DomainException('Auftragsbudget überschreitet 10000000000 Credits.', 400);
        }
        $economy = new OnDemandEconomy($this->db);
        return $economy->transaction(function () use ($economy, $uid, $cid, $side, $good, $qty, $cents, $budget, $now): array {
            $snapshot = $economy->settle($cid, $uid, $now, true);
            $economy->assertCaughtUp($snapshot);
            $this->assertPolicy($uid, $side);
            $reserve = function () use ($uid, $cid, $side, $good, $qty, $cents, $budget, $now): array {
                if ($side === 'buy') {
                    $statement = $this->db->prepare(
                        'UPDATE users SET credits=credits-? WHERE id=? AND credits>=?'
                    );
                    $statement->execute([self::money($budget), $uid, self::money($budget)]);
                    if ($statement->rowCount() !== 1) {
                        throw new DomainException('Nicht genügend Credits für die Reservierung.', 409);
                    }
                }
                $this->db->prepare(
                    'INSERT INTO economy_standing_orders '
                    . '(user_id,colony_id,good_type,side,quantity_initial,quantity_remaining,limit_price_cents,escrow_cents,created_at,updated_at) '
                    . 'VALUES (?,?,?,?,?,?,?,?,?,?)'
                )->execute([$uid, $cid, $good, $side, $qty, $qty, $cents, $side === 'buy' ? $budget : 0,
                    gmdate('Y-m-d H:i:s', $now ?? time()), gmdate('Y-m-d H:i:s', $now ?? time())]);
                return $this->read((int)$this->db->lastInsertId(), $uid);
            };
            return $side === 'sell' ? $economy->spend($cid, $uid, [$good => $qty], $reserve, $now) : $reserve();
        });
    }

    /** Cancellation never refunds already allocated route obligations. */
    public function cancel(int $uid, int $id, ?int $now = null): array
    {
        $hint = $this->read($id, $uid);
        $economy = new OnDemandEconomy($this->db);
        return $economy->transaction(function () use ($uid, $id, $hint, $economy, $now): array {
            if (!empty($hint['paired_order_id'])) {
                $statement = $this->db->prepare('SELECT * FROM economy_standing_orders WHERE id=?');
                $statement->execute([(int)$hint['paired_order_id']]);
                $other = $statement->fetch(PDO::FETCH_ASSOC);
                if (!$other || (int)$other['paired_order_id'] !== $id) {
                    throw new RuntimeException('Private order pair is inconsistent.');
                }
                $this->lockParticipants([
                    [(int)$hint['user_id'], (int)$hint['colony_id']],
                    [(int)$other['user_id'], (int)$other['colony_id']],
                ]);
                $pair = [$hint, $other];
                usort($pair, static fn(array $a, array $b): int => (int)$a['id'] <=> (int)$b['id']);
                foreach ($pair as $entry) {
                    $snapshot = $economy->settle((int)$entry['colony_id'], (int)$entry['user_id'], $now, true);
                    $economy->assertCaughtUp($snapshot);
                }
                foreach ($pair as $entry) {
                    $this->cancelResidual($this->read((int)$entry['id'], (int)$entry['user_id'], true), $economy, $now);
                }
                return $this->read($id, $uid);
            }
            $snapshot = $economy->settle((int)$hint['colony_id'], $uid, $now, true);
            $economy->assertCaughtUp($snapshot);
            $order = $this->read($id, $uid, true);
            $this->cancelResidual($order, $economy, $now);
            return $this->read($id, $uid);
        });
    }

    /** Same sorted account/colony lock order as cross-owner route acquisition.
     * @param list<array{int,int}> $participants
     */
    public function lockParticipants(array $participants): void
    {
        $suffix = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
        $owners = array_unique(array_column($participants, 0));
        sort($owners, SORT_NUMERIC);
        foreach ($owners as $owner) {
            $this->db->prepare('SELECT id FROM users WHERE id=?' . $suffix)->execute([$owner]);
        }
        usort($participants, static fn(array $a, array $b): int => $a[1] <=> $b[1]);
        foreach ($participants as [$owner, $colony]) {
            $statement = $this->db->prepare('SELECT user_id FROM colonies WHERE id=?' . $suffix);
            $statement->execute([$colony]);
            if ((int)$statement->fetchColumn() !== $owner) {
                throw new DomainException('Kolonie hat den Besitzer gewechselt.', 409);
            }
        }
    }

    private function cancelResidual(array $order, OnDemandEconomy $economy, ?int $now): void
    {
        if ($order['status'] !== 'active') {
            return;
        }
        if ($order['side'] === 'buy') {
            $this->db->prepare('UPDATE users SET credits=credits+? WHERE id=?')
                ->execute([self::money((int)$order['escrow_cents']), (int)$order['user_id']]);
        } elseif ((int)$order['quantity_remaining'] > 0) {
            $economy->receive((int)$order['colony_id'], [
                (string)$order['good_type'] => (int)$order['quantity_remaining'],
            ], $now);
        }
        $this->db->prepare(
            "UPDATE economy_standing_orders SET status='cancelled',quantity_remaining=0,escrow_cents=0 WHERE id=?"
        )->execute([(int)$order['id']]);
    }

    public function assertPolicy(int $uid, string $side): void
    {
        $suffix = $this->db->inTransaction() && $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql'
            ? ' FOR UPDATE' : '';
        $statement = $this->db->prepare('SELECT global_policy FROM economy_policies WHERE user_id=?' . $suffix);
        $statement->execute([$uid]);
        $policy = $statement->fetchColumn();
        if ($side === 'buy' && ($policy === 'autarky' || (string)$policy === '3')) {
            throw new DomainException('Autarkie erlaubt keine neuen Importaufträge.', 409);
        }
    }

    /** @return list<array<string, int|string>> */
    public function list(int $uid, int $cid): array
    {
        $statement = $this->db->prepare('SELECT id FROM colonies WHERE id=? AND user_id=?');
        $statement->execute([$cid, $uid]);
        if ($statement->fetchColumn() === false) {
            throw new DomainException('Kolonie nicht gefunden.', 404);
        }
        $statement = $this->db->prepare(
            'SELECT * FROM economy_standing_orders WHERE user_id=? AND colony_id=? '
            . "ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,id DESC LIMIT 200"
        );
        $statement->execute([$uid, $cid]);
        return array_map(self::shape(...), $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    public function read(int $id, int $uid, bool $lock = false): array
    {
        $suffix = $lock && $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
        $statement = $this->db->prepare('SELECT * FROM economy_standing_orders WHERE id=? AND user_id=?' . $suffix);
        $statement->execute([$id, $uid]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new DomainException('Auftrag nicht gefunden.', 404);
        }
        return self::shape($row);
    }

    public static function shape(array $row): array
    {
        foreach (['id', 'user_id', 'colony_id', 'quantity_initial', 'quantity_remaining', 'limit_price_cents', 'escrow_cents'] as $key) {
            $row[$key] = (int)$row[$key];
        }
        return $row;
    }
}
