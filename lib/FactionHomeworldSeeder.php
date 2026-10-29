<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/PlanetReservation.php';

final class FactionHomeworldSeeder {
    public function __construct(private PDO $db) {}

    public static function configuredWorlds(string $configPath, string $fractionsDir): array {
        $config = json_decode(file_get_contents($configPath), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($config) || !is_array($config['worlds'] ?? null)
            || !is_string($config['placement_version'] ?? null)
            || $config['placement_version'] === '' || strlen($config['placement_version']) > 32
            || !is_bool($config['provisional'] ?? null)) {
            throw new InvalidArgumentException('Invalid faction homeworld configuration.');
        }
        $worlds = [];
        $systems = [];
        foreach (glob($fractionsDir . '/*/spec.json') ?: [] as $path) {
            $spec = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
            $code = $spec['species_code'] ?? $spec['faction_code'] ?? '';
            $world = $config['worlds'][$code] ?? null;
            if (!is_array($world)) {
                throw new InvalidArgumentException('Missing explicit homeworld for faction ' . $code);
            }
            if (isset($worlds[$code])) {
                throw new InvalidArgumentException('Duplicate faction code: ' . $code);
            }
            self::validateWorld($code, $world);
            $key = $world['galaxy'] . ':' . $world['system'];
            if (isset($systems[$key])) {
                throw new InvalidArgumentException('Faction start systems must be distinct: ' . $key);
            }
            $systems[$key] = true;
            $worlds[$code] = $world + [
                'code' => $code,
                'faction_name' => mb_substr($spec['display_name'] ?? $spec['faction_name'] ?? $code, 0, 64),
                'description' => (string)($spec['description'] ?? $code),
                'color' => $spec['display']['color'] ?? '#888888',
                'icon' => $spec['display']['icon'] ?? '*',
                'placement_version' => $config['placement_version'],
                'provisional' => $config['provisional'],
            ];
        }
        if (!$worlds || array_diff(array_keys($config['worlds']), array_keys($worlds))) {
            throw new InvalidArgumentException('Homeworld configuration and faction specs do not match.');
        }
        ksort($worlds);
        return $worlds;
    }

    private static function validateWorld(string $code, array $world): void {
        if (!preg_match('/^[a-z0-9_]{1,32}$/', $code)
            || !is_int($world['galaxy'] ?? null) || $world['galaxy'] < 1 || $world['galaxy'] > GALAXY_MAX
            || !is_int($world['system'] ?? null) || $world['system'] < 1 || $world['system'] > galaxy_system_limit()
            || !is_int($world['position'] ?? null) || $world['position'] < 1 || $world['position'] > POSITION_MAX
            || !is_string($world['name'] ?? null) || trim($world['name']) === '' || mb_strlen($world['name']) > 64
            || !in_array($world['kind'] ?? '', ['capital', 'outpost'], true)
            || !in_array($world['type'] ?? '', ['military', 'trade', 'science', 'pirate', 'ancient'], true)) {
            throw new InvalidArgumentException('Invalid homeworld definition for ' . $code);
        }
        $system = generate_star_system($world['galaxy'], $world['system']);
        foreach ($system['planets'] as $planet) {
            if ((int)$planet['position'] === $world['position'] && !empty($planet['can_colonize'])) {
                return;
            }
        }
        throw new InvalidArgumentException('Configured homeworld is not colonizable: ' . $code);
    }

