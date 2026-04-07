<?php

declare(strict_types=1);

/**
 * ScenarioEngine
 *
 * Core of the Random-Event-Driven-Conclusion System (REDCS).
 *
 * Responsibilities:
 *  - Load scenario definitions from YAML files (via MiniYamlParser)
 *  - Seed them into the `world_scenarios` DB table
 *  - Run a global tick: resolve expired events, roll for new scenario starts
 *  - Apply conclusion effects (standing deltas, quest spawns, galactic_events entries)
 *
 * Usage (from npc_ai.php faction_events_tick_global):
 *   ScenarioEngine::tick($db, __DIR__ . '/../../scenarios');
 */
final class ScenarioEngine
{
    // ── Constants ─────────────────────────────────────────────────────────────

    /** Minimum seconds between global scenario-engine ticks (1 hour). */
    private const TICK_COOLDOWN_SECONDS = 3600;

    /** app_state key for last global tick timestamp. */
    private const STATE_KEY_LAST_TICK = 'scenario_engine:last_tick';

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Entry point called by npc_ai.php once per hour (globally rate-limited).
     *
     * @param PDO    $db           Active database connection
     * @param string $scenariosDir Absolute path to the scenarios/ directory
     */
    public static function tick(PDO $db, string $scenariosDir): void
    {
        if (!self::isTickDue($db)) {
            return;
        }
        self::markTick($db);

        self::ensureTables($db);

        // 1. Resolve any expired active events
        self::resolveExpiredEvents($db);

        // 2. Load scenario definitions and try to start new ones
        $scenarios = self::loadScenariosFromYaml($scenariosDir);
        foreach ($scenarios as $scenario) {
            self::seedScenario($db, $scenario);
            self::maybeStartScenario($db, $scenario);
        }
    }

    /**
     * Load all *.yaml files from the given directory and parse them.
     *
     * @param  string                    $scenariosDir
     * @return array<int, array<string, mixed>>
     */
    public static function loadScenariosFromYaml(string $scenariosDir): array
    {
        if (!is_dir($scenariosDir)) {
            return [];
        }

        $parser = new MiniYamlParser();
        $scenarios = [];

        foreach (glob($scenariosDir . '/*.yaml') ?: [] as $file) {
            try {
                $raw = file_get_contents($file);
                if ($raw === false) {
                    continue;
                }
                $data = $parser->parse($raw);
                if (!empty($data['code'])) {
                    $scenarios[] = $data;
                }
            } catch (\Throwable $e) {
                error_log('[ScenarioEngine] Failed to parse ' . basename($file) . ': ' . $e->getMessage());
            }
        }

        return $scenarios;
    }

