<?php
declare(strict_types=1);

require_once __DIR__ . '/FactionHomeworldSeeder.php';
require_once __DIR__ . '/PlanetReservation.php';

final class RegistrationDraftService {
    public const STYLES = ['exploration', 'economy', 'diplomacy', 'military'];
    public const ACTIVATION_UNAVAILABLE = 'World activation requires the surface tutorial and email verification. Registration activation is not available yet.';

    public function __construct(private PDO $db, private array $species, private array $starter) {}

    public function catalog(): array {
        $rows = $this->db->query(
            'SELECT f.id, f.code, c.name AS homeworld, cb.galaxy_index, cb.system_index,
                    cb.position, s.x_ly, s.y_ly, s.z_ly
             FROM faction_homeworlds h JOIN npc_factions f ON f.id = h.faction_id
             JOIN colonies c ON c.id = h.colony_id JOIN celestial_bodies cb ON cb.id = c.body_id
             JOIN star_systems s ON s.galaxy_index = cb.galaxy_index AND s.system_index = cb.system_index'
        )->fetchAll(PDO::FETCH_ASSOC);
        $factions = [];
        foreach ($rows as $row) {
            if (!isset($this->species[$row['code']])) continue;
            $spec = $this->species[$row['code']];
            $factions[$row['code']] = [
                'id' => (int)$row['id'], 'code' => $row['code'], 'name' => $spec['display_name'],
                'description' => $spec['description'], 'homeworld' => $row['homeworld'],
                'target' => $this->target($row),
                'stars' => $this->regionStars($this->target($row)),
            ];
        }
        if (count($factions) !== count($this->species)) {
            throw new RuntimeException('Faction homeworld setup is incomplete. Run setup --homeworlds-only.', 503);
        }
        $content = json_decode(file_get_contents(__DIR__ . '/../config/onboarding_prologue.json'), true, 512, JSON_THROW_ON_ERROR);
        $political = [];
        foreach ($content['factions'] as $definition) {
            $anchor = $factions[$definition['anchor_species']];
            $political[] = array_replace($anchor, [
                'code' => $definition['code'], 'name' => $definition['name'],
                'description' => $definition['text'], 'anchor_species' => $definition['anchor_species'],
            ]);
        }
        $speciesCatalog = [];
        foreach ($this->species as $code => $spec) {
            $region = $factions[$code];
            $speciesCatalog[] = [
                'code' => $code, 'name' => $spec['display_name'], 'description' => $spec['species_type'],
                'faction_id' => $region['id'], 'homeworld' => $region['homeworld'],
                'target' => $region['target'], 'stars' => $region['stars'],
            ];
        }
        return [
            'factions' => $political,
            'species' => $speciesCatalog,
            'gameplay_styles' => self::STYLES,
        ];
    }

    public function preview(string $code): array {
        foreach ($this->catalog()['factions'] as $faction) {
            if ($faction['code'] === $code) return $faction;
        }
        throw new InvalidArgumentException('Choose a playable faction.', 400);
    }