    public function seed(array $worlds): array {
        foreach ($worlds as $world) {
            $select = $this->db->prepare('SELECT id FROM npc_factions WHERE code = ?');
            $select->execute([$world['code']]);
            if (!$select->fetchColumn()) {
                $this->db->prepare(
                    'INSERT INTO npc_factions (code, name, description, faction_type, color, icon)
                     VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([
                    $world['code'], $world['faction_name'], $world['description'],
                    $world['type'], $world['color'], $world['icon'],
                ]);
            }
        }
        $worlds = $this->withRemainingFactions($worlds);
        $reservedSystems = [];
        foreach ($worlds as $world) $reservedSystems[$world['galaxy'] . ':' . $world['system']] = true;
        $result = ['created' => 0, 'reused' => 0, 'worlds' => []];
        foreach ($worlds as $world) {
            $select = $this->db->prepare('SELECT id FROM npc_factions WHERE code = ?');
            $select->execute([$world['code']]);
            $factionId = (int)$select->fetchColumn();
            $existing = $this->existingWorld($factionId);
            if ($existing) {
                $this->assertExistingWorld($existing, $world);
                $this->prepareSystem($world['galaxy'], $world['system']);
                $this->prepareNeighbors($world, $reservedSystems);
                $result['reused']++;
                $result['worlds'][] = $existing;
                continue;
            }
            // Generation/schema preparation must finish before the DML transaction.
            $this->prepareSystem($world['galaxy'], $world['system']);
            $this->prepareNeighbors($world, $reservedSystems);
            $this->db->beginTransaction();
            try {
                $lock = $this->db->prepare('SELECT id FROM npc_factions WHERE id = ? FOR UPDATE');
                $lock->execute([$factionId]);
                $existing = $this->existingWorld($factionId);
                if ($existing) {
                    $this->assertExistingWorld($existing, $world);
                    $result['reused']++;
                } else {
                    $username = 'gq_f_' . substr(hash('sha256', $world['code']), 0, 20);
                    $drive = in_array($world['code'], ['aereth', 'vor_tak', 'syl_nar', 'kryl_tha', 'zhareen', 'vel_ar'], true)
                        ? $world['code'] : 'aereth';
                    $this->db->prepare(
                        "INSERT INTO users (username, email, password_hash, control_type, auth_enabled, ftl_drive_type)
                         VALUES (?, ?, '', 'npc_engine', 0, ?)"
                    )->execute([$username, $username . '@factions.invalid', $drive]);
                    $userId = (int)$this->db->lastInsertId();
                    $colonyId = $this->createColony($userId, $world['name'], $world);
                    $this->db->prepare(
                        'INSERT INTO faction_homeworlds
                         (faction_id, user_id, colony_id, kind, placement_version, provisional)
                         VALUES (?, ?, ?, ?, ?, ?)'
                    )->execute([
                        $factionId, $userId, $colonyId, $world['kind'],
                        $world['placement_version'], (int)$world['provisional'],
                    ]);
                    $this->db->prepare('INSERT INTO npc_faction_memberships (user_id, faction_id) VALUES (?, ?)')
                        ->execute([$userId, $factionId]);
                    $result['created']++;
                }
                $this->db->commit();
            } catch (Throwable $error) {
                if ($this->db->inTransaction()) $this->db->rollBack();
                throw $error;
            }
            $result['worlds'][] = $this->existingWorld($factionId);
        }
        return $result;
    }

    private function prepareNeighbors(array $world, array $reservedSystems): void {
        [$x, $y, $z] = galactic_position($world['galaxy'], $world['system']);
        $distances = [];
        for ($s = 1; $s <= galaxy_system_limit(); $s++) {
            if (isset($reservedSystems[$world['galaxy'] . ':' . $s])) continue;
            [$nx, $ny, $nz] = galactic_position($world['galaxy'], $s);
            $distances[$s] = ($nx - $x) ** 2 + ($ny - $y) ** 2 + ($nz - $z) ** 2;
        }
        asort($distances, SORT_NUMERIC);
        $prepared = 0;
        $occupied = $this->db->prepare(
            'SELECT c.id FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE cb.galaxy_index = ? AND cb.system_index = ? LIMIT 1'
        );
        foreach ($distances as $s => $distance) {
            $occupied->execute([$world['galaxy'], $s]);
            if ($occupied->fetchColumn()) continue;
            $system = generate_star_system($world['galaxy'], $s);
            if (!array_filter($system['planets'], static fn(array $p): bool => !empty($p['can_colonize']))) continue;
            $this->prepareSystem($world['galaxy'], $s);
            if (++$prepared === 2) return;
        }
        throw new RuntimeException('Cannot prepare two unowned neighbor systems for ' . $world['code']);
    }

    public function prepareSystem(int $galaxy, int $system): void {
        $stmt = $this->db->prepare('SELECT id FROM planets WHERE galaxy = ? AND `system` = ? LIMIT 1');
        $stmt->execute([$galaxy, $system]);
        $hasPlanets = $stmt->fetchColumn() !== false;
        $stmt = $this->db->prepare('SELECT id FROM star_systems WHERE galaxy_index = ? AND system_index = ?');
        $stmt->execute([$galaxy, $system]);
        $hasStar = $stmt->fetchColumn() !== false;
        if ($hasStar && $hasPlanets) return;
        cache_generated_system($this->db, $galaxy, $system, !$hasPlanets);
        $this->db->prepare(
            'UPDATE planets p JOIN star_systems s ON s.galaxy_index = p.galaxy AND s.system_index = p.`system`
             SET p.system_id = s.id WHERE p.galaxy = ? AND p.`system` = ?'
        )->execute([$galaxy, $system]);
    }

    public function createMemberHomeworld(int $userId, int $factionId, string $name): int {
        $homeworld = $this->existingWorld($factionId);
        if (!$homeworld) throw new RuntimeException('Faction has no seeded homeworld: ' . $factionId);
        $stmt = $this->db->prepare(
            'SELECT p.galaxy, p.`system`, p.position
             FROM planets p JOIN star_systems s ON s.galaxy_index = p.galaxy AND s.system_index = p.`system`
             JOIN star_systems anchor ON anchor.galaxy_index = ? AND anchor.system_index = ?
             WHERE p.galaxy = ? AND NOT EXISTS (
                 SELECT 1 FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id
                 WHERE cb.galaxy_index = p.galaxy AND cb.system_index = p.`system` AND cb.position = p.position
             ) AND NOT EXISTS (
                 SELECT 1 FROM registration_drafts d WHERE d.planet_id = p.id AND d.expires_at > UTC_TIMESTAMP()
             ) AND NOT EXISTS (
                 SELECT 1 FROM faction_homeworlds h JOIN colonies c ON c.id = h.colony_id
                 JOIN celestial_bodies cb ON cb.id = c.body_id
                 WHERE cb.galaxy_index = p.galaxy AND cb.system_index = p.`system`
             )
             ORDER BY POW(s.x_ly - anchor.x_ly, 2) + POW(s.y_ly - anchor.y_ly, 2)
                      + POW(s.z_ly - anchor.z_ly, 2), p.`system`, p.position LIMIT 256'
        );
        $stmt->execute([$homeworld['galaxy'], $homeworld['system'], $homeworld['galaxy']]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $candidate) {
            $world = ['galaxy' => (int)$candidate['galaxy'], 'system' => (int)$candidate['system'], 'position' => (int)$candidate['position']];
            $generated = generate_star_system($world['galaxy'], $world['system']);
            foreach ($generated['planets'] as $planet) {
                if ((int)$planet['position'] !== $world['position'] || empty($planet['can_colonize'])) continue;
                return $this->createColony($userId, $name, $world);
            }
        }
        throw new RuntimeException('No free colonizable NPC neighbor world found for ' . $homeworld['code']);
    }

    private function existingWorld(int $factionId): array|false {
        $stmt = $this->db->prepare(
            'SELECT f.code, h.*, c.user_id AS colony_owner, c.name, cb.galaxy_index AS galaxy,
                    cb.system_index AS `system`, cb.position, u.control_type, u.auth_enabled
             FROM faction_homeworlds h JOIN npc_factions f ON f.id = h.faction_id
             JOIN colonies c ON c.id = h.colony_id JOIN celestial_bodies cb ON cb.id = c.body_id
             JOIN users u ON u.id = h.user_id WHERE h.faction_id = ?'
        );
        $stmt->execute([$factionId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function assertExistingWorld(array $existing, array $world): void {
        foreach (['galaxy', 'system', 'position'] as $key) {
            if ((int)$existing[$key] !== $world[$key]) {
                throw new RuntimeException('Homeworld already placed elsewhere: ' . $world['code']
                    . '. Explicit relocation migration required.');
            }
        }
        if ((int)$existing['user_id'] !== (int)$existing['colony_owner']
            || $existing['control_type'] !== 'npc_engine' || (int)$existing['auth_enabled'] !== 0) {
            throw new RuntimeException('Existing faction homeworld ownership changed: ' . $world['code']);
        }
    }

    private function withRemainingFactions(array $worlds): array {
        $occupied = [];
        foreach ($worlds as $world) $occupied[$world['galaxy'] . ':' . $world['system']] = true;
        $rows = $this->db->query('SELECT * FROM npc_factions ORDER BY code')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $faction) {
            $code = $faction['code'];
            if (isset($worlds[$code])) continue;
            $existing = $this->existingWorld((int)$faction['id']);
            if ($existing) {
                $worlds[$code] = [
                    'code' => $code, 'galaxy' => (int)$existing['galaxy'],
                    'system' => (int)$existing['system'], 'position' => (int)$existing['position'],
                ];
                $occupied[$existing['galaxy'] . ':' . $existing['system']] = true;
            }
        }
        foreach ($rows as $faction) {
            $code = $faction['code'];
            if (isset($worlds[$code])) continue;
            $g = max(1, min(GALAXY_MAX, (int)$faction['home_galaxy_min']));
            $start = (int)hexdec(substr(hash('sha256', $code), 0, 7)) % galaxy_system_limit();
            $found = false;
            for ($offset = 0; $offset < galaxy_system_limit(); $offset++) {
                $s = 1 + ($start + $offset) % galaxy_system_limit();
                if (isset($occupied[$g . ':' . $s])) continue;
                $system = generate_star_system($g, $s);
                foreach ($system['planets'] as $planet) {
                    if (empty($planet['can_colonize'])) continue;
                    $worlds[$code] = [
                        'code' => $code, 'galaxy' => $g, 'system' => $s, 'position' => (int)$planet['position'],
                        'name' => mb_substr($faction['name'], 0, 52) . ' Foothold',
                        'kind' => 'outpost', 'placement_version' => 'generated-v1', 'provisional' => true,
                    ];
                    $occupied[$g . ':' . $s] = true;
                    $found = true;
                    break 2;
                }
            }
            if (!$found) throw new RuntimeException('No faction foothold available: ' . $code);
        }
        return $worlds;
    }

    public function createColony(int $userId, string $name, array $position, ?array $starter = null): int {
        $stmt = $this->db->prepare('SELECT id FROM planets WHERE galaxy = ? AND `system` = ? AND position = ?');
        $stmt->execute([$position['galaxy'], $position['system'], $position['position']]);
        $planetId = (int)$stmt->fetchColumn();
        if (!$planetId) throw new RuntimeException('Homeworld planet is not prepared.', 503);
        return PlanetReservation::withLock($this->db, $planetId, function () use ($userId, $name, $position, $starter, $planetId): int {
        if (PlanetReservation::isReserved($this->db, $planetId)) {
            throw new RuntimeException('Homeworld is reserved for a registration draft.', 409);
        }
        $ownTransaction = !$this->db->inTransaction();
        if ($ownTransaction) $this->db->beginTransaction();
        try {
            $colonyId = $this->createColonyRows($userId, $name, $position, $starter);
            if ($ownTransaction) $this->db->commit();
            return $colonyId;
        } catch (Throwable $error) {
            if ($ownTransaction && $this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
        });
    }

    private function createColonyRows(int $userId, string $name, array $position, ?array $starter): int {
        $g = $position['galaxy'];
        $s = $position['system'];
        $p = $position['position'];
        $system = generate_star_system($g, $s);
        $generated = array_values(array_filter($system['planets'], static fn(array $v): bool => (int)$v['position'] === $p));
        if (!$generated || empty($generated[0]['can_colonize'])) {
            throw new RuntimeException("Homeworld planet is not colonizable: $g:$s:$p");
        }
        $stmt = $this->db->prepare('SELECT * FROM planets WHERE galaxy = ? AND `system` = ? AND position = ?');
        $stmt->execute([$g, $s, $p]);
        $planet = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$planet) throw new RuntimeException("Homeworld planet missing: $g:$s:$p");
        $stmt = $this->db->prepare(
            'SELECT id FROM celestial_bodies WHERE galaxy_index = ? AND system_index = ? AND position = ?
             AND body_type = \'planet\' AND parent_body_type = \'star\''
        );
        $stmt->execute([$g, $s, $p]);
        $bodyId = $stmt->fetchColumn();
        if (!$bodyId) {
            $body = $generated[0];
            $this->db->prepare(
                'INSERT INTO celestial_bodies
                 (body_uid, galaxy_index, system_index, position, body_type, parent_body_type,
                  name, planet_class, can_colonize, semi_major_axis_au, orbital_period_days, mass_earth, diameter_km,
                  surface_gravity_g, atmosphere_type, payload_json)
                 VALUES (?, ?, ?, ?, \'planet\', \'star\', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                "legacy-p-$g-$s-$p", $g, $s, $p, $name, $planet['planet_class'],
                $body['semi_major_axis_au'], $body['orbital_period_days'], $body['mass_earth'],
                $body['diameter_km'], $body['surface_gravity_g'], $body['atmosphere_type'],
                json_encode(['legacy_planet_id' => (int)$planet['id']], JSON_THROW_ON_ERROR),
            ]);
            $bodyId = (int)$this->db->lastInsertId();
        }
        $stmt = $this->db->prepare('SELECT id FROM colonies WHERE body_id = ?');
        $stmt->execute([$bodyId]);
        if ($stmt->fetchColumn()) throw new RuntimeException("Homeworld position occupied: $g:$s:$p", 409);
        $this->db->prepare(
            'INSERT INTO colonies
             (planet_id, body_id, user_id, name, colony_type, is_homeworld, metal, crystal, deuterium,
              rare_earth, food, energy, population, max_population, happiness, public_services)
             VALUES (?, ?, ?, ?, \'industrial\', 1, 1200, 800, 500, 0, 500, 30, 220, 850, 68, 30)'
        )->execute([(int)$planet['id'], $bodyId, $userId, $name]);
        $colonyId = (int)$this->db->lastInsertId();
        if ($starter !== null) {
            $resources = $starter['resources'];
            $population = $starter['population'];
            $this->db->prepare(
                'UPDATE colonies SET colony_type = ?, metal = ?, crystal = ?, deuterium = ?, rare_earth = ?,
                 food = ?, energy = ?, population = ?, max_population = ?, happiness = ?, public_services = ? WHERE id = ?'
            )->execute([
                $starter['colony_type'], $resources['metal'], $resources['crystal'], $resources['deuterium'],
                $resources['rare_earth'], $resources['food'], $resources['energy'], $population['population'],
                $population['max_population'], $population['happiness'], $population['public_services'], $colonyId,
            ]);
        }
        $this->seedAssets($userId, $colonyId, $starter);
        return $colonyId;
    }

    private function seedAssets(int $userId, int $colonyId, ?array $starter): void {
        $buildings = $starter['buildings'] ?? [
            'metal_mine' => 1, 'crystal_mine' => 1, 'deuterium_synth' => 0, 'solar_plant' => 1,
            'metal_storage' => 1, 'crystal_storage' => 1, 'deuterium_tank' => 1, 'robotics_factory' => 0,
            'shipyard' => 0, 'research_lab' => 0, 'terraformer' => 0, 'nanite_factory' => 0,
            'fusion_reactor' => 0, 'alliance_depot' => 0, 'missile_silo' => 0,
        ];
        $stmt = $this->db->prepare('INSERT INTO buildings (colony_id, type, level) VALUES (?, ?, ?)');
        foreach ($buildings as $type => $level) $stmt->execute([$colonyId, $type, $level]);
        $research = [
            'energy_tech', 'laser_tech', 'ion_tech', 'hyperspace_tech', 'plasma_tech', 'combustion_drive',
            'impulse_drive', 'hyperspace_drive', 'espionage_tech', 'computer_tech', 'astrophysics',
            'intergalactic_network', 'graviton_tech', 'weapons_tech', 'shielding_tech', 'armor_tech',
            'nano_materials', 'genetic_engineering', 'quantum_computing', 'dark_energy_tap',
            'wormhole_theory', 'terraforming_tech', 'stealth_tech',
        ];
        $stmt = $this->db->prepare(
            'INSERT INTO research (user_id, type, level) VALUES (?, ?, 0)
             ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)'
        );
        foreach ($research as $type) $stmt->execute([$userId, $type]);
        $stmt = $this->db->prepare('INSERT INTO ships (colony_id, type, count) VALUES (?, ?, ?)');
        foreach (($starter['ships'] ?? ['small_cargo' => 5, 'light_fighter' => 10, 'heavy_fighter' => 2, 'spy_probe' => 2]) as $type => $count) {
            $stmt->execute([$colonyId, $type, $count]);
        }
        $stmt = $this->db->prepare(
            'INSERT INTO player_system_visibility (user_id, galaxy, `system`, level, scouted_at)
             SELECT ?, cb.galaxy_index, cb.system_index, \'own\', CURRENT_TIMESTAMP
             FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id WHERE c.id = ?'
        );
        $stmt->execute([$userId, $colonyId]);
    }
}
