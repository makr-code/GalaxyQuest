<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

fwrite(
    STDERR,
    "[ship-designer] FATAL: this legacy initializer is retired; it could drop existing design data. "
    . "No database was accessed. Use a reviewed canonical migration before enabling ship-designer storage.\n"
);
exit(1);