    /**
     * Write (or update) a scenario definition into the world_scenarios table.
     *
     * @param PDO                  $db
     * @param array<string, mixed> $scenario Parsed YAML data
     */
    public static function seedScenario(PDO $db, array $scenario): void
    {
        $code = (string) ($scenario['code'] ?? '');
        if ($code === '') {
            return;
        }

        $factionId = self::resolveFactionId($db, (string) ($scenario['faction_code'] ?? ''));

        $trigger        = is_array($scenario['trigger'] ?? null) ? $scenario['trigger'] : [];
        $triggerChance  = (float) ($trigger['chance'] ?? 0.05);
        $triggerCooldown = (int) ($trigger['cooldown_hours'] ?? 72);
        $minProgress    = (int) ($trigger['min_player_progress'] ?? 0);

        $phases      = is_array($scenario['phases'] ?? null) ? $scenario['phases'] : [];
        $conclusions = is_array($scenario['conclusions'] ?? null) ? $scenario['conclusions'] : [];
        $effects     = is_array($scenario['effects'] ?? null) ? $scenario['effects'] : [];

        $db->prepare(
            'INSERT INTO world_scenarios
                (code, faction_id, title_de, description_de,
                 duration_hours, trigger_chance, trigger_cooldown_hours, min_player_progress,
                 phases_json, conclusions_json, effects_json, llm_prompt_key, active)
             VALUES
                (:code, :faction_id, :title_de, :description_de,
                 :duration_hours, :trigger_chance, :trigger_cooldown_hours, :min_player_progress,
                 :phases_json, :conclusions_json, :effects_json, :llm_prompt_key, 1)
             ON DUPLICATE KEY UPDATE
                faction_id                 = VALUES(faction_id),
                title_de                   = VALUES(title_de),
                description_de             = VALUES(description_de),
                duration_hours             = VALUES(duration_hours),
                trigger_chance             = VALUES(trigger_chance),
                trigger_cooldown_hours     = VALUES(trigger_cooldown_hours),
                min_player_progress        = VALUES(min_player_progress),
                phases_json                = VALUES(phases_json),
                conclusions_json           = VALUES(conclusions_json),
                effects_json               = VALUES(effects_json),
                llm_prompt_key             = VALUES(llm_prompt_key),
                active                     = VALUES(active)'
        )->execute([
            ':code'                     => $code,
            ':faction_id'               => $factionId,
            ':title_de'                 => (string) ($scenario['title_de'] ?? $code),
            ':description_de'           => (string) ($scenario['description_de'] ?? ''),
            ':duration_hours'           => (int) ($scenario['duration_hours'] ?? 24),
            ':trigger_chance'           => $triggerChance,
            ':trigger_cooldown_hours'   => $triggerCooldown,
            ':min_player_progress'      => $minProgress,
            ':phases_json'              => json_encode($phases, JSON_UNESCAPED_UNICODE),
            ':conclusions_json'         => json_encode($conclusions, JSON_UNESCAPED_UNICODE),
            ':effects_json'             => json_encode($effects, JSON_UNESCAPED_UNICODE),
            ':llm_prompt_key'           => ($scenario['llm_prompt_key'] ?? null) ?: null,
        ]);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static function isTickDue(PDO $db): bool
    {
        if (!function_exists('app_state_get_int')) {
            return false;
        }
        $last = app_state_get_int($db, self::STATE_KEY_LAST_TICK, 0);
        return (time() - $last) >= self::TICK_COOLDOWN_SECONDS;
    }

    private static function markTick(PDO $db): void
    {
        if (function_exists('app_state_set_int')) {
            app_state_set_int($db, self::STATE_KEY_LAST_TICK, time());
        }
    }

    /**
     * Ensure required tables exist (graceful degradation on old installs).
     */
    private static function ensureTables(PDO $db): void
    {
        try {
            $db->exec(
                'CREATE TABLE IF NOT EXISTS galactic_events (
                    id              INT AUTO_INCREMENT PRIMARY KEY,
                    event_type      VARCHAR(64) NOT NULL,
                    faction_id      INT DEFAULT NULL,
                    source_user_id  INT DEFAULT NULL,
                    description     TEXT,
                    modifier_key    VARCHAR(64),
                    modifier_value  DECIMAL(9,4),
                    affected_scope  ENUM(\'cluster\',\'sector\',\'galaxy\') NOT NULL DEFAULT \'cluster\',
                    starts_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ends_at         DATETIME NOT NULL,
                    is_visible      TINYINT(1) NOT NULL DEFAULT 1,
                    INDEX idx_ge_faction    (faction_id),
                    INDEX idx_ge_scope_time (affected_scope, ends_at)
                ) ENGINE=InnoDB'
            );
            $db->exec(
                'CREATE TABLE IF NOT EXISTS world_scenarios (
                    id                       INT AUTO_INCREMENT PRIMARY KEY,
                    code                     VARCHAR(64) NOT NULL UNIQUE,
                    faction_id               INT DEFAULT NULL,
                    title_de                 VARCHAR(128) NOT NULL,
                    description_de           TEXT NOT NULL,
                    duration_hours           SMALLINT UNSIGNED NOT NULL DEFAULT 24,
                    trigger_chance           DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
                    trigger_cooldown_hours   SMALLINT UNSIGNED NOT NULL DEFAULT 72,
                    min_player_progress      TINYINT UNSIGNED NOT NULL DEFAULT 0,
                    phases_json              TEXT NOT NULL DEFAULT \'[]\',
                    conclusions_json         TEXT NOT NULL DEFAULT \'[]\',
                    effects_json             TEXT NOT NULL DEFAULT \'{}\',
                    llm_prompt_key           VARCHAR(64) DEFAULT NULL,
                    active                   TINYINT(1) NOT NULL DEFAULT 1,
                    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB'
            );
            $db->exec(
                'CREATE TABLE IF NOT EXISTS active_world_events (
                    id               INT AUTO_INCREMENT PRIMARY KEY,
                    scenario_id      INT NOT NULL,
                    phase            TINYINT UNSIGNED NOT NULL DEFAULT 0,
                    started_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ends_at          DATETIME NOT NULL,
                    conclusion_key   VARCHAR(64) DEFAULT NULL,
                    resolved_at      DATETIME DEFAULT NULL,
                    effects_applied  TINYINT(1) NOT NULL DEFAULT 0,
                    flavor_text      TEXT DEFAULT NULL,
                    INDEX idx_awe_open     (conclusion_key, ends_at),
                    INDEX idx_awe_scenario (scenario_id)
                ) ENGINE=InnoDB'
            );
        } catch (\Throwable $e) {
            error_log('[ScenarioEngine] ensureTables error: ' . $e->getMessage());
        }
    }

