<?php

declare(strict_types=1);

function require_espionage_runtime(): never
{
    json_error('Espionage is unavailable pending mission lifecycle integration.', 503);
}
