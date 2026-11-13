<?php

declare(strict_types=1);

function gq_read_app_version(string $root): string
{
    $versionPath = $root . DIRECTORY_SEPARATOR . 'VERSION.txt';
    if (!is_file($versionPath) || !is_readable($versionPath)) {
        throw new RuntimeException('Application version metadata is unavailable.');
    }

    $versionText = file_get_contents($versionPath);
    if ($versionText === false) {
        throw new RuntimeException('Application version metadata could not be read.');
    }

    $version = trim($versionText);
    $numeric = '(?:0|[1-9][0-9]*)';
    $identifier = '(?:' . $numeric . '|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
    $pattern = '/^' . $numeric . '\.' . $numeric . '\.' . $numeric
        . '(?:-' . $identifier . '(?:\.' . $identifier . ')*)?'
        . '(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/D';

    if (preg_match($pattern, $version) !== 1) {
        throw new RuntimeException('Application version metadata must contain one valid SemVer version.');
    }

    return $version;
}
