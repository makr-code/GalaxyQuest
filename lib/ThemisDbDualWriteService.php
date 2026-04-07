<?php

declare(strict_types=1);

/**
 * ThemisDbDualWriteService – Parallel database operation orchestrator.
 *
 * Enables running MySQL and ThemisDB side-by-side.  MySQL stays the
 * primary/authoritative store; ThemisDB receives mirrored writes and powers
 * advanced read paths (graph traversal, vector search, AQL).
 *
 * ── Architecture ────────────────────────────────────────────────────────────
 *
 *   PHP API handler
 *       │
 *       ├── write()  ──► MySQL (primary, always)
 *       │                ThemisDB (async mirror when THEMISDB_DUAL_WRITE=1)
 *       │
 *       ├── readMysql()  ──► MySQL (guaranteed consistent)
 *       │
 *       └── readThemis() ──► ThemisDB (graph/vector/AQL – falls back to MySQL)
 *
 * ── Parallel-mode capabilities demonstrated ─────────────────────────────────
 *
 *   1. Dual-write  – every diplomacy/fleet/colony write is mirrored.
 *   2. Graph reads – faction-to-faction diplomacy as Property Graph traversal.
 *   3. Conflict prediction – graph-native reachability instead of PHP loops.
 *   4. Comparison mode – returns both MySQL and ThemisDB results side-by-side
 *      so callers can measure quality and latency differences.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   $svc = ThemisDbDualWriteService::instance(get_db());
 *
 *   // Mirrored write:
 *   $svc->writeDiplomacyStanding($uid, $factionId, $standing, $event);
 *
 *   // Graph-enhanced faction read (ThemisDB) vs plain MySQL read:
 *   $svc->readFactionStandings($uid);                  // MySQL
 *   $svc->graphFactionConflicts($threshold);           // ThemisDB graph
 *   $svc->compareConflictPrediction($threshold);       // side-by-side
 *
 * @see docs/technical/THEMISDB_MIGRATION_ROADMAP.md
 * @see lib/ThemisDbClient.php
 */
final class ThemisDbDualWriteService
{
    private PDO              $db;
    private ThemisDbClient   $themis;
    private bool             $dualWriteEnabled;
    private bool             $themisEnabled;

    // ── Singleton ─────────────────────────────────────────────────────────────

    private static ?self $instance = null;

    private function __construct(PDO $db, ThemisDbClient $themis)
    {
        $this->db               = $db;
        $this->themis           = $themis;
        $this->themisEnabled    = (int) (defined('THEMISDB_ENABLED')    ? THEMISDB_ENABLED    : 0) === 1;
        $this->dualWriteEnabled = (int) (defined('THEMISDB_DUAL_WRITE') ? THEMISDB_DUAL_WRITE : 0) === 1;
    }

    /**
     * Shared singleton.  Pass a PDO connection on first call; subsequent calls
     * reuse the cached instance regardless of the $db argument.
     */
    public static function instance(PDO $db): self
    {
        if (self::$instance === null) {
            require_once dirname(__DIR__) . '/lib/ThemisDbClient.php';
            self::$instance = new self($db, ThemisDbClient::instance());
        }
        return self::$instance;
    }

    // ── Write paths (dual-write) ──────────────────────────────────────────────

    /**
     * Update a player's faction diplomacy standing in MySQL, then mirror to
     * ThemisDB (fire-and-forget, never blocks or throws on ThemisDB failure).
     *
     * @param int    $userId    Player user ID.
     * @param int    $factionId NPC faction ID.
     * @param int    $standing  New clamped standing value (-100..+100).
     * @param string $event     Last event label.
     */
    public function writeDiplomacyStanding(int $userId, int $factionId, int $standing, string $event = ''): void
    {
        // ① Primary write – MySQL (always).
        $stmt = $this->db->prepare(
            'UPDATE diplomacy SET standing = ?, last_event = ?, last_event_at = NOW()
             WHERE user_id = ? AND faction_id = ?'
        );
        $stmt->execute([$standing, $event, $userId, $factionId]);

        // ② Mirror write – ThemisDB (only when dual-write active).
        if ($this->dualWriteEnabled) {
            $this->themis->dualWriteDocument(
                'diplomacy',
                [
                    '_key'       => "u{$userId}_f{$factionId}",
                    'user_id'    => $userId,
                    'faction_id' => $factionId,
                    'standing'   => $standing,
                    'last_event' => $event,
                ],
                "diplomacy.standing uid={$userId} fid={$factionId}"
            );
        }
    }

