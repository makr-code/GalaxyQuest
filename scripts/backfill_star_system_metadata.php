<?php

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';

$db = get_db();
ensure_star_system_columns($db);

$batchSize = 1000;
$runAll = false;

foreach ($argv as $arg) {
    if (str_starts_with($arg, '--batch=')) {
        $batchSize = max(1, (int)substr($arg, 8));
    }
    if ($arg === '--all') {
        $runAll = true;
    }
}

$updatedTotal = 0;
$processedTotal = 0;
$loop = 0;

do {
    $loop++;
    $limit = max(1, $batchSize);
    $sql = 'SELECT id, galaxy_index, system_index, name, catalog_name, planet_count,
                   spectral_class, subtype, luminosity_class,
                   mass_solar, radius_solar, temperature_k, luminosity_solar
            FROM star_systems
            WHERE COALESCE(catalog_name, "") = "" OR COALESCE(planet_count, 0) = 0
            ORDER BY id ASC
            LIMIT ' . (int)$limit;

    $rows = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) {
        echo 'No remaining star_system rows require backfill.' . PHP_EOL;
        break;
    }

    $updateStmt = $db->prepare(
        'UPDATE star_systems
         SET name = ?,
             catalog_name = ?,
             planet_count = ?
         WHERE id = ?'
    );

    $updatedThisLoop = 0;
    foreach ($rows as $row) {
        $galaxyIndex = (int)$row['galaxy_index'];
        $systemIndex = (int)$row['system_index'];

        $name = trim((string)($row['name'] ?? ''));
        if ($name === '') {
            $name = generate_star_name($galaxyIndex, $systemIndex, (string)($row['spectral_class'] ?? 'G'));
        }

        $catalogName = trim((string)($row['catalog_name'] ?? ''));
        if ($catalogName === '') {
            $catalogName = $name;
        }

        $planets = generate_planets([
            'spectral_class' => (string)$row['spectral_class'],
            'subtype' => (int)$row['subtype'],
            'luminosity_class' => (string)$row['luminosity_class'],
            'mass_solar' => (float)$row['mass_solar'],
            'radius_solar' => (float)$row['radius_solar'],
            'temperature_k' => (int)$row['temperature_k'],
            'luminosity_solar' => (float)$row['luminosity_solar'],
        ], $galaxyIndex, $systemIndex, $name);

        $planetCount = count($planets);

        $updateStmt->execute([
            $name,
            $catalogName,
            $planetCount,
            (int)$row['id'],
        ]);

        $processedTotal++;
        $updatedThisLoop++;
    }

    $updatedTotal += $updatedThisLoop;
    echo 'Loop ' . $loop . ': updated ' . $updatedThisLoop . ' rows.' . PHP_EOL;

    if (!$runAll) {
        break;
    }
} while (true);

echo 'Backfill finished. processed=' . $processedTotal . ' updated=' . $updatedTotal . PHP_EOL;