    /**
     * Resolve all active events whose end time has passed.
     */
    private static function resolveExpiredEvents(PDO $db): void
    {
        try {
            $stmt = $db->prepare(
                'SELECT awe.*, ws.conclusions_json, ws.effects_json, ws.code AS scenario_code,
                        ws.faction_id AS scenario_faction_id
                 FROM active_world_events awe
                 JOIN world_scenarios ws ON ws.id = awe.scenario_id
                 WHERE awe.conclusion_key IS NULL
                   AND awe.ends_at <= NOW()'
            );
            $stmt->execute();
            $expired = $stmt->fetchAll(\PDO::FETCH_ASSOC);

            foreach ($expired as $event) {
                self::resolveConclusion($db, $event);
            }
        } catch (\Throwable $e) {
            error_log('[ScenarioEngine] resolveExpiredEvents error: ' . $e->getMessage());
        }
    }

    /**
     * Roll the dice on starting a scenario:
     *  - scenario must be active in DB
     *  - no other instance currently running (conclusion_key IS NULL)
     *  - cooldown since last completion respected
     *  - random trigger chance passes
     *
     * @param PDO                  $db
     * @param array<string, mixed> $scenario YAML data
     */
    private static function maybeStartScenario(PDO $db, array $scenario): void
    {
        $code = (string) ($scenario['code'] ?? '');
        if ($code === '') {
            return;
        }

        try {
            // Load DB record
            $row = $db->prepare('SELECT * FROM world_scenarios WHERE code = ? AND active = 1');
            $row->execute([$code]);
            $dbScenario = $row->fetch(\PDO::FETCH_ASSOC);
            if (!$dbScenario) {
                return;
            }

            // Check if already running
            $running = $db->prepare(
                'SELECT COUNT(*) FROM active_world_events awe
                 WHERE awe.scenario_id = ? AND awe.conclusion_key IS NULL'
            );
            $running->execute([(int) $dbScenario['id']]);
            if ((int) $running->fetchColumn() > 0) {
                return;
            }

            // Cooldown: time since last resolved event of this scenario
            $cooldownHours = max(1, (int) $dbScenario['trigger_cooldown_hours']);
            $lastResolved = $db->prepare(
                'SELECT MAX(resolved_at) FROM active_world_events
                 WHERE scenario_id = ? AND conclusion_key IS NOT NULL'
            );
            $lastResolved->execute([(int) $dbScenario['id']]);
            $lastResolvedAt = $lastResolved->fetchColumn();
            if ($lastResolvedAt) {
                $secondsAgo = time() - strtotime((string) $lastResolvedAt);
                if ($secondsAgo < $cooldownHours * 3600) {
                    return;
                }
            }

            // Random roll
            $chance = (float) $dbScenario['trigger_chance'];
            if ($chance <= 0.0 || (mt_rand(1, 10000) / 10000.0) > $chance) {
                return;
            }

            self::startScenario($db, $dbScenario);
        } catch (\Throwable $e) {
            error_log('[ScenarioEngine] maybeStartScenario(' . $code . ') error: ' . $e->getMessage());
        }
    }