    public function status(string $owner): ?array {
        $stmt = $this->db->prepare('SELECT * FROM registration_drafts WHERE selected_session_hash = ? AND expires_at > UTC_TIMESTAMP()');
        $stmt->execute([$owner]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $this->publicDraft($row) : null;
    }

    public function mentorDrafts(string $owner, string $ipHash): array {
        $catalog = $this->catalog();
        $existing = $this->draftRows($owner);
        if (count($existing) === count($catalog['species'])) return $this->orderedDrafts($existing, $catalog['species']);

        $this->limit($ipHash);
        $preparedGalaxies = [];
        foreach ($catalog['species'] as $species) {
            $galaxy = (int)$species['target']['galaxy_index'];
            if (isset($preparedGalaxies[$galaxy])) continue;
            $this->prepareFrontier($species['target'], count($catalog['species']));
            $preparedGalaxies[$galaxy] = true;
        }
        $this->db->beginTransaction();
        try {
            $this->db->query('SELECT faction_id FROM faction_homeworlds ORDER BY faction_id FOR UPDATE')->fetchAll();
            $this->db->exec('DELETE FROM registration_drafts WHERE expires_at <= UTC_TIMESTAMP()');
            $existing = $this->draftRows($owner);
            if (count($existing) === count($catalog['species'])) {
                $this->db->commit();
                return $this->orderedDrafts($existing, $catalog['species']);
            }
            $reservedPlanetIds = array_map(static fn(array $row): int => (int)$row['planet_id'], $existing);
            $reservedSystemKeys = [];
            foreach ($existing as $row) {
                $snapshot = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
                $position = $snapshot['position'] ?? [];
                if (isset($position['galaxy'], $position['system'])) {
                    $reservedSystemKeys[] = (int)$position['galaxy'] . ':' . (int)$position['system'];
                }
            }
            $existingCodes = array_fill_keys(array_column($existing, 'mentor_code'), true);
            foreach ($catalog['species'] as $species) {
                $code = $species['code'];
                if (isset($existingCodes[$code])) continue;
                $planet = $this->allocate($species['target'], $reservedPlanetIds, $reservedSystemKeys);
                $reservedPlanetIds[] = (int)$planet['id'];
                $reservedSystemKeys[] = (int)$planet['galaxy'] . ':' . (int)$planet['system'];
                $system = generate_star_system((int)$planet['galaxy'], (int)$planet['system']);
                $body = array_values(array_filter($system['planets'], static fn(array $candidate): bool =>
                    (int)$candidate['position'] === (int)$planet['position']))[0];
                $snapshot = [
                    'mentor_code' => $code, 'species_code' => $code, 'anchor_species' => $code,
                    'faction_code' => null, 'colony_name' => mb_substr($body['name'] . ' Colony', 0, 64),
                    'position' => ['galaxy' => (int)$planet['galaxy'], 'system' => (int)$planet['system'], 'position' => (int)$planet['position']],
                    'target' => $this->target([
                        'galaxy_index' => $planet['galaxy'], 'system_index' => $planet['system'],
                        'position' => $planet['position'], 'x_ly' => $planet['x_ly'], 'y_ly' => $planet['y_ly'], 'z_ly' => $planet['z_ly'],
                    ]),
                    'system_name' => $system['name'],
                    'star' => ['temperature_k' => (int)$system['temperature_k'], 'radius_solar' => (float)$system['radius_solar']],
                    'stars' => $species['stars'],
                    'planets' => array_map(static fn(array $candidate): array => [
                        'name' => $candidate['name'], 'position' => (int)$candidate['position'],
                        'class' => $candidate['planet_class'], 'can_colonize' => (bool)$candidate['can_colonize'],
                        'diameter_km' => (int)$candidate['diameter_km'],
                        'semi_major_axis_au' => (float)$candidate['semi_major_axis_au'],
                    ], $system['planets']),
                    'starter' => $this->starter,
                ];
                $token = bin2hex(random_bytes(32));
                PlanetReservation::withLock($this->db, (int)$planet['id'], function () use ($token, $owner, $species, $planet, $snapshot): void {
                    $stmt = $this->db->prepare('SELECT id FROM colonies WHERE planet_id = ? FOR UPDATE');
                    $stmt->execute([$planet['id']]);
                    if ($stmt->fetchColumn() || PlanetReservation::isReserved($this->db, (int)$planet['id'])) {
                        throw new RuntimeException('World was just claimed. Please continue again.', 409);
                    }
                    $this->db->prepare(
                        'INSERT INTO registration_drafts (token, session_hash, mentor_code, selected_session_hash,
                            faction_id, planet_id, snapshot_json, expires_at)
                         VALUES (?, ?, ?, NULL, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR))'
                    )->execute([$token, $owner, $species['code'], $species['faction_id'], $planet['id'], json_encode($snapshot, JSON_THROW_ON_ERROR)]);
                });
            }
            $drafts = $this->draftRows($owner);
            $this->db->commit();
            return $this->orderedDrafts($drafts, $catalog['species']);
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    public function selectMentor(string $owner, string $token, string $mentorCode): array {
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'SELECT * FROM registration_drafts WHERE token = ? AND session_hash = ? AND mentor_code = ?
                 AND expires_at > UTC_TIMESTAMP() FOR UPDATE'
            );
            $stmt->execute([$token, $owner, $mentorCode]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) throw new RuntimeException('Mentor system draft expired or unavailable.', 410);
            $this->db->prepare('UPDATE registration_drafts SET selected_session_hash = NULL WHERE selected_session_hash = ?')
                ->execute([$owner]);
            $this->db->prepare('UPDATE registration_drafts SET selected_session_hash = ? WHERE token = ? AND session_hash = ?')
                ->execute([$owner, $token, $owner]);
            $this->db->commit();
            return $this->status($owner) ?? throw new RuntimeException('Selected mentor draft is unavailable.', 410);
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    public function cancel(string $owner): void {
        $this->db->prepare('DELETE FROM registration_drafts WHERE session_hash = ?')->execute([$owner]);
    }

    public function prepare(string $owner, string $code, string $ipHash): array {
        $faction = $this->preview($code);
        $existing = $this->status($owner);
        if ($existing && $existing['faction_code'] === $code) return $existing;
        $this->limit($ipHash);
        $this->prepareFrontier($faction['target']);
        $this->db->beginTransaction();
        try {
            // One database-wide allocation lock also serializes distinct factions competing for a frontier planet.
            $this->db->query('SELECT faction_id FROM faction_homeworlds ORDER BY faction_id FOR UPDATE')->fetchAll();
            $this->db->exec('DELETE FROM registration_drafts WHERE expires_at <= UTC_TIMESTAMP()');
            $existing = $this->status($owner);
            if ($existing && $existing['faction_code'] === $code) {
                $this->db->commit();
                return $existing;
            }
            $this->cancel($owner);
            $planet = $this->allocate($faction['target']);
            $system = generate_star_system((int)$planet['galaxy'], (int)$planet['system']);
            $body = array_values(array_filter($system['planets'], static fn(array $p): bool => (int)$p['position'] === (int)$planet['position']))[0];
            $colonyName = mb_substr($body['name'] . ' Colony', 0, 64);
            $snapshot = [
                'faction_code' => $code, 'anchor_species' => $faction['anchor_species'], 'colony_name' => $colonyName,
                'position' => ['galaxy' => (int)$planet['galaxy'], 'system' => (int)$planet['system'], 'position' => (int)$planet['position']],
                'target' => $this->target([
                    'galaxy_index' => $planet['galaxy'], 'system_index' => $planet['system'],
                    'position' => $planet['position'], 'x_ly' => $planet['x_ly'], 'y_ly' => $planet['y_ly'], 'z_ly' => $planet['z_ly'],
                ]),
                'system_name' => $system['name'],
                'star' => ['temperature_k' => (int)$system['temperature_k'], 'radius_solar' => (float)$system['radius_solar']],
                'stars' => $this->regionStars($faction['target']),
                'planets' => array_map(static fn(array $p): array => [
                    'name' => $p['name'], 'position' => (int)$p['position'], 'class' => $p['planet_class'],
                    'can_colonize' => (bool)$p['can_colonize'],
                    'diameter_km' => (int)$p['diameter_km'],
                    'semi_major_axis_au' => (float)$p['semi_major_axis_au'],
                ], $system['planets']),
                'starter' => $this->starter,
            ];
            $token = bin2hex(random_bytes(32));
            PlanetReservation::withLock($this->db, (int)$planet['id'], function () use ($token, $owner, $faction, $planet, $snapshot): void {
                $stmt = $this->db->prepare('SELECT id FROM colonies WHERE planet_id = ? FOR UPDATE');
                $stmt->execute([$planet['id']]);
                if ($stmt->fetchColumn() || PlanetReservation::isReserved($this->db, (int)$planet['id'])) {
                    throw new RuntimeException('World was just claimed. Please continue again.', 409);
                }
                $this->db->prepare(
                    'INSERT INTO registration_drafts (token, session_hash, mentor_code, selected_session_hash,
                        faction_id, planet_id, snapshot_json, expires_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR))'
                )->execute([$token, $owner, $faction['anchor_species'], $owner, $faction['id'], $planet['id'], json_encode($snapshot, JSON_THROW_ON_ERROR)]);
            });
            $draft = $this->status($owner);
            $this->db->commit();
            return $draft;
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    public function saveProfile(string $owner, array $input): array {
        if (!is_string($input['species_code'] ?? null) || !isset($this->species[$input['species_code']])
            || (isset($input['gameplay_style']) && (!is_string($input['gameplay_style']) || !in_array($input['gameplay_style'], self::STYLES, true)))
            || !is_string($input['prolog_token'] ?? null)) {
            throw new InvalidArgumentException('Choose a playable species and gameplay preference.', 400);
        }
        $stmt = $this->db->prepare(
            "UPDATE registration_drafts SET snapshot_json = JSON_SET(
                IF(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, '$.species_code')) <=> ?, snapshot_json,
                   JSON_REMOVE(snapshot_json, '$.character', '$.character_revision', '$.tutorial')),
                '$.species_code', ?, '$.gameplay_style', ?)
             WHERE token = ? AND session_hash = ? AND expires_at > UTC_TIMESTAMP()"
        );
        $stmt->execute([$input['species_code'], $input['species_code'], $input['gameplay_style'] ?? null, $input['prolog_token'], $owner]);
        $draft = $this->status($owner);
        if (!$draft || !hash_equals($draft['prolog_token'], $input['prolog_token'])) {
            throw new RuntimeException('Registration draft expired or unavailable. Choose your faction again.', 410);
        }
        $this->db->prepare('DELETE FROM registration_drafts WHERE session_hash = ? AND token <> ?')->execute([$owner, $input['prolog_token']]);
        return $draft;
    }

    public function saveCharacter(string $owner, array $input): array {
        if (!is_string($input['prolog_token'] ?? null) || !is_string($input['name'] ?? null)
            || !preg_match('/^[A-Za-z0-9_]{3,32}$/', trim($input['name']))
            || !is_string($input['background'] ?? null) || mb_strlen($input['background']) > 800) {
            throw new InvalidArgumentException('Enter a commander name (3-32 letters, digits or underscores) and a background of at most 800 characters.', 400);
        }
        $character = json_encode(['name' => trim($input['name']), 'background' => trim($input['background'])], JSON_THROW_ON_ERROR);
        $stmt = $this->db->prepare(
            "UPDATE registration_drafts SET snapshot_json = JSON_SET(
                IF(JSON_EXTRACT(snapshot_json, '$.character') = CAST(? AS JSON)
                   AND JSON_EXTRACT(snapshot_json, '$.character_revision') IS NOT NULL,
                   snapshot_json,
                   JSON_SET(JSON_REMOVE(snapshot_json, '$.tutorial'), '$.character_revision', ?)),
                '$.character', CAST(? AS JSON))
             WHERE token = ? AND session_hash = ? AND expires_at > UTC_TIMESTAMP()
             AND JSON_EXTRACT(snapshot_json, '$.species_code') IS NOT NULL"
        );
        $stmt->execute([$character, bin2hex(random_bytes(16)), $character, $input['prolog_token'], $owner]);
        $draft = $this->status($owner);
        if (!$draft || !hash_equals($draft['prolog_token'], $input['prolog_token']) || !isset($draft['species_code'])) {
            throw new RuntimeException('Registration draft expired or unavailable. Choose your faction and species again.', 410);
        }
        return $draft;
    }

    public function complete(string $owner, array $input): never {
        throw new RuntimeException(self::ACTIVATION_UNAVAILABLE, 503);
    }

    private function limit(string $ipHash): void {
        $this->db->prepare(
            'INSERT INTO registration_limits (ip_hash, attempts) VALUES (?, 1)
             ON DUPLICATE KEY UPDATE attempts = IF(window_start <= DATE_SUB(NOW(), INTERVAL 1 HOUR), 1, attempts + 1),
             window_start = IF(window_start <= DATE_SUB(NOW(), INTERVAL 1 HOUR), NOW(), window_start)'
        )->execute([$ipHash]);
        $stmt = $this->db->prepare('SELECT attempts FROM registration_limits WHERE ip_hash = ?');
        $stmt->execute([$ipHash]);
        if ((int)$stmt->fetchColumn() > 10) throw new RuntimeException('Too many registration drafts. Please try again later.', 429);
    }

    private function allocate(array $anchor, array $excludePlanetIds = [], array $excludeSystemKeys = []): array {
        $stmt = $this->db->prepare(
            'SELECT p.*, s.x_ly, s.y_ly, s.z_ly FROM planets p
             JOIN star_systems s ON s.galaxy_index = p.galaxy AND s.system_index = p.`system`
             WHERE p.galaxy = ? AND NOT EXISTS (
                 SELECT 1 FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id
                 WHERE cb.galaxy_index = p.galaxy AND cb.system_index = p.`system` AND cb.position = p.position
             ) AND NOT EXISTS (SELECT 1 FROM registration_drafts d WHERE d.planet_id = p.id AND d.expires_at > UTC_TIMESTAMP())
             AND NOT EXISTS (
                 SELECT 1 FROM faction_homeworlds h JOIN colonies c ON c.id = h.colony_id
                 JOIN celestial_bodies cb ON cb.id = c.body_id
                 WHERE cb.galaxy_index = p.galaxy AND cb.system_index = p.`system`
             )
             ORDER BY POW(s.x_ly - ?, 2) + POW(s.y_ly - ?, 2) + POW(s.z_ly - ?, 2), p.`system`, p.position'
        );
        $stmt->execute([$anchor['galaxy_index'], $anchor['x_ly'], $anchor['y_ly'], $anchor['z_ly']]);
        while ($planet = $stmt->fetch(PDO::FETCH_ASSOC)) {
            if (in_array((int)$planet['id'], $excludePlanetIds, true)) continue;
            $systemKey = (int)$planet['galaxy'] . ':' . (int)$planet['system'];
            if (in_array($systemKey, $excludeSystemKeys, true)) continue;
            $generated = generate_star_system((int)$planet['galaxy'], (int)$planet['system']);
            foreach ($generated['planets'] as $body) {
                if ((int)$body['position'] === (int)$planet['position'] && !empty($body['can_colonize'])) return $planet;
            }
        }
        throw new RuntimeException('No prepared frontier world is free. Extend the galaxy setup before registering.', 503);
    }

    private function prepareFrontier(array $anchor, int $requiredSystems = 3): void {
        $galaxy = $anchor['galaxy_index'];
        $stmt = $this->db->prepare(
            'SELECT cb.system_index, cb.position FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE cb.galaxy_index = ?
             UNION SELECT p.`system`, p.position FROM registration_drafts d JOIN planets p ON p.id = d.planet_id
             WHERE p.galaxy = ? AND d.expires_at > UTC_TIMESTAMP()'
        );
        $stmt->execute([$galaxy, $galaxy]);
        $occupied = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) $occupied[$row['system_index'] . ':' . $row['position']] = true;
        $stmt = $this->db->prepare(
            'SELECT cb.system_index FROM faction_homeworlds h JOIN colonies c ON c.id = h.colony_id
             JOIN celestial_bodies cb ON cb.id = c.body_id WHERE cb.galaxy_index = ?'
        );
        $stmt->execute([$galaxy]);
        $capitals = array_fill_keys($stmt->fetchAll(PDO::FETCH_COLUMN), true);
        $distances = [];
        for ($system = 1; $system <= galaxy_system_limit(); $system++) {
            if (isset($capitals[$system])) continue;
            [$x, $y, $z] = galactic_position($galaxy, $system);
            $distances[$system] = ($x - $anchor['x_ly']) ** 2 + ($y - $anchor['y_ly']) ** 2 + ($z - $anchor['z_ly']) ** 2;
        }
        asort($distances, SORT_NUMERIC);
        $prepared = 0;
        $seeder = new FactionHomeworldSeeder($this->db);
        foreach ($distances as $system => $distance) {
            $generated = generate_star_system($galaxy, $system);
            $hasFreePlanet = false;
            foreach ($generated['planets'] as $planet) {
                if (empty($planet['can_colonize']) || isset($occupied[$system . ':' . $planet['position']])) continue;
                $hasFreePlanet = true;
                break;
            }
            if (!$hasFreePlanet) continue;
            $seeder->prepareSystem($galaxy, $system);
            foreach ($generated['planets'] as $planet) {
                $occupied[$system . ':' . $planet['position']] = true;
            }
            if (++$prepared >= max(1, $requiredSystems)) return;
        }
        if ($prepared === 0) throw new RuntimeException('No free colonizable frontier world remains in this galaxy.', 503);
    }

    private function regionStars(array $target): array {
        $stmt = $this->db->prepare(
            'SELECT galaxy_index, system_index, x_ly, y_ly, z_ly, name, spectral_class
             FROM star_systems WHERE galaxy_index = ?
             ORDER BY POW(x_ly - ?, 2) + POW(y_ly - ?, 2) + POW(z_ly - ?, 2) LIMIT 64'
        );
        $stmt->execute([$target['galaxy_index'], $target['x_ly'], $target['y_ly'], $target['z_ly']]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function publicDraft(array $row): array {
        $snapshot = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
        return [
            'prolog_token' => $row['token'],
            'expires_at' => str_replace(' ', 'T', $row['expires_at']) . 'Z',
            'mentor_code' => $row['mentor_code'],
            'selected' => isset($row['selected_session_hash']) && $row['selected_session_hash'] === $row['session_hash'],
        ] + $snapshot;
    }

    private function draftRows(string $owner): array {
        $stmt = $this->db->prepare('SELECT * FROM registration_drafts WHERE session_hash = ? AND expires_at > UTC_TIMESTAMP()');
        $stmt->execute([$owner]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function orderedDrafts(array $rows, array $species): array {
        $byCode = [];
        foreach ($rows as $row) $byCode[$row['mentor_code']] = $this->publicDraft($row);
        $ordered = [];
        foreach ($species as $entry) {
            if (isset($byCode[$entry['code']])) $ordered[] = $byCode[$entry['code']];
        }
        return $ordered;
    }

    private function target(array $row): array {
        return [
            'galaxy_index' => (int)$row['galaxy_index'], 'system_index' => (int)$row['system_index'],
            'position' => (int)$row['position'], 'x_ly' => (float)$row['x_ly'],
            'y_ly' => (float)$row['y_ly'], 'z_ly' => (float)$row['z_ly'],
        ];
    }
}
