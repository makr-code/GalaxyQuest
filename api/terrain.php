<?php

declare(strict_types=1);

use GalaxyQuest\Terrain\BodyTerrain;

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../lib/BodyTerrain.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    only_method('GET');
    $uid = require_auth();
    $colonyId = filter_var($_GET['colony_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($colonyId === false) {
        json_error('A valid colony_id is required');
    }
    $action = $_GET['action'] ?? 'manifest';
    if (!in_array($action, ['manifest', 'tiles'], true)) {
        json_error('Unknown terrain action');
    }
    $db = get_db();
    try {
        $manifest = BodyTerrain::forColony($db, $uid, $colonyId);
    } catch (RuntimeException $error) {
        if ($error->getCode() !== 404) {
            throw $error;
        }
        json_error($error->getMessage(), 404);
    }
    session_write_close();
    try {
        if ($action === 'manifest') {
            header('Cache-Control: private, no-cache');
            json_ok(['manifest' => $manifest]);
        }
        if (!is_string($_GET['tiles'] ?? null)) {
            json_error('A JSON tile list is required');
        }
        $requested = json_decode($_GET['tiles'], true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($requested)) {
            json_error('Invalid tile list');
        }
        $tiles = BodyTerrain::tiles($db, $manifest, $requested);
        header('Cache-Control: private, no-cache');
        json_ok(['tiles' => $tiles]);
    } catch (JsonException | InvalidArgumentException $error) {
        json_error($error->getMessage());
    }
}
