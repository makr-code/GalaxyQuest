<?php

declare(strict_types=1);

require_once __DIR__ . '/../api/galaxy_gen.php';

/**
 * Stages the initial body inventories; it deliberately does not activate extraction.
 * The legacy simulation remains authoritative until the economy cutover.
 */
final class BodyResourceRepository
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function preview(int $bodyId): array
    {
        return $this->profile($this->body($bodyId, false));
    }

    public function capture(int $bodyId): int
    {
        if ($this->db->inTransaction()) {
            throw new LogicException('Resource capture requires its own transaction.');
        }
        $this->db->beginTransaction();
        try {
            $body = $this->body($bodyId, true);
            $existing = $this->db->prepare('SELECT body_id FROM body_resource_profiles WHERE body_id = ?');
            $existing->execute([$bodyId]);
            if ($existing->fetchColumn() !== false) {
                $this->db->commit();
                return 0;
            }
            $profile = $this->profile($body);
            $capturedAt = gmdate('Y-m-d H:i:s');
            $this->db->prepare(
                'INSERT INTO body_resource_profiles (body_id, profile_version, assessment, captured_at)
                 VALUES (?, ?, ?, ?)'
            )->execute([$bodyId, $profile['version'], $profile['assessment'], $capturedAt]);
            $insert = $this->db->prepare(
                'INSERT INTO body_resource_sources
                 (body_id, resource_type, source_type, initial_quantity,
                  remaining_quantity, capacity, regeneration_per_hour, richness, extraction_method, origin, captured_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $count = 0;
            foreach ($profile['sources'] as $resource => $source) {
                $insert->execute([
                    $bodyId, $resource, $source['source_type'],
                    $source['initial_quantity'], $source['remaining_quantity'], $source['capacity'],
                    $source['regeneration_per_hour'], $source['richness'],
                    $source['extraction_method'], $source['origin'], $capturedAt,
                ]);
                $count++;
            }
            $this->db->commit();
            return $count;
        } catch (Throwable $error) {
            // @phpstan-ignore if.alwaysFalse (PDO state changes on begin/commit or server-side rollback.)
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }

    private function body(int $bodyId, bool $lock): array
    {
        if ($bodyId <= 0) {
            throw new InvalidArgumentException('body_id must be positive.');
        }
        $suffix = $lock && $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
        $stmt = $this->db->prepare('SELECT * FROM celestial_bodies WHERE id = ?' . $suffix);
        $stmt->execute([$bodyId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new OutOfBoundsException('Celestial body not found: ' . $bodyId);
        }
        return $row;
    }

    private function profile(array $row): array
    {
        $payload = $row['payload_json'] === null
            ? []
            : json_decode($row['payload_json'], false, 512, JSON_THROW_ON_ERROR);
        if ($row['payload_json'] !== null && !$payload instanceof stdClass) {
            throw new UnexpectedValueException('Body payload must be an object.');
        }
        // SQL nulls must not erase physical properties present only in the payload.
        $body = array_replace((array)$payload, array_filter($row, static fn ($value) => $value !== null));
        $legacy = null;
        if ($row['body_type'] === 'planet' && $row['parent_body_type'] === 'star') {
            $suffix = $this->db->inTransaction()
                && $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
            $stmt = $this->db->prepare(
                'SELECT deposit_metal, deposit_crystal, deposit_deuterium, deposit_rare_earth,
                        richness_metal, richness_crystal, richness_deuterium, richness_rare_earth
                 FROM planets WHERE galaxy = ? AND `system` = ? AND position = ?' . $suffix
            );
            $stmt->execute([$row['galaxy_index'], $row['system_index'], $row['position']]);
            $legacy = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        return derive_body_resource_profile($body, $legacy);
    }
}