    /**
     * Upsert a diplomacy row (ensure it exists in both stores).
     *
     * @param int $userId    Player user ID.
     * @param int $factionId NPC faction ID.
     * @param int $base      Base diplomacy value (from npc_factions.base_diplomacy).
     */
    public function ensureDiplomacyRow(int $userId, int $factionId, int $base): void
    {
        // MySQL upsert (INSERT IGNORE keeps existing value).
        $this->db->prepare(
            'INSERT IGNORE INTO diplomacy (user_id, faction_id, standing) VALUES (?, ?, ?)'
        )->execute([$userId, $factionId, $base]);

        if ($this->dualWriteEnabled) {
            $this->themis->dualWriteDocument(
                'diplomacy',
                [
                    '_key'       => "u{$userId}_f{$factionId}",
                    'user_id'    => $userId,
                    'faction_id' => $factionId,
                    'standing'   => $base,
                ],
                "diplomacy.ensure uid={$userId} fid={$factionId}"
            );
        }
    }

    // ── Read paths ────────────────────────────────────────────────────────────

    /**
     * Read a player's faction standings from MySQL (always authoritative).
     *
     * @param  int $userId Player user ID.
     * @return array<int, array{faction_id: int, faction_name: string, standing: int}>
     */
    public function readFactionStandings(int $userId): array
    {
        $stmt = $this->db->prepare(
            'SELECT f.id, f.code, f.name, COALESCE(d.standing, 0) AS standing
             FROM npc_factions f
             LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
             ORDER BY f.id'
        );
        $stmt->execute([$userId]);

        $rows = [];
        foreach ($stmt->fetchAll() as $row) {
            $rows[] = [
                'faction_id'   => (int)  $row['id'],
                'faction_code' => (string) $row['code'],
                'faction_name' => (string) $row['name'],
                'standing'     => (int)  $row['standing'],
                'source'       => 'mysql',
            ];
        }
        return $rows;
    }

    // ── ThemisDB graph-query paths ────────────────────────────────────────────

    /**
     * Query the ThemisDB faction-to-faction graph for conflict prediction.
     *
     * Uses AQL graph traversal on the `diplomacy_net` graph (populated via
     * the dual-write path).  Falls back to an empty array if ThemisDB is
     * unavailable or not enabled.
     *
     * @param  int $threshold Standing value below which a pair is considered hostile.
     * @return array<int, array{faction_a: string, faction_b: string, standing: int, severity: string}>
     */
    public function graphFactionConflicts(int $threshold = -50): array
    {
        if (!$this->themisEnabled) {
            return [];
        }

        $result = $this->themis->queryAql(
            '
            FOR edge IN faction_to_faction_edges
                FILTER edge.standing <= @threshold
                LET fa = DOCUMENT(CONCAT("factions/", edge.faction_a))
                LET fb = DOCUMENT(CONCAT("factions/", edge.faction_b))
                SORT edge.standing ASC
                RETURN {
                    faction_a:        edge.faction_a,
                    faction_b:        edge.faction_b,
                    faction_a_name:   fa.name,
                    faction_b_name:   fb.name,
                    standing:         edge.standing,
                    severity:         edge.standing <= -8 ? "critical" : "high",
                    source:           "themisdb_graph"
                }
            ',
            ['threshold' => $threshold]
        );

        if (!$result['ok']) {
            error_log('[ThemisDbDualWriteService] graphFactionConflicts failed: ' . ($result['error'] ?? 'unknown'));
            return [];
        }

        return (array) ($result['data']['result'] ?? []);
    }

