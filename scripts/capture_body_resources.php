#!/usr/bin/env php
<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$apply = false;
$after = 0;
$limit = 100;
$arguments = $_SERVER['argv'] ?? null;
if (!is_array($arguments)) {
    fwrite(STDERR, "CLI arguments are unavailable.\n");
    exit(1);
}
foreach (array_slice($arguments, 1) as $argument) {
    if ($argument === '--apply') {
        $apply = true;
    } elseif (preg_match('/^--(after|limit)=(\d+)$/', $argument, $match)) {
        $value = filter_var($match[2], FILTER_VALIDATE_INT);
        if ($value === false || ($match[1] === 'limit' && ($value < 1 || $value > 1000))) {
            fwrite(STDERR, "Invalid range: {$argument}\n");
            exit(1);
        }
        if ($match[1] === 'after') {
            $after = $value;
        } else {
            $limit = $value;
        }
    } else {
        fwrite(STDERR, "Usage: php scripts/capture_body_resources.php [--apply] [--after=0] [--limit=100]\n");
        exit(1);
    }
}

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/BodyResourceRepository.php';

try {
    $db = get_db();
    $repository = new BodyResourceRepository($db);
    $stmt = $db->prepare('SELECT id FROM celestial_bodies WHERE id > ? ORDER BY id LIMIT ' . $limit);
    $stmt->execute([$after]);
    $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $captured = 0;
    foreach ($ids as $id) {
        $profile = $repository->preview((int)$id);
        if ($apply) {
            $captured += $repository->capture((int)$id);
        }
        echo json_encode(['body_id' => (int)$id, 'candidate_profile' => $profile], JSON_THROW_ON_ERROR) . PHP_EOL;
    }
    echo json_encode([
        'mode' => $apply ? 'capture' : 'preview',
        'bodies' => count($ids),
        'sources_inserted' => $captured,
        'next_after' => $ids === [] ? $after : (int)end($ids),
        'simulation_activated' => false,
    ], JSON_THROW_ON_ERROR) . PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, 'Body resource capture failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