    /**
     * Persist a new active_world_events row for the given scenario.
     *
     * @param PDO                  $db
     * @param array<string, mixed> $dbScenario Row from world_scenarios table
     */
    public static function startScenario(PDO $db, array $dbScenario): void
    {
        $scenarioId    = (int) $dbScenario['id'];
        $durationHours = max(1, (int) ($dbScenario['duration_hours'] ?? 24));
        $endsAt        = date('Y-m-d H:i:s', time() + $durationHours * 3600);

        $db->prepare(
            'INSERT INTO active_world_events (scenario_id, phase, started_at, ends_at)
             VALUES (?, 0, NOW(), ?)'
        )->execute([$scenarioId, $endsAt]);

        $eventId = (int) $db->lastInsertId();
        error_log('[ScenarioEngine] Started scenario id=' . $scenarioId
            . ' code=' . ($dbScenario['code'] ?? '?')
            . ' event_id=' . $eventId
            . ' ends_at=' . $endsAt);

        // Publish pending SSE notification via app_state so events.php can pick it up
        self::publishSsePending($db, $scenarioId, $eventId, $dbScenario, 0, null);
    }

    /**
     * Select a conclusion for an expired event and apply its effects.
     *
     * @param PDO                  $db
     * @param array<string, mixed> $event Row from active_world_events JOIN world_scenarios
     */
    public static function resolveConclusion(PDO $db, array $event): void
    {
        $eventId    = (int) $event['id'];
        $scenarioId = (int) $event['scenario_id'];

        $conclusions = json_decode((string) ($event['conclusions_json'] ?? '[]'), true) ?: [];
        $effectsMap  = json_decode((string) ($event['effects_json'] ?? '{}'), true) ?: [];

        // Pick conclusion by weighted random
        $conclusionKey = self::pickConclusion($db, $conclusions);
        if ($conclusionKey === null) {
            // Fallback: pick the highest-weight conclusion without condition
            $conclusionKey = 'none';
        }

        // Mark event as resolved
        $db->prepare(
            'UPDATE active_world_events
             SET conclusion_key = ?, resolved_at = NOW(), effects_applied = 0
             WHERE id = ?'
        )->execute([$conclusionKey, $eventId]);

        // Apply effects
        $effects = is_array($effectsMap[$conclusionKey] ?? null) ? $effectsMap[$conclusionKey] : [];
        self::applyEffects($db, $effects, $event);

        // Mark effects as applied
        $db->prepare(
            'UPDATE active_world_events SET effects_applied = 1 WHERE id = ?'
        )->execute([$eventId]);

        error_log('[ScenarioEngine] Resolved event id=' . $eventId
            . ' scenario=' . ($event['scenario_code'] ?? '?')
            . ' conclusion=' . $conclusionKey);

        // Publish SSE notification for conclusion
        $dbScenario = ['id' => $scenarioId, 'code' => $event['scenario_code'] ?? ''];
        self::publishSsePending($db, $scenarioId, $eventId, $dbScenario, (int) $event['phase'], $conclusionKey);
    }

    /**
     * Weighted random selection of a conclusion key.
     * Conclusions with unmet conditions are skipped.
     *
     * @param PDO                       $db
     * @param array<int, array<string, mixed>> $conclusions Parsed conclusions_json
     * @return string|null Selected conclusion key, or null if none eligible
     */
    private static function pickConclusion(PDO $db, array $conclusions): ?string
    {
        $eligible = [];
        $totalWeight = 0;

        foreach ($conclusions as $c) {
            $key    = (string) ($c['key'] ?? '');
            $weight = (int) ($c['weight'] ?? 0);
            if ($key === '' || $weight <= 0) {
                continue;
            }
            if (!self::evaluateCondition($db, $c['condition'] ?? null)) {
                continue;
            }
            $eligible[] = ['key' => $key, 'weight' => $weight];
            $totalWeight += $weight;
        }

        if (empty($eligible) || $totalWeight <= 0) {
            return null;
        }

        $roll = mt_rand(1, $totalWeight);
        $cumulative = 0;
        foreach ($eligible as $e) {
            $cumulative += $e['weight'];
            if ($roll <= $cumulative) {
                return $e['key'];
            }
        }

        return $eligible[count($eligible) - 1]['key'];
    }

