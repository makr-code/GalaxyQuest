<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use DomainException;
use GalaxyQuest\Simulation\HourlyWindow;
use PDO;
use PDOException;
use RuntimeException;

require_once __DIR__ . '/NpcStandingOrders.php';
require_once __DIR__ . '/../../lib/Mailer.php';
require_once __DIR__ . '/../../lib/mail_outbox.php';

/** A consent/deadline layer over finite orders, not a second exchange. */
final class EconomicRequests
{
    public const TTL_SECONDS = 86400;
    public const MAX_OUTSTANDING = 3;

    public function __construct(private PDO $db)
    {
    }

    public static function available(PDO $db): bool
    {
        try {
            $db->query('SELECT id FROM economy_requests LIMIT 1');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02'
                || ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
                    && str_contains($error->getMessage(), 'no such table: economy_requests'))) {
                return false;
            }
            throw $error;
        }
    }

    /** Existing hourly world step only; no human settlement, escrow or production. */
    public function tick(int $now): array
    {
        if (!self::available($this->db)) {
            return ['processed' => false, 'reason' => 'economy_requests_unavailable'];
        }
        $expired = $this->db->prepare(
            "UPDATE economy_requests SET status='expired',resolved_at=? WHERE status='pending' AND expires_at<=?"
        );
        $expired->execute([$now, $now]);
        $created = [];
        foreach ($this->rows('SELECT user_id FROM economy_npc_profiles ORDER BY user_id LIMIT 64') as $actor) {
            $request = $this->offer((int)$actor['user_id'], $now);
            if ($request !== null) {
                $created[] = $request['id'];
            }
        }
        return ['processed' => true, 'expired' => $expired->rowCount(), 'created' => $created];
    }

    /** One invitation per NPC/hour, one per NPC order/player, at most three pending/player. */
    public function offer(int $npc, int $now): ?array
    {
        $window = HourlyWindow::id($now);
        if ($this->row('SELECT id FROM economy_requests WHERE npc_user_id=? AND window_id=?', [$npc, $window])) {
            return null;
        }
        // Ordinary traders allow only same-galaxy, different-system routes.
        // Player accounts and other galaxies are never included in the public payload.
        $candidates = $this->rows(
            'SELECT o.id order_id,o.colony_id npc_colony_id,c.id player_colony_id,c.user_id player_user_id '
            . 'FROM economy_npc_orders n JOIN economy_standing_orders o ON o.id=n.order_id AND n.user_id=o.user_id '
            . 'JOIN economy_npc_profiles p ON p.user_id=o.user_id AND p.colony_id=o.colony_id '
            . 'JOIN users u ON u.id=o.user_id JOIN colonies nc ON nc.id=o.colony_id AND nc.user_id=o.user_id '
            . 'JOIN celestial_bodies nb ON nb.id=nc.body_id '
            . 'JOIN celestial_bodies b ON b.galaxy_index=nb.galaxy_index AND b.system_index<>nb.system_index '
            . 'JOIN colonies c ON c.body_id=b.id JOIN users h ON h.id=c.user_id '
            . "WHERE o.user_id=? AND u.control_type='npc_engine' AND u.auth_enabled=0 AND u.deleted_at IS NULL "
            . "AND h.control_type='human' AND h.auth_enabled=1 AND h.deleted_at IS NULL "
            . "AND o.status='active' AND o.paired_order_id IS NULL AND o.quantity_remaining>0 "
            . "AND ((o.side='buy' AND o.limit_price_cents>1 "
            . 'AND o.escrow_cents=o.quantity_remaining*o.limit_price_cents) '
            . "OR (o.side='sell' AND o.limit_price_cents>=1 AND o.limit_price_cents<? AND o.escrow_cents=0)) "
            . 'AND n.expires_window>? '
            . 'AND NOT EXISTS (SELECT 1 FROM economy_requests r WHERE r.npc_order_id=o.id AND r.player_user_id=c.user_id) '
            . 'AND NOT EXISTS (SELECT 1 FROM economy_requests r WHERE r.npc_user_id=o.user_id '
            . 'AND r.player_user_id=c.user_id AND r.created_at>?) '
            . "AND (SELECT COUNT(*) FROM economy_requests r WHERE r.player_user_id=c.user_id "
            . "AND r.status='pending' AND r.expires_at>?)<? "
            . 'ORDER BY o.id,c.user_id,c.id LIMIT 128',
            [$npc, StandingOrders::MAX_PRICE_CENTS, $window, $now - self::TTL_SECONDS, $now, self::MAX_OUTSTANDING]
        );
        if ($candidates === []) {
            return null;
        }
        $candidate = HourlyWindow::random($window, 'npc_economy', $npc, 'player_request')->pick($candidates);
        return (new OnDemandEconomy($this->db))->transaction(function () use ($candidate, $npc, $window, $now): ?array {
            $orders = new StandingOrders($this->db);
            $player = (int)$candidate['player_user_id'];
            $orders->lockParticipants([
                [$npc, (int)$candidate['npc_colony_id']], [$player, (int)$candidate['player_colony_id']],
            ]);
            // Recheck under sorted participant locks: concurrent offers share the
            // recipient lock, so the inbox cap is not just a forecasting query.
            if (!$this->human($player) || !$this->npc($npc, (int)$candidate['npc_colony_id'])
                || !$this->geography((int)$candidate['npc_colony_id'], (int)$candidate['player_colony_id'])
                || $this->row('SELECT id FROM economy_requests WHERE npc_user_id=? AND window_id=?' . $this->lock(), [$npc, $window])
                || $this->row('SELECT id FROM economy_requests WHERE npc_user_id=? AND player_user_id=? AND created_at>?'
                    . $this->lock(),
                    [$npc, $player, $now - self::TTL_SECONDS])
                || (int)$this->scalar("SELECT COUNT(*) FROM economy_requests WHERE player_user_id=? "
                    . "AND status='pending' AND expires_at>?" . $this->lock(), [$player, $now]) >= self::MAX_OUTSTANDING) {
                return null;
            }
            $order = $orders->read((int)$candidate['order_id'], $npc, true);
            $meta = $this->row('SELECT expires_window FROM economy_npc_orders WHERE order_id=? AND user_id=?'
                . $this->lock(), [$order['id'], $npc]);
            if (!$this->funded($order) || !$meta || (int)$meta['expires_window'] <= $window
                || $this->row('SELECT id FROM economy_requests WHERE npc_order_id=? AND player_user_id=?' . $this->lock(),
                    [$order['id'], $player])) {
                return null;
            }
            $quantity = min(100, (int)$order['quantity_remaining']);
            $expires = min($now + self::TTL_SECONDS, (int)$meta['expires_window'] * 3600);
            $purchase = $order['side'] === 'sell';
            $price = (int)$order['limit_price_cents'] + ($purchase ? 1 : -1);
            $this->db->prepare(
                'INSERT INTO economy_requests (npc_user_id,npc_order_id,player_user_id,player_colony_id,window_id,'
                . 'good_type,quantity,price_cents,npc_price_cents,expires_at,created_at,request_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
            )->execute([$npc, $order['id'], $player, $candidate['player_colony_id'], $window,
                $order['good_type'], $quantity, $price,
                $order['limit_price_cents'], $expires, $now, $purchase ? 'purchase' : 'supply']);
            $id = (int)$this->db->lastInsertId();
            $subject = $purchase ? 'Freiwilliges NPC-Überschussangebot' : 'Freiwillige NPC-Versorgungsanfrage';
            $body = 'Anfrage #' . $id . ': ' . ($purchase ? 'Kaufe ' : 'Liefere ')
                . $quantity . ' Einheiten ' . $order['good_type']
                . ($purchase ? ' für Kolonie #' : ' aus Kolonie #') . $candidate['player_colony_id'] . ' zu '
                . StandingOrders::money($price) . ' Credits je Einheit, '
                . ($purchase ? 'höchstens ' : 'insgesamt ') . StandingOrders::money($quantity * $price) . ' Credits.'
                . ' Frist: ' . gmdate('Y-m-d H:i:s', $expires) . ' UTC.'
                . ' Ohne Antwort verfällt die Anfrage ohne Kosten oder Strafe. Annahme reserviert '
                . ($purchase ? 'den maximalen Kreditbetrag; der NPC-Bestand wird erneut geprüft;' : 'die Ware;')
                . ' die spätere Lieferung erfolgt durch normale Händler, nicht sofort und ohne garantierten Termin.'
                . ' Im Spiel im Markt entscheiden: /#economy-request-' . $id
                . '-colony-' . $candidate['player_colony_id'];
            $this->db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
                ->execute([$player, $subject, $body]);
            \mail_outbox_enqueue($this->db, $player, 'economy_request', 'economy_request:' . $id,
                $subject, $body . "\n\n" . MAIL_OUTBOX_SETTINGS_HINT, $now);
            return $this->describe($this->owned($id, $player), $now);
        });
    }

    /** Pure, owner-scoped reads, including effective deadline/unavailability. */
    public function list(int $uid, int $cid, int $now): array
    {
        if (!$this->row('SELECT id FROM colonies WHERE id=? AND user_id=?', [$cid, $uid])) {
            throw new DomainException('Kolonie nicht gefunden.', 404);
        }
        if (!self::available($this->db)) {
            return [];
        }
        if (!$this->human($uid)) {
            throw new DomainException('Anfrage nicht gefunden.', 404);
        }
        $rows = $this->rows('SELECT r.* FROM economy_requests r JOIN colonies c ON c.id=r.player_colony_id '
            . 'WHERE r.player_user_id=? AND c.user_id=? AND c.id=? ORDER BY r.id DESC LIMIT 100', [$uid, $uid, $cid]);
        return array_map(fn(array $row): array => $this->describe($row, $now), $rows);
    }

    /** Decline/default never touch resources. Acceptance and both finite orders commit together. */
    public function respond(int $uid, int $id, string $action, int $now): array
    {
        if (!in_array($action, ['accept', 'decline'], true)) {
            throw new DomainException('Ungültige Entscheidung.', 400);
        }
        $hint = $this->owned($id, $uid);
        $orders = new StandingOrders($this->db);
        $participants = [[$uid, (int)$hint['player_colony_id']]];
        if ($action === 'accept' && $hint['status'] === 'pending' && $now < (int)$hint['expires_at']) {
            $npcHint = $orders->read((int)$hint['npc_order_id'], (int)$hint['npc_user_id']);
            $participants[] = [(int)$hint['npc_user_id'], (int)$npcHint['colony_id']];
        }
        return (new OnDemandEconomy($this->db))->transaction(function () use ($participants, $orders, $uid, $id, $action, $now): array {
            $orders->lockParticipants($participants);
            $request = $this->owned($id, $uid, true);
            if (!$this->human($uid)) {
                throw new DomainException('Anfrage nicht gefunden.', 404);
            }
            if ($request['status'] !== 'pending') {
                return $this->describe($request, $now);
            }
            if ($now >= (int)$request['expires_at']) {
                return $this->resolve($request, 'expired', $now);
            }
            if ($action === 'decline') {
                return $this->resolve($request, 'declined', $now);
            }
            $npc = (int)$request['npc_user_id'];
            $order = $orders->read((int)$request['npc_order_id'], $npc, true);
            $quantity = (int)$request['quantity'];
            $price = (int)$request['npc_price_cents'];
            $purchase = ($request['request_type'] ?? 'supply') === 'purchase';
            $meta = $this->row('SELECT expires_window FROM economy_npc_orders WHERE order_id=? AND user_id=?'
                . $this->lock(), [$order['id'], $npc]);
            if (!$this->npc($npc, (int)$order['colony_id']) || !$this->funded($order)
                || $order['side'] !== ($purchase ? 'sell' : 'buy')
                || !$meta || (int)$meta['expires_window'] <= HourlyWindow::id($now)
                || !$this->geography((int)$order['colony_id'], (int)$request['player_colony_id'])
                || (int)$order['quantity_remaining'] < $quantity
                || $order['good_type'] !== $request['good_type'] || (int)$order['limit_price_cents'] !== $price) {
                return $this->resolve($request, 'unavailable', $now);
            }
            $orders->assertPolicy($npc, $purchase ? 'sell' : 'buy');
            $playerOrder = $orders->create($uid, (int)$request['player_colony_id'], $purchase ? 'buy' : 'sell',
                (string)$request['good_type'], $quantity, StandingOrders::money((int)$request['price_cents']), $now);
            // Move existing NPC backing, never mint credits or reserved stock.
            $remaining = (int)$order['quantity_remaining'] - $quantity;
            $update = $this->db->prepare('UPDATE economy_standing_orders SET quantity_remaining=?,escrow_cents=?,status=? '
                . "WHERE id=? AND status='active' AND quantity_remaining=? AND escrow_cents=?");
            $update->execute([$remaining, $purchase ? 0 : $remaining * $price, $remaining === 0 ? 'filled' : 'active',
                $order['id'], $order['quantity_remaining'], $order['escrow_cents']]);
            if ($update->rowCount() !== 1) {
                throw new RuntimeException('NPC funding changed while accepting.');
            }
            $this->db->prepare('INSERT INTO economy_standing_orders '
                . '(user_id,colony_id,good_type,side,quantity_initial,quantity_remaining,limit_price_cents,'
                . 'escrow_cents,paired_order_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$npc, $order['colony_id'], $request['good_type'], $purchase ? 'sell' : 'buy', $quantity, $quantity, $price,
                    $purchase ? 0 : $quantity * $price, $playerOrder['id'], gmdate('Y-m-d H:i:s', $now), gmdate('Y-m-d H:i:s', $now)]);
            $committedId = (int)$this->db->lastInsertId();
            $this->db->prepare('UPDATE economy_standing_orders SET paired_order_id=? WHERE id=?')
                ->execute([$committedId, $playerOrder['id']]);
            $this->db->prepare('UPDATE economy_requests SET player_order_id=?,committed_npc_order_id=? WHERE id=?')
                ->execute([$playerOrder['id'], $committedId, $id]);
            return $this->resolve($this->owned($id, $uid), 'accepted', $now);
        });
    }

    private function resolve(array $request, string $status, int $now): array
    {
        $this->db->prepare('UPDATE economy_requests SET status=?,resolved_at=? WHERE id=?')
            ->execute([$status, $now, $request['id']]);
        $request['status'] = $status;
        $request['resolved_at'] = $now;
        return $this->describe($request, $now);
    }

    private function owned(int $id, int $uid, bool $lock = false): array
    {
        $row = $this->row('SELECT * FROM economy_requests WHERE id=? AND player_user_id=?'
            . ($lock ? $this->lock() : ''), [$id, $uid]);
        if (!$row) {
            throw new DomainException('Anfrage nicht gefunden.', 404);
        }
        return $row;
    }

    private function describe(array $row, int $now): array
    {
        $status = $row['status'];
        if ($status === 'pending') {
            $order = $this->row('SELECT * FROM economy_standing_orders WHERE id=?', [$row['npc_order_id']]);
            $purchase = ($row['request_type'] ?? 'supply') === 'purchase';
            $meta = $this->row('SELECT expires_window FROM economy_npc_orders WHERE order_id=? AND user_id=?',
                [$row['npc_order_id'], $row['npc_user_id']]);
            $status = $now >= (int)$row['expires_at'] ? 'expired'
                : (!$order || !$this->funded($order) || (int)$order['quantity_remaining'] < (int)$row['quantity']
                    || $order['side'] !== ($purchase ? 'sell' : 'buy')
                    || (int)$order['user_id'] !== (int)$row['npc_user_id']
                    || $order['good_type'] !== $row['good_type']
                    || !$meta || (int)$meta['expires_window'] <= HourlyWindow::id($now)
                    || !$this->npc((int)$row['npc_user_id'], (int)$order['colony_id'])
                    || !$this->geography((int)$order['colony_id'], (int)$row['player_colony_id'])
                    || (int)$order['limit_price_cents'] !== (int)$row['npc_price_cents'] ? 'unavailable' : 'pending');
        }
        return [
            'id' => (int)$row['id'], 'colony_id' => (int)$row['player_colony_id'], 'type' => $row['request_type'] ?? 'supply',
            'good_type' => (string)$row['good_type'], 'quantity' => (int)$row['quantity'],
            'price_cents' => (int)$row['price_cents'], 'total_cents' => (int)$row['quantity'] * (int)$row['price_cents'],
            'consent' => ($row['request_type'] ?? 'supply') === 'purchase'
                ? 'Annahme reserviert maximal den angezeigten Gesamtbetrag in Credits; der NPC-Bestand wird erneut geprüft.'
                : 'Annahme reserviert die angezeigte Ware aus dieser Kolonie.',
            'expires_at' => (int)$row['expires_at'], 'status' => $status,
            'player_order' => $row['player_order_id'] === null ? null
                : (new StandingOrders($this->db))->read((int)$row['player_order_id'], (int)$row['player_user_id']),
        ];
    }

    private function human(int $uid): bool
    {
        return $this->row("SELECT id FROM users WHERE id=? AND control_type='human' AND auth_enabled=1 AND deleted_at IS NULL"
            . ($this->db->inTransaction() ? $this->lock() : ''),
            [$uid]) !== null;
    }

    private function npc(int $uid, int $cid): bool
    {
        return $this->row('SELECT u.id FROM users u JOIN economy_npc_profiles p ON p.user_id=u.id '
            . 'JOIN colonies c ON c.id=p.colony_id AND c.user_id=u.id '
            . "WHERE u.id=? AND p.colony_id=? AND u.control_type='npc_engine' AND u.auth_enabled=0 AND u.deleted_at IS NULL"
            . ($this->db->inTransaction() ? $this->lock() : ''),
            [$uid, $cid]) !== null;
    }

    private function funded(array $order): bool
    {
        return $order['status'] === 'active' && empty($order['paired_order_id'])
            && isset(ColonyEconomySimulation::PRICES[$order['good_type']]) && (int)$order['quantity_remaining'] > 0
            && (($order['side'] === 'buy' && (int)$order['limit_price_cents'] > 1
                && (int)$order['escrow_cents'] === (int)$order['quantity_remaining'] * (int)$order['limit_price_cents'])
                || ($order['side'] === 'sell' && (int)$order['limit_price_cents'] >= 1
                    && (int)$order['limit_price_cents'] < StandingOrders::MAX_PRICE_CENTS && (int)$order['escrow_cents'] === 0));
    }

    private function geography(int $npcColony, int $playerColony): bool
    {
        return $this->row('SELECT a.id FROM colonies a JOIN celestial_bodies ab ON ab.id=a.body_id '
            . 'JOIN colonies b ON b.id=? JOIN celestial_bodies bb ON bb.id=b.body_id '
            . 'WHERE a.id=? AND ab.galaxy_index=bb.galaxy_index AND ab.system_index<>bb.system_index'
            . ($this->db->inTransaction() ? $this->lock() : ''),
            [$playerColony, $npcColony]) !== null;
    }

    private function lock(): string
    {
        return $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    }

    private function rows(string $sql, array $params = []): array
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    private function row(string $sql, array $params = []): ?array
    {
        return $this->rows($sql, $params)[0] ?? null;
    }

    private function scalar(string $sql, array $params): mixed
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        return $statement->fetchColumn();
    }
}
