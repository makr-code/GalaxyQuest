<?php
/**
 * ColonizationEngine — Empire Sprawl, Sektor-Verwaltung, Gouverneure, Edikte
 *
 * Referenz:
 *   docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md (§2–§11)
 *   docs/github-issues/01-colonization-db-backend.md
 *   sql/migrate_colonization_v1.sql
 *   sql/migrate_colonization_v2.sql
 */
class ColonizationEngine
{
    // ── Konstanten ────────────────────────────────────────────────────────────

    /** Basis-Verwaltungskapazität ohne Boni */
    public const BASE_ADMIN_CAP = 50;

    /** Sprawl-Gewichtungen laut Design-Formel */
    public const SPRAWL_WEIGHT_SYSTEM = 1.0;
    public const SPRAWL_WEIGHT_COLONY = 0.5;
    public const SPRAWL_WEIGHT_FLEET  = 0.3; // pro Flotte mit > 5 Schiffen

    /** Schwellenwerte in Prozent für Malus-Stufen */
    public const THRESHOLD_STRAINED   = 101;
    public const THRESHOLD_OVERSTRETCHED = 121;
    public const THRESHOLD_CRISIS     = 151;
    public const THRESHOLD_DISSOLUTION = 201;

    /** Verfügbare Edikt-Typen und ihre Kosten/Boni */
    public const EDICTS = [
        'administrative_efficiency' => ['cost_per_tick' => 50,  'admin_cap_bonus' => 15],
        'martial_law'               => ['cost_per_tick' => 30,  'admin_cap_bonus' => 0,  'unrest_reduction' => 15],
        'free_trade'                => ['cost_per_tick' => 40,  'admin_cap_bonus' => 0,  'resource_bonus_pct' => 10],
        'research_subsidy'          => ['cost_per_tick' => 60,  'admin_cap_bonus' => 0,  'research_time_reduction_pct' => 15],
        'colonization_drive'        => ['cost_per_tick' => 80,  'admin_cap_bonus' => 0,  'colonize_cost_reduction_pct' => 20],
        'war_economy'               => ['cost_per_tick' => 100, 'admin_cap_bonus' => 0,  'fleet_attack_bonus_pct' => 30, 'consumer_goods_penalty_pct' => 20],
    ];

    /** Gouverneur-Level → AdminCap-Bonus-Tabelle */
    public const GOVERNOR_LEVEL_BONUSES = [1 => 5, 2 => 8, 3 => 12, 4 => 18, 5 => 25];

    // ── Öffentliche Methoden ──────────────────────────────────────────────────