    /**
     * Evaluate a conclusion condition.  Returns true when the condition passes
     * (i.e. the conclusion is eligible).
     *
     * Supported condition types:
     *   - null/missing → always eligible
     *   - faction_standing_threshold  (scope: any_player | all_players)
     *
     * @param PDO                  $db
     * @param array<string, mixed>|null $condition
     */
    private static function evaluateCondition(PDO $db, mixed $condition): bool
    {
        if (!is_array($condition)) {
            return true;
        }

        $type = (string) ($condition['type'] ?? '');

        if ($type === 'faction_standing_threshold') {
            $factionCode = (string) ($condition['faction_code'] ?? '');
            $operator    = (string) ($condition['operator'] ?? '>=');
            $value       = (int) ($condition['value'] ?? 0);
            $scope       = (string) ($condition['scope'] ?? 'any_player');

            try {
                $fRow = $db->prepare('SELECT id FROM npc_factions WHERE code = ?');
                $fRow->execute([$factionCode]);
                $fid = $fRow->fetchColumn();
                if ($fid === false) {
                    return false;
                }

                $standings = $db->prepare(
                    'SELECT standing FROM diplomacy WHERE faction_id = ?'
                );
                $standings->execute([(int) $fid]);
                $allStandings = array_column($standings->fetchAll(\PDO::FETCH_ASSOC), 'standing');

                if (empty($allStandings)) {
                    return false;
                }

                if ($scope === 'any_player') {
                    foreach ($allStandings as $s) {
                        if (self::compareStanding((int) $s, $operator, $value)) {
                            return true;
                        }
                    }
                    return false;
                }

                // all_players
                foreach ($allStandings as $s) {
                    if (!self::compareStanding((int) $s, $operator, $value)) {
                        return false;
                    }
                }
                return true;
            } catch (\Throwable) {
                return false;
            }
        }

        // Unknown condition type: default to eligible
        return true;
    }

    private static function compareStanding(int $standing, string $op, int $value): bool
    {
        return match ($op) {
            '>='    => $standing >= $value,
            '>'     => $standing > $value,
            '<='    => $standing <= $value,
            '<'     => $standing < $value,
            '=='    => $standing === $value,
            '!='    => $standing !== $value,
            default => $standing >= $value,
        };
    }

    /**
     * Apply all effects of a resolved conclusion.
     *
     * @param PDO                       $db
     * @param array<int, array<string, mixed>> $effects  List of effect objects
     * @param array<string, mixed>             $event    Row from active_world_events JOIN world_scenarios
     */
    private static function applyEffects(PDO $db, array $effects, array $event): void
    {
        foreach ($effects as $effect) {
            $type = (string) ($effect['type'] ?? '');
            try {
                match ($type) {
                    'standing_delta' => self::applyStandingDelta($db, $effect),
                    'quest_spawn'    => self::applyQuestSpawn($db, $effect),
                    'galactic_event' => self::applyGalacticEvent($db, $effect, $event),
                    default          => null,
                };
            } catch (\Throwable $e) {
                error_log('[ScenarioEngine] applyEffects type=' . $type . ' error: ' . $e->getMessage());
            }
        }
    }

    /**
     * Apply a standing delta to all affected players.
     *
     * @param PDO                  $db
     * @param array<string, mixed> $effect
     */
    private static function applyStandingDelta(PDO $db, array $effect): void
    {
        $factionCode = (string) ($effect['faction_code'] ?? '');
        $delta       = (int) ($effect['delta'] ?? 0);
        $scope       = (string) ($effect['scope'] ?? 'all_players');

        if ($factionCode === '' || $delta === 0) {
            return;
        }

        $fRow = $db->prepare('SELECT id FROM npc_factions WHERE code = ?');
        $fRow->execute([$factionCode]);
        $fid = $fRow->fetchColumn();
        if ($fid === false) {
            return;
        }

        if ($scope === 'all_players') {
            // Update existing rows (clamped to [-100, 100])
            $db->prepare(
                'UPDATE diplomacy
                 SET standing = GREATEST(-100, LEAST(100, standing + ?))
                 WHERE faction_id = ?'
            )->execute([$delta, (int) $fid]);
        }
        // scope variants (e.g. 'faction_members') can be added here as needed
    }

    /**
     * Spawn a faction quest for all (or targeted) players.
     *
     * @param PDO                  $db
     * @param array<string, mixed> $effect
     */
    private static function applyQuestSpawn(PDO $db, array $effect): void
    {
        $questCode   = (string) ($effect['quest_code'] ?? '');
        $factionCode = (string) ($effect['faction_code'] ?? '');
        $scope       = (string) ($effect['scope'] ?? 'all_players');

        if ($questCode === '') {
            return;
        }

        // Resolve quest id
        $qRow = $db->prepare('SELECT id FROM faction_quests WHERE code = ?');
        $qRow->execute([$questCode]);
        $qid = $qRow->fetchColumn();
        if ($qid === false) {
            return; // Quest not yet seeded – skip silently
        }

        if ($scope === 'all_players') {
            // Get all active players (not NPC accounts)
            $users = $db->query(
                'SELECT id FROM users WHERE is_npc = 0 OR is_npc IS NULL'
            );
            if (!$users) {
                return;
            }
            foreach ($users->fetchAll(\PDO::FETCH_COLUMN) as $uid) {
                self::spawnQuestForUser($db, (int) $uid, (int) $qid);
            }
        }
    }