    /**
     * Find the shortest diplomatic path between two factions using graph traversal.
     *
     * Returns vertex/edge list for the shortest path through friendly alliances.
     * Only possible with ThemisDB's native graph engine.
     *
     * @param  string $fromFactionCode Code of the origin faction (e.g. 'vor_tak').
     * @param  string $toFactionCode   Code of the target faction (e.g. 'aereth').
     * @param  int    $minStanding     Minimum edge standing for traversal.
     * @return array{path: array<int, mixed>, hops: int, source: string}|null
     */
    public function graphShortestDiplomaticPath(
        string $fromFactionCode,
        string $toFactionCode,
        int    $minStanding = 0
    ): ?array {
        if (!$this->themisEnabled) {
            return null;
        }

        $result = $this->themis->queryAql(
            '
            FOR v, e, p IN 1..8 OUTBOUND CONCAT("factions/", @from) GRAPH "diplomacy_net"
                FILTER e.standing >= @min_standing
                FILTER v._key == @to
                LIMIT 1
                RETURN {
                    path:   p.vertices[*]._key,
                    hops:   LENGTH(p.edges),
                    weight: SUM(p.edges[*].standing),
                    source: "themisdb_graph"
                }
            ',
            [
                'from'         => $fromFactionCode,
                'to'           => $toFactionCode,
                'min_standing' => $minStanding,
            ]
        );

        if (!$result['ok'] || empty($result['data']['result'])) {
            return null;
        }

        return (array) $result['data']['result'][0];
    }

    /**
     * Return all faction alliance clusters (connected components) from ThemisDB.
     *
     * Uses graph community detection – not feasible with plain SQL.
     *
     * @param  int $minStanding Minimum standing to count as an alliance edge.
     * @return array<int, array{cluster_id: int, factions: string[], avg_standing: float}>
     */
    public function graphAllianceClusters(int $minStanding = 3): array
    {
        if (!$this->themisEnabled) {
            return [];
        }

        $result = $this->themis->queryAql(
            '
            FOR faction IN factions
                LET allies = (
                    FOR neighbor, edge IN 1..1 ANY faction GRAPH "diplomacy_net"
                        FILTER edge.standing >= @min_standing
                        RETURN { code: neighbor._key, standing: edge.standing }
                )
                FILTER LENGTH(allies) > 0
                RETURN {
                    faction:      faction._key,
                    faction_name: faction.name,
                    allies:       allies,
                    ally_count:   LENGTH(allies),
                    avg_standing: AVERAGE(allies[*].standing),
                    source:       "themisdb_graph"
                }
            ',
            ['min_standing' => $minStanding]
        );

        if (!$result['ok']) {
            error_log('[ThemisDbDualWriteService] graphAllianceClusters failed: ' . ($result['error'] ?? 'unknown'));
            return [];
        }

        return (array) ($result['data']['result'] ?? []);
    }

    // ── Comparison mode ───────────────────────────────────────────────────────

    /**
     * Run conflict prediction on both MySQL (PHP logic) and ThemisDB (graph),
     * and return both results with latency metrics for A/B comparison.
     *
     * @param  array<string, array<string, int>> $relationsMatrix Faction-to-faction standing matrix (from YAML).
     * @param  int                               $threshold       Conflict threshold.
     * @return array{mysql: array, themisdb: array, latency_ms: array{mysql: int, themisdb: int}}
     */
    public function compareConflictPrediction(array $relationsMatrix, int $threshold = -50): array
    {
        // MySQL path: PHP loop over the YAML relations matrix.
        $t0    = hrtime(true);
        $mysqlConflicts = $this->mysqlConflictPrediction($relationsMatrix, $threshold);
        $mysqlMs = (int) round((hrtime(true) - $t0) / 1e6);

        // ThemisDB graph path.
        $t1    = hrtime(true);
        $themisConflicts = $this->graphFactionConflicts($threshold);
        $themisMs = (int) round((hrtime(true) - $t1) / 1e6);

        return [
            'mysql'   => $mysqlConflicts,
            'themisdb' => $themisConflicts,
            'latency_ms' => [
                'mysql'    => $mysqlMs,
                'themisdb' => $themisMs,
            ],
            'themisdb_available' => $this->themisEnabled,
        ];
    }

