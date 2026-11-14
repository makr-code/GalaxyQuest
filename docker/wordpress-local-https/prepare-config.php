<?php

declare(strict_types=1);

require __DIR__ . '/transform-config.php';

// Keep the source installation untouched; copy only to the private config volume.
$source = file_get_contents('/run/gq-source/wp-config.php');
if ($source === false) {
    throw new RuntimeException('Local WordPress configuration is unavailable.');
}
$target = '/var/lib/gq-local-config/wp-config.php';
if (
    file_put_contents($target, gq_local_https_transform_configuration($source), LOCK_EX) === false
    || !chmod($target, 0600)
) {
    throw new RuntimeException('Cannot prepare private local WordPress configuration.');
}