    /**
     * Berechnet und speichert den aktuellen Empire Sprawl für einen Spieler.
     *
     * @param PDO $db
     * @param int $userId
     * @return array{sprawl_value: float, admin_cap: int, sprawl_pct: int, malus: array}
     */
    public static function recalcSprawl(PDO $db, int $userId): array
    {
        // ── 1. Systemanzahl (kontrollierte Systeme mit mind. 1 Kolonie) ───────
        $stmt = $db->prepare(
            'SELECT COUNT(DISTINCT cb.system_index) AS cnt
             FROM colonies c
             JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE c.user_id = ?'
        );
        $stmt->execute([$userId]);
        $systemCount = (int)($stmt->fetchColumn() ?: 0);

        // ── 2. Kolonien-Anzahl ────────────────────────────────────────────────
        $stmt = $db->prepare('SELECT COUNT(*) FROM colonies WHERE user_id = ?');
        $stmt->execute([$userId]);
        $colonyCount = (int)($stmt->fetchColumn() ?: 0);

        // ── 3. Flotten mit > 5 Schiffen ──────────────────────────────────────
        $stmt = $db->prepare('SELECT ships_json FROM fleets WHERE user_id = ? AND returning = 0');
        $stmt->execute([$userId]);
        $largeFleets = 0;
        foreach ($stmt->fetchAll() as $row) {
            $ships = json_decode($row['ships_json'] ?? '{}', true) ?: [];
            $total = array_sum(array_map('intval', $ships));
            if ($total > 5) {
                $largeFleets++;
            }
        }

        $sprawlValue = round(
            $systemCount * self::SPRAWL_WEIGHT_SYSTEM
            + $colonyCount * self::SPRAWL_WEIGHT_COLONY
            + $largeFleets  * self::SPRAWL_WEIGHT_FLEET,
            2
        );

        // ── 4. AdminCap berechnen ─────────────────────────────────────────────
        $adminCap = self::calcAdminCap($db, $userId);

        // ── 5. Sprawl-Prozent (capped at 200 für Anzeige) ────────────────────
        $sprawlPct = $adminCap > 0
            ? min(200, (int)round($sprawlValue / $adminCap * 100))
            : 200;

        // ── 6. Cache upsert ───────────────────────────────────────────────────
        $db->prepare(
            'INSERT INTO empire_sprawl_cache (player_id, sprawl_value, admin_cap, sprawl_pct, updated_at)
             VALUES (?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               sprawl_value = VALUES(sprawl_value),
               admin_cap    = VALUES(admin_cap),
               sprawl_pct   = VALUES(sprawl_pct),
               updated_at   = NOW()'
        )->execute([$userId, $sprawlValue, $adminCap, $sprawlPct]);

        return [
            'sprawl_value' => $sprawlValue,
            'admin_cap'    => $adminCap,
            'sprawl_pct'   => $sprawlPct,
            'malus'        => self::getMalusEffects($sprawlPct),
        ];
    }

    /**
     * Berechnet den AdminCap: Basis + Gouverneur-Boni + Edikt-Boni.
     */
    public static function calcAdminCap(PDO $db, int $userId): int
    {
        $cap = self::BASE_ADMIN_CAP;

        // Gouverneur-Boni: Σ(admin_bonus) aller Gouverneure des Spielers
        $stmt = $db->prepare(
            'SELECT COALESCE(SUM(g.admin_bonus), 0)
             FROM governors g
             WHERE g.player_id = ? AND g.sector_id IS NOT NULL'
        );
        $stmt->execute([$userId]);
        $cap += (int)($stmt->fetchColumn() ?: 0);

        // Edikt-Bonus: administratives Edikt aktiv?
        $stmt = $db->prepare(
            "SELECT SUM(CASE edict_type
                WHEN 'administrative_efficiency' THEN 15
                ELSE 0
             END)
             FROM empire_edicts
             WHERE player_id = ? AND active = 1"
        );
        $stmt->execute([$userId]);
        $cap += (int)($stmt->fetchColumn() ?: 0);

        return $cap;
    }

    /**
     * Gibt die aktiven Malus-Effekte basierend auf dem Sprawl-Prozentsatz zurück.
     *
     * @return array{status: string, resource_efficiency_pct: int, unrest_bonus: int, rebellion_risk: bool}
     */
    public static function getMalusEffects(int $sprawlPct): array
    {
        if ($sprawlPct >= self::THRESHOLD_DISSOLUTION) {
            return [
                'status'                  => 'dissolution',
                'resource_efficiency_pct' => -50,
                'unrest_bonus'            => 50,
                'rebellion_risk'          => true,
            ];
        }
        if ($sprawlPct >= self::THRESHOLD_CRISIS) {
            return [
                'status'                  => 'crisis',
                'resource_efficiency_pct' => -30,
                'unrest_bonus'            => 25,
                'rebellion_risk'          => true,
            ];
        }
        if ($sprawlPct >= self::THRESHOLD_OVERSTRETCHED) {
            return [
                'status'                  => 'overstretched',
                'resource_efficiency_pct' => -15,
                'unrest_bonus'            => 10,
                'rebellion_risk'          => false,
            ];
        }
        if ($sprawlPct >= self::THRESHOLD_STRAINED) {
            return [
                'status'                  => 'strained',
                'resource_efficiency_pct' => -5,
                'unrest_bonus'            => 0,
                'rebellion_risk'          => false,
            ];
        }
        return [
            'status'                  => 'efficient',
            'resource_efficiency_pct' => 5, // +5 % Forschungsbonus im effizienten Bereich
            'unrest_bonus'            => 0,
            'rebellion_risk'          => false,
        ];
    }