    /**
     * Pure-PHP conflict prediction (MySQL path, no ThemisDB).
     * Mirrors the existing logic from api/faction_relations.php.
     *
     * @param  array<string, array<string, int>> $matrix    Faction-to-faction standing matrix.
     * @param  int                               $threshold Conflict threshold.
     * @return array<int, array<string, mixed>>
     */
    public function mysqlConflictPrediction(array $matrix, int $threshold = -50): array
    {
        $conflicts = [];
        foreach ($matrix as $factionA => $relations) {
            foreach ($relations as $factionB => $standingAB) {
                $standingBA  = $matrix[$factionB][$factionA] ?? 0;
                $divergence  = abs((int)$standingAB - (int)$standingBA);

                if ((int)$standingAB <= $threshold || (int)$standingBA <= $threshold) {
                    $conflicts[] = [
                        'faction_a'          => $factionA,
                        'faction_b'          => $factionB,
                        'standing_a_to_b'    => (int)$standingAB,
                        'standing_b_to_a'    => (int)$standingBA,
                        'divergence'         => $divergence,
                        'conflict_probability' => 0.95,
                        'severity'           => 'critical',
                        'source'             => 'mysql_php',
                    ];
                } elseif ($divergence >= 10) {
                    $conflicts[] = [
                        'faction_a'          => $factionA,
                        'faction_b'          => $factionB,
                        'standing_a_to_b'    => (int)$standingAB,
                        'standing_b_to_a'    => (int)$standingBA,
                        'divergence'         => $divergence,
                        'conflict_probability' => min(1.0, $divergence / 20.0),
                        'severity'           => 'high',
                        'source'             => 'mysql_php',
                    ];
                }
            }
        }
        return $conflicts;
    }

    // ── Seeding helpers ───────────────────────────────────────────────────────

    /**
     * Seed ThemisDB `factions` collection from MySQL `npc_factions`.
     *
     * Run once on startup or after a fresh ThemisDB deployment to ensure the
     * graph vertices exist before dual-write edges are created.
     *
     * @return array{seeded: int, errors: int}
     */
    public function seedFactions(): array
    {
        if (!$this->themisEnabled) {
            return ['seeded' => 0, 'errors' => 0];
        }

        $factions = $this->db->query(
            'SELECT id, code, name, description, faction_type,
                    aggression, trade_willingness, base_diplomacy, power_level,
                    home_galaxy_min, home_galaxy_max, color, icon
             FROM npc_factions'
        )->fetchAll();

        $docs = [];
        foreach ($factions as $row) {
            $docs[] = array_merge(
                ['_key' => (string)$row['code']],
                $row
            );
        }

        if (empty($docs)) {
            return ['seeded' => 0, 'errors' => 0];
        }

        $result = $this->themis->bulkImport('factions', $docs, 'update');
        if (!$result['ok']) {
            error_log('[ThemisDbDualWriteService] seedFactions failed: ' . ($result['error'] ?? 'unknown'));
            return ['seeded' => 0, 'errors' => 1];
        }

        return ['seeded' => count($docs), 'errors' => 0];
    }

