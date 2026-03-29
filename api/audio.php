<?php
/**
 * Audio catalog API
 * GET /api/audio.php?action=list
 */
require_once __DIR__ . '/helpers.php';

$action = (string)($_GET['action'] ?? 'list');

if ($action !== 'list') {
    json_error('Unknown action');
}

only_method('GET');

$musicDir = realpath(__DIR__ . '/../music');
if ($musicDir === false || !is_dir($musicDir)) {
    json_ok(['tracks' => []]);
}

$allowedExt = ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac', 'webm'];
$entries = @scandir($musicDir);
if (!is_array($entries)) {
    json_ok(['tracks' => []]);
}

$tracks = [];
foreach ($entries as $entry) {
    if ($entry === '.' || $entry === '..') {
        continue;
    }
    $fullPath = $musicDir . DIRECTORY_SEPARATOR . $entry;
    if (!is_file($fullPath)) {
        continue;
    }

    $ext = strtolower((string)pathinfo($entry, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowedExt, true)) {
        continue;
    }

    $basename = (string)basename($entry);
    $url = 'music/' . rawurlencode($basename);
    $titleRaw = (string)pathinfo($basename, PATHINFO_FILENAME);
    $title = trim((string)preg_replace('/[_\-]+/', ' ', $titleRaw));
    if ($title === '') {
        $title = $basename;
    }

    $mtime = @filemtime($fullPath);
    $size = @filesize($fullPath);

    $tracks[] = [
        'value' => $url,
        'label' => $title,
        'file' => $basename,
        'ext' => $ext,
        'size' => $size === false ? 0 : (int)$size,
        'modified_at' => $mtime === false ? null : date('c', (int)$mtime),
    ];
}

usort($tracks, static function (array $a, array $b): int {
    return strnatcasecmp((string)$a['label'], (string)$b['label']);
});

json_ok(['tracks' => $tracks]);
