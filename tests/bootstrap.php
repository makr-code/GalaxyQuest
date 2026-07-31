<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../api/game_engine.php';
require_once __DIR__ . '/../lib/projection_runtime.php';
require_once __DIR__ . '/../api/projection.php';
require_once __DIR__ . '/../lib/MiniYamlParser.php';
require_once __DIR__ . '/../api/llm_soc/IronFleetPromptVarsComposer.php';
require_once __DIR__ . '/../api/cache.php';
require_once __DIR__ . '/../api/tts_client.php';
require_once __DIR__ . '/../lib/MigrationRunner.php';

// Register PSR-4 autoloader for GalaxyQuest namespace
spl_autoload_register(static function (string $class): void {
    $prefix = 'GalaxyQuest\\';
    if (strpos($class, $prefix) === 0) {
        $path = __DIR__ . '/../src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (file_exists($path)) {
            require_once $path;
        }
    }
});