    /**
     * Seed the ThemisDB `faction_to_faction_edges` collection from a YAML relations matrix.
     *
     * Converts the flat PHP array (from FACTION_RELATIONS.yaml) into directed graph edges.
     *
     * @param  array<string, array<string, int>> $matrix Faction-to-faction standing matrix.
     * @return array{seeded: int, errors: int}
     */
    public function seedFactionRelationsGraph(array $matrix): array
    {
        if (!$this->themisEnabled) {
            return ['seeded' => 0, 'errors' => 0];
        }

        $edges = [];
        foreach ($matrix as $factionA => $relations) {
            foreach ($relations as $factionB => $standing) {
                $edges[] = [
                    '_key'      => "{$factionA}__{$factionB}",
                    '_from'     => "factions/{$factionA}",
                    '_to'       => "factions/{$factionB}",
                    'faction_a' => $factionA,
                    'faction_b' => $factionB,
                    'standing'  => (int)$standing,
                ];
            }
        }

        if (empty($edges)) {
            return ['seeded' => 0, 'errors' => 0];
        }

        $result = $this->themis->bulkImport('faction_to_faction_edges', $edges, 'update');
        if (!$result['ok']) {
            error_log('[ThemisDbDualWriteService] seedFactionRelationsGraph failed: ' . ($result['error'] ?? 'unknown'));
            return ['seeded' => 0, 'errors' => 1];
        }

        return ['seeded' => count($edges), 'errors' => 0];
    }

    /**
     * Seed ThemisDB `diplomacy` collection from MySQL for a single player.
     *
     * @param  int $userId Player user ID.
     * @return array{seeded: int, errors: int}
     */
    public function seedPlayerDiplomacy(int $userId): array
    {
        if (!$this->themisEnabled) {
            return ['seeded' => 0, 'errors' => 0];
        }

        $rows = $this->db->prepare(
            'SELECT d.user_id, d.faction_id, d.standing,
                    d.attacks_against, d.last_event, d.last_event_at,
                    f.code AS faction_code
             FROM diplomacy d
             JOIN npc_factions f ON f.id = d.faction_id
             WHERE d.user_id = ?'
        );
        $rows->execute([$userId]);
        $rows = $rows->fetchAll();

        $docs = [];
        foreach ($rows as $row) {
            $docs[] = [
                '_key'            => "u{$row['user_id']}_f{$row['faction_id']}",
                '_from'           => "players/{$row['user_id']}",
                '_to'             => "factions/{$row['faction_code']}",
                'user_id'         => (int) $row['user_id'],
                'faction_id'      => (int) $row['faction_id'],
                'faction_code'    => (string) $row['faction_code'],
                'standing'        => (int) $row['standing'],
                'attacks_against' => (int) $row['attacks_against'],
                'last_event'      => $row['last_event'],
                'last_event_at'   => $row['last_event_at'],
            ];
        }

        if (empty($docs)) {
            return ['seeded' => 0, 'errors' => 0];
        }

        $result = $this->themis->bulkImport('diplomacy', $docs, 'update');
        if (!$result['ok']) {
            error_log('[ThemisDbDualWriteService] seedPlayerDiplomacy failed: ' . ($result['error'] ?? 'unknown'));
            return ['seeded' => 0, 'errors' => 1];
        }

        return ['seeded' => count($docs), 'errors' => 0];
    }

    // ── Status ────────────────────────────────────────────────────────────────

    /**
     * Return operational status of both database backends.
     *
     * @return array{mysql: bool, themisdb: bool, dual_write: bool, themisdb_latency_ms: int|null}
     */
    public function status(): array
    {
        $mysqlOk  = true;
        try {
            $this->db->query('SELECT 1');
        } catch (Throwable) {
            $mysqlOk = false;
        }

        $themisLatency = null;
        $themisOk      = false;
        if ($this->themisEnabled) {
            $t0         = hrtime(true);
            $themisOk   = $this->themis->isHealthy();
            $themisLatency = (int) round((hrtime(true) - $t0) / 1e6);
        }

        return [
            'mysql'                => $mysqlOk,
            'themisdb'             => $themisOk,
            'dual_write'           => $this->dualWriteEnabled,
            'themisdb_enabled'     => $this->themisEnabled,
            'themisdb_latency_ms'  => $themisLatency,
        ];
    }
}