    private static function spawnQuestForUser(PDO $db, int $userId, int $questId): void
    {
        // Don't duplicate active quests
        $exists = $db->prepare(
            "SELECT COUNT(*) FROM user_faction_quests
             WHERE user_id = ? AND faction_quest_id = ? AND status IN ('active','completed')"
        );
        $exists->execute([$userId, $questId]);
        if ((int) $exists->fetchColumn() > 0) {
            return;
        }

        $db->prepare(
            "INSERT INTO user_faction_quests
                (user_id, faction_quest_id, status, progress_json, started_at)
             VALUES (?, ?, 'active', '{}', NOW())"
        )->execute([$userId, $questId]);
    }

    /**
     * Insert a galactic_events row for the multiplayer-ripple log.
     *
     * @param PDO                  $db
     * @param array<string, mixed> $effect
     * @param array<string, mixed> $event   Row from active_world_events JOIN world_scenarios
     */
    private static function applyGalacticEvent(PDO $db, array $effect, array $event): void
    {
        $eventType     = (string) ($effect['event_type'] ?? 'scenario_conclusion');
        $scope         = (string) ($effect['affected_scope'] ?? 'sector');
        $durationHours = max(1, (int) ($effect['duration_hours'] ?? 24));
        $description   = (string) ($effect['description_de'] ?? '');
        $factionId     = $event['scenario_faction_id'] ?? null;

        $db->prepare(
            'INSERT INTO galactic_events
                (event_type, faction_id, description, affected_scope, starts_at, ends_at, is_visible)
             VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR), 1)'
        )->execute([
            $eventType,
            $factionId ? (int) $factionId : null,
            $description,
            $scope,
            $durationHours,
        ]);
    }

    /**
     * Publish a pending SSE world_event notification via app_state so that
     * events.php picks it up on the next poll cycle.
     *
     * The payload is stored as a JSON-encoded string in app_state under
     * key "scenario_engine:pending_sse:{event_id}".
     *
     * @param PDO                  $db
     * @param int                  $scenarioId
     * @param int                  $eventId
     * @param array<string, mixed> $dbScenario
     * @param int                  $phase
     * @param string|null          $conclusionKey
     */
    private static function publishSsePending(
        PDO $db,
        int $scenarioId,
        int $eventId,
        array $dbScenario,
        int $phase,
        ?string $conclusionKey
    ): void {
        if (!function_exists('app_state_set_int')) {
            return;
        }

        // Fetch ends_at for the event
        $row = $db->prepare('SELECT ends_at FROM active_world_events WHERE id = ?');
        $row->execute([$eventId]);
        $endsAt = (string) ($row->fetchColumn() ?: '');

        $payload = json_encode([
            'scenario_id'    => $scenarioId,
            'event_id'       => $eventId,
            'code'           => $dbScenario['code'] ?? '',
            'phase'          => $phase,
            'conclusion_key' => $conclusionKey,
            'ends_at'        => $endsAt,
            'ts'             => time(),
        ], JSON_UNESCAPED_UNICODE);

        // Store for SSE pickup: key encodes event_id so each event is distinct
        // We use a simple "last pending" approach; events.php clears after reading.
        $db->prepare(
            'INSERT INTO app_state (state_key, state_value)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
        )->execute(["scenario_engine:pending_sse:{$eventId}", $payload]);
    }

    /**
     * Resolve an npc_factions code to its DB id.
     * Returns null if the faction does not exist.
     */
    private static function resolveFactionId(PDO $db, string $factionCode): ?int
    {
        if ($factionCode === '' || $factionCode === 'null') {
            return null;
        }
        try {
            $stmt = $db->prepare('SELECT id FROM npc_factions WHERE code = ?');
            $stmt->execute([$factionCode]);
            $id = $stmt->fetchColumn();
            return $id !== false ? (int) $id : null;
        } catch (\Throwable) {
            return null;
        }
    }
}
