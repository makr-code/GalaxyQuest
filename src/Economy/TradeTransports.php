<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use PDO;

/** Read-only projection of shipments backed by the player's own orders. */
final class TradeTransports
{
    public function __construct(private PDO $db) {}

    public function list(int $userId): array
    {
        $stmt = $this->db->prepare(
            "SELECT r.id AS route_id, r.fleet_id, r.source_colony_id, r.target_colony_id, "
            . "r.resource_type, r.quantity_acquired, r.departure_at, r.arrival_at, "
            . "f.origin_x_ly, f.origin_y_ly, f.origin_z_ly, f.target_x_ly, f.target_y_ly, f.target_z_ly "
            . "FROM trader_routes r JOIN fleets f ON f.id=r.fleet_id "
            . "WHERE r.status='in_transit' AND r.funding_status='backed' AND EXISTS ("
            . "SELECT 1 FROM economy_standing_orders o WHERE o.user_id=? AND "
            . "((o.id=r.source_order_id AND o.colony_id=r.source_colony_id AND o.side='sell') "
            . "OR (o.id=r.target_order_id AND o.colony_id=r.target_colony_id AND o.side='buy'))) "
            . "ORDER BY r.id"
        );
        $stmt->execute([$userId]);
        $result = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $coordinates = ['origin_x_ly', 'origin_y_ly', 'origin_z_ly', 'target_x_ly', 'target_y_ly', 'target_z_ly'];
            foreach ($coordinates as $coordinate) {
                if ($row[$coordinate] === null || !is_numeric($row[$coordinate])
                    || !is_finite((float)$row[$coordinate])) {
                    continue 2;
                }
            }
            $departure = strtotime((string)$row['departure_at']);
            $arrival = strtotime((string)$row['arrival_at']);
            if ($departure === false || $arrival === false || $arrival <= $departure) {
                continue;
            }
            $result[] = [
                'route_id' => (int)$row['route_id'], 'fleet_id' => (int)$row['fleet_id'],
                'source_colony_id' => (int)$row['source_colony_id'],
                'target_colony_id' => (int)$row['target_colony_id'],
                'good_type' => (string)$row['resource_type'], 'quantity' => (float)$row['quantity_acquired'],
                'departure_unix' => $departure, 'arrival_unix' => $arrival,
                'origin' => [(float)$row['origin_x_ly'], (float)$row['origin_y_ly'], (float)$row['origin_z_ly']],
                'target' => [(float)$row['target_x_ly'], (float)$row['target_y_ly'], (float)$row['target_z_ly']],
            ];
        }
        return $result;
    }
}