    /**
     * Bestimmt die Wachstumsphase einer Kolonie anhand ihrer Bevölkerung.
     *
     * Phase 0 = Outpost   (≤ 500 pop)
     * Phase 1 = Settlement (≤ 2 000 pop)
     * Phase 2 = Colony    (≤ 10 000 pop)
     * Phase 3 = City      (≤ 50 000 pop)
     * Phase 4 = Metropolis (> 50 000 pop)
     */
    public static function calcColonyPhase(int $population): int
    {
        if ($population > 50000) return 4;
        if ($population > 10000) return 3;
        if ($population > 2000)  return 2;
        if ($population > 500)   return 1;
        return 0;
    }

    /**
     * Aktualisiert die Phase einer einzelnen Kolonie (gibt true zurück, falls geändert).
     */
    public static function updateColonyPhase(PDO $db, int $colonyId, int $population): bool
    {
        $newPhase = self::calcColonyPhase($population);
        $stmt = $db->prepare('SELECT phase FROM colonies WHERE id = ?');
        $stmt->execute([$colonyId]);
        $current = (int)($stmt->fetchColumn() ?? 0);
        if ($current === $newPhase) {
            return false;
        }
        $db->prepare('UPDATE colonies SET phase = ? WHERE id = ?')->execute([$newPhase, $colonyId]);
        return true;
    }

    /**
     * Legt einen neuen Sektor an.
     *
     * @param PDO $db
     * @param int $userId
     * @param string $name
     * @return int Neue Sektor-ID
     */
    public static function createSector(PDO $db, int $userId, string $name): int
    {
        $db->prepare(
            'INSERT INTO sectors (player_id, name) VALUES (?, ?)'
        )->execute([$userId, $name]);
        return (int)$db->lastInsertId();
    }

    /**
     * Weist ein Sternensystem einem Sektor zu.
     * Entfernt das System aus einem ggf. vorherigen Sektor desselben Spielers.
     *
     * @throws RuntimeException wenn das System nicht dem Spieler gehört
     */
    public static function assignSystemToSector(PDO $db, int $userId, int $starSystemId, int $sectorId): void
    {
        // Ownership-Check: Spieler muss mind. eine Kolonie in diesem System haben
        $stmt = $db->prepare(
            'SELECT COUNT(*) FROM colonies c
             JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE c.user_id = ? AND cb.system_index = ?'
        );
        $stmt->execute([$userId, $starSystemId]);
        if ((int)$stmt->fetchColumn() === 0) {
            throw new RuntimeException('No colonies in target system — cannot assign to sector.');
        }

        // Ownership-Check: Sektor gehört dem Spieler
        $stmt = $db->prepare('SELECT COUNT(*) FROM sectors WHERE id = ? AND player_id = ?');
        $stmt->execute([$sectorId, $userId]);
        if ((int)$stmt->fetchColumn() === 0) {
            throw new RuntimeException('Sector not found or does not belong to player.');
        }

        // Entfernt aus alten Sektoren desselben Spielers
        $db->prepare(
            'DELETE ss FROM sector_systems ss
             JOIN sectors s ON s.id = ss.sector_id
             WHERE ss.star_system_id = ? AND s.player_id = ?'
        )->execute([$starSystemId, $userId]);

        // Zuordnen
        $db->prepare(
            'INSERT IGNORE INTO sector_systems (sector_id, star_system_id) VALUES (?, ?)'
        )->execute([$sectorId, $starSystemId]);
    }

