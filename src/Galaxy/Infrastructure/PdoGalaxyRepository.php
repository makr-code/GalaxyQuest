<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Infrastructure;

use GalaxyQuest\Galaxy\Domain\Interfaces\GalaxyRepositoryInterface;

/**
 * PdoGalaxyRepository – PDO implementation of GalaxyRepositoryInterface.
 *
 * Queries the star_systems table for galaxy data.
 * Uses prepared statements and proper error handling.
 *
 * Coordinates are x_ly (X light-years) and y_ly (Y light-years) columns from database.
 * Converts database values to integer range for API (rounded/scaled).
 */
final class PdoGalaxyRepository implements GalaxyRepositoryInterface
{
    /**
     * Scale factor: database stores light-years as DOUBLE,
     * API works with integer coordinates (scale = 1 ly per unit).
     */
    private const COORD_SCALE = 1;

    public function __construct(
        private \PDO $db,
    ) {
    }

    public function getSystemByCoordinates(int $x, int $y): array
    {
        $xLy = (float)$x * self::COORD_SCALE;
        $yLy = (float)$y * self::COORD_SCALE;

        $stmt = $this->db->prepare(
            'SELECT id, galaxy_index, system_index, x_ly, y_ly, z_ly, name,
                    catalog_name, spectral_class, subtype, luminosity_class,
                    mass_solar, radius_solar, temperature_k, luminosity_solar,
                    hz_inner_au, hz_outer_au, frost_line_au, stellar_type,
                    age_gyr, metallicity_z, is_binary, planet_count
             FROM star_systems
             WHERE x_ly BETWEEN ? AND ? AND y_ly BETWEEN ? AND ?
             LIMIT 1'
        );

        $tolerance = 0.5; // Match systems within 0.5 ly of target
        $stmt->execute([$xLy - $tolerance, $xLy + $tolerance, $yLy - $tolerance, $yLy + $tolerance]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        if (!$row) {
            throw new \DomainException("System not found at coordinates ({$x}, {$y})");
        }

        return $this->normalizeSystemData($row);
    }

    public function getSystemsInRange(int $xMin, int $xMax, int $yMin, int $yMax): array
    {
        $xMinLy = (float)$xMin * self::COORD_SCALE;
        $xMaxLy = (float)$xMax * self::COORD_SCALE;
        $yMinLy = (float)$yMin * self::COORD_SCALE;
        $yMaxLy = (float)$yMax * self::COORD_SCALE;

        $stmt = $this->db->prepare(
            'SELECT id, galaxy_index, system_index, x_ly, y_ly, z_ly, name,
                    catalog_name, spectral_class, subtype, luminosity_class,
                    mass_solar, radius_solar, temperature_k, luminosity_solar,
                    hz_inner_au, hz_outer_au, frost_line_au, stellar_type,
                    age_gyr, metallicity_z, is_binary, planet_count
             FROM star_systems
             WHERE x_ly BETWEEN ? AND ? AND y_ly BETWEEN ? AND ?
             ORDER BY system_index ASC
             LIMIT 5000'
        );

        $stmt->execute([$xMinLy, $xMaxLy, $yMinLy, $yMaxLy]);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        return array_map([$this, 'normalizeSystemData'], $rows);
    }

    public function countSystemsInRange(int $xMin, int $xMax, int $yMin, int $yMax): int
    {
        $xMinLy = (float)$xMin * self::COORD_SCALE;
        $xMaxLy = (float)$xMax * self::COORD_SCALE;
        $yMinLy = (float)$yMin * self::COORD_SCALE;
        $yMaxLy = (float)$yMax * self::COORD_SCALE;

        $stmt = $this->db->prepare(
            'SELECT COUNT(*) as cnt FROM star_systems
             WHERE x_ly BETWEEN ? AND ? AND y_ly BETWEEN ? AND ?'
        );

        $stmt->execute([$xMinLy, $xMaxLy, $yMinLy, $yMaxLy]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return (int)($row['cnt'] ?? 0);
    }

    public function searchSystemsByName(string $prefix, int $limit = 50): array
    {
        $stmt = $this->db->prepare(
            'SELECT id, galaxy_index, system_index, x_ly, y_ly, z_ly, name,
                    catalog_name, spectral_class, subtype, luminosity_class,
                    mass_solar, radius_solar, temperature_k, luminosity_solar,
                    hz_inner_au, hz_outer_au, frost_line_au, stellar_type,
                    age_gyr, metallicity_z, is_binary, planet_count
             FROM star_systems
             WHERE name LIKE ? OR catalog_name LIKE ?
             ORDER BY name ASC
             LIMIT ?'
        );

        $pattern = $prefix . '%';
        $stmt->execute([$pattern, $pattern, $limit]);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        return array_map([$this, 'normalizeSystemData'], $rows);
    }

    /**
     * Normalize database row to API-friendly array.
     *
     * @param array<string, mixed> $row Database row
     * @return array<string, mixed>
     */
    private function normalizeSystemData(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'galaxy_index' => (int)($row['galaxy_index'] ?? 1),
            'system_index' => (int)($row['system_index'] ?? 0),
            'name' => (string)($row['name'] ?? 'Unknown'),
            'catalog_name' => (string)($row['catalog_name'] ?? ''),
            'x' => (int)round((float)($row['x_ly'] ?? 0)),
            'y' => (int)round((float)($row['y_ly'] ?? 0)),
            'z' => (float)($row['z_ly'] ?? 0),
            'spectral_class' => (string)($row['spectral_class'] ?? 'G'),
            'subtype' => (int)($row['subtype'] ?? 0),
            'temperature_k' => (int)($row['temperature_k'] ?? 5778),
            'planet_count' => (int)($row['planet_count'] ?? 0),
            'hz_inner_au' => (float)($row['hz_inner_au'] ?? 0.9506),
            'hz_outer_au' => (float)($row['hz_outer_au'] ?? 1.6765),
        ];
    }
}
