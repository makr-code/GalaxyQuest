<?php

function env_value(string $key, $default) {
	$value = getenv($key);
	return ($value === false || $value === '') ? $default : $value;
}

// Database configuration – edit these values for your server or inject them via env vars
define('DB_HOST', env_value('DB_HOST', 'localhost'));
define('DB_PORT', (int) env_value('DB_PORT', 3306));
define('DB_NAME', env_value('DB_NAME', 'galaxyquest'));
define('DB_USER', env_value('DB_USER', 'galaxyquest_user'));
define('DB_PASS', env_value('DB_PASS', 'change_me_in_production'));
define('DB_CHARSET', env_value('DB_CHARSET', 'utf8mb4'));

// Game configuration
define('GAME_SPEED', (int) env_value('GAME_SPEED', 1));   // Resource/fleet speed multiplier
define('GALAXY_MAX', (int) env_value('GALAXY_MAX', 9));   // Max galaxies
define('SYSTEM_MAX', (int) env_value('SYSTEM_MAX', 25000)); // Max systems per galaxy
define('POSITION_MAX', (int) env_value('POSITION_MAX', 15)); // Max planets per system
define('SESSION_LIFETIME', (int) env_value('SESSION_LIFETIME', 3600)); // Seconds
define('REMEMBER_ME_DAYS', (int) env_value('REMEMBER_ME_DAYS', 30)); // Persistent login cookie lifetime
define('APP_ENV', env_value('APP_ENV', 'dev'));
define('ENABLE_DEV_AUTH_TOOLS', (int) env_value('ENABLE_DEV_AUTH_TOOLS', APP_ENV === 'production' ? 0 : 1));

// Local LLM (Ollama) configuration
define('OLLAMA_ENABLED', (int) env_value('OLLAMA_ENABLED', APP_ENV === 'production' ? 0 : 1));
define('OLLAMA_LOCAL_ONLY', (int) env_value('OLLAMA_LOCAL_ONLY', 1));
define('OLLAMA_BASE_URL', rtrim((string) env_value('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'), '/'));
define('OLLAMA_DEFAULT_MODEL', (string) env_value('OLLAMA_DEFAULT_MODEL', 'llama3.1:8b'));
define('OLLAMA_TIMEOUT_SECONDS', (int) env_value('OLLAMA_TIMEOUT_SECONDS', 45));

// SwarmUI (local Stable Diffusion image generation)
define('SWARMUI_ENABLED',         (int)    env_value('SWARMUI_ENABLED', 1));
define('SWARMUI_BASE_URL',        (string) env_value('SWARMUI_BASE_URL', 'http://127.0.0.1:7801'));
define('SWARMUI_DEFAULT_MODEL',   (string) env_value('SWARMUI_DEFAULT_MODEL', 'OfficialStableDiffusion/sd_xl_base_1.0.safetensors'));
define('SWARMUI_TURBO_MODEL',     (string) env_value('SWARMUI_TURBO_MODEL', 'ZImage/SwarmUI_Z-Image-Turbo-FP8Mix.safetensors'));
define('SWARMUI_TIMEOUT_SECONDS', (int)    env_value('SWARMUI_TIMEOUT_SECONDS', 180));
define('SWARMUI_DEFAULT_STEPS',   (int)    env_value('SWARMUI_DEFAULT_STEPS', 30));
define('SWARMUI_DEFAULT_CFG',     (float)  env_value('SWARMUI_DEFAULT_CFG', 7.5));

// NPC / PvE controller (LLM-assisted, optional)
define('NPC_LLM_CONTROLLER_ENABLED', (int) env_value('NPC_LLM_CONTROLLER_ENABLED', 0));
define('NPC_LLM_CONTROLLER_TIMEOUT_SECONDS', (int) env_value('NPC_LLM_CONTROLLER_TIMEOUT_SECONDS', 8));
define('NPC_LLM_CONTROLLER_COOLDOWN_SECONDS', (int) env_value('NPC_LLM_CONTROLLER_COOLDOWN_SECONDS', 900));
define('NPC_LLM_CONTROLLER_MIN_CONFIDENCE', (float) env_value('NPC_LLM_CONTROLLER_MIN_CONFIDENCE', 0.55));

// Politics model tuning
define('POLITICS_MAX_CIVICS', (int) env_value('POLITICS_MAX_CIVICS', 2));
define('POLITICS_UNREST_TRIGGER_APPROVAL', (float) env_value('POLITICS_UNREST_TRIGGER_APPROVAL', 45));
define('POLITICS_UNREST_RECOVERY_APPROVAL', (float) env_value('POLITICS_UNREST_RECOVERY_APPROVAL', 62));
define('POLITICS_UNREST_PROGRESS_PER_HOUR', (float) env_value('POLITICS_UNREST_PROGRESS_PER_HOUR', 1.0));

// Session / security
define('CSRF_TOKEN_LENGTH',     (int) env_value('CSRF_TOKEN_LENGTH',     32));
define('LOGIN_MAX_ATTEMPTS',    (int) env_value('LOGIN_MAX_ATTEMPTS',    10));   // Consecutive failures before lockout
define('LOGIN_LOCKOUT_SECONDS', (int) env_value('LOGIN_LOCKOUT_SECONDS', 1800)); // 30-minute lockout window
define('LOGIN_WINDOW_SECONDS',  (int) env_value('LOGIN_WINDOW_SECONDS',  1800)); // Attempt-counter reset window
define('SLOW_QUERY_THRESHOLD_MS', (int) env_value('SLOW_QUERY_THRESHOLD_MS', 500)); // Log DB queries slower than this

require_once __DIR__ . '/api_version.php';

// ── Cache ────────────────────────────────────────────────────────────────────
// Verifikationsmaßstab: CACHE_VERSION in jeden Schlüssel eingebettet.
// Increment → alle bestehenden Einträge sofort invalidiert (kein Flush nötig).
define('CACHE_ENABLED',      (bool)(int) env_value('CACHE_ENABLED', 1));
define('CACHE_VERSION',      (string)    env_value('CACHE_VERSION', '1'));
define('CACHE_DIR',          (string)    env_value('CACHE_DIR', sys_get_temp_dir() . '/gq_cache'));
define('CACHE_TTL_STARS',    (int)       env_value('CACHE_TTL_STARS',   600));  // Stern-Chunks: 10 min
define('CACHE_TTL_SYSTEM_PAYLOAD', (int) env_value('CACHE_TTL_SYSTEM_PAYLOAD', 12)); // Systemdetails (Planeten/Kolonien/Fleets): 12 s
define('CACHE_TTL_FACTIONS', (int)       env_value('CACHE_TTL_FACTIONS', 120)); // Fraktionen: 2 min
define('CACHE_TTL_OVERVIEW', (int)       env_value('CACHE_TTL_OVERVIEW',   8)); // User-Overview: 8 s
define('CACHE_TTL_DEFAULT',  (int)       env_value('CACHE_TTL_DEFAULT',   60)); // Allgemein: 1 min
define('CACHE_STARS_FULL_MATERIALIZE_LIMIT', (int) env_value('CACHE_STARS_FULL_MATERIALIZE_LIMIT', 800));
// Stars-Chunk-Overlap-Auswahl: 'smallest_superset' oder 'max_overlap'
define('CACHE_STARS_OVERLAP_POLICY', (string) env_value('CACHE_STARS_OVERLAP_POLICY', 'smallest_superset'));