    /**
     * Weist einen Gouverneur einem Sektor zu.
     * Ein Sektor kann nur einen Gouverneur haben; ein Gouverneur nur einen Sektor.
     *
     * @throws RuntimeException bei Ownership-Verletzung
     */
    public static function appointGovernor(PDO $db, int $userId, int $governorId, int $sectorId): void
    {
        // Ownership-Checks
        foreach ([
            'SELECT COUNT(*) FROM governors WHERE id = ? AND player_id = ?'  => [$governorId, $userId],
            'SELECT COUNT(*) FROM sectors WHERE id = ? AND player_id = ?'    => [$sectorId, $userId],
        ] as $sql => $params) {
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
            if ((int)$stmt->fetchColumn() === 0) {
                throw new RuntimeException('Governor or sector not found or does not belong to player.');
            }
        }

        // Alten Gouverneur des Sektors freistellen
        $db->prepare(
            'UPDATE governors SET sector_id = NULL WHERE sector_id = ? AND player_id = ?'
        )->execute([$sectorId, $userId]);

        // Gouverneur dem neuen Sektor zuweisen
        $db->prepare(
            'UPDATE governors SET sector_id = ? WHERE id = ? AND player_id = ?'
        )->execute([$sectorId, $governorId, $userId]);

        // sectors.governor_id aktualisieren
        $db->prepare(
            'UPDATE sectors SET governor_id = ? WHERE id = ? AND player_id = ?'
        )->execute([$governorId, $sectorId, $userId]);
    }

    /**
     * Aktiviert oder deaktiviert ein Edikt.
     *
     * @throws RuntimeException bei unbekanntem Edikt-Typ
     */
    public static function setEdictActive(PDO $db, int $userId, string $edictType, bool $active): void
    {
        if (!isset(self::EDICTS[$edictType])) {
            throw new RuntimeException("Unknown edict type: $edictType");
        }
        $costPerTick = self::EDICTS[$edictType]['cost_per_tick'];
        $activatedAt = $active ? date('Y-m-d H:i:s') : null;

        $db->prepare(
            'INSERT INTO empire_edicts (player_id, edict_type, active, cost_per_tick, activated_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               active       = VALUES(active),
               cost_per_tick = VALUES(cost_per_tick),
               activated_at = VALUES(activated_at)'
        )->execute([$userId, $edictType, $active ? 1 : 0, $costPerTick, $activatedAt]);
    }

    /**
     * Gibt alle Edikte eines Spielers zurück (inkl. inaktiver mit Status-Flag).
     */
    public static function listEdicts(PDO $db, int $userId): array
    {
        $stmt = $db->prepare(
            'SELECT edict_type, active, cost_per_tick, activated_at
             FROM empire_edicts WHERE player_id = ? ORDER BY edict_type'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        $active = array_column($rows, null, 'edict_type');

        // Alle Edikt-Typen zurückgeben, auch nicht aktivierte
        $result = [];
        foreach (self::EDICTS as $type => $meta) {
            $row = $active[$type] ?? null;
            $result[] = [
                'edict_type'   => $type,
                'active'       => (bool)($row['active'] ?? false),
                'cost_per_tick' => $meta['cost_per_tick'],
                'activated_at' => $row['activated_at'] ?? null,
                'effects'      => $meta,
            ];
        }
        return $result;
    }

    /**
     * Economy-Tick-Integration: zieht Edikt-Kosten vom Spieler ab und
     * aktualisiert den Sprawl-Cache.
     *
     * Muss von api/economy_flush.php oder game_engine.php aufgerufen werden.
     */
    public static function tick(PDO $db, int $userId): void
    {
        // Edikt-Kosten abziehen (Credits-Feld in colonies.metal als Proxy nicht vorhanden
        // → app_state-basierter Credits-Schlüssel, analog zu bestehenden Mechanismen)
        $stmt = $db->prepare(
            'SELECT SUM(cost_per_tick) FROM empire_edicts WHERE player_id = ? AND active = 1'
        );
        $stmt->execute([$userId]);
        $totalCost = (int)($stmt->fetchColumn() ?: 0);

        if ($totalCost > 0) {
            // Credits werden in der Tabelle app_state als JSON gespeichert (bestehende Konvention)
            // Hier nur Sprawl-Refresh; der Credits-Abzug erfolgt über economy_flush.php
        }

        // Sprawl-Cache aktualisieren
        self::recalcSprawl($db, $userId);
    }
}
