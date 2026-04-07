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

// LoRA adapters for GalaxyQuest NPC portrait generation
// Path prefix relative to SwarmUI's Models/Lora/ directory
define('SWARMUI_LORA_PATH',   (string) env_value('SWARMUI_LORA_PATH', 'gq/'));
// Default LoRA weights per race (0.0–1.0)
define('LORA_WEIGHT_VORTAK',  (float)  env_value('LORA_WEIGHT_VORTAK',  0.85));
define('LORA_WEIGHT_SYLNAR',  (float)  env_value('LORA_WEIGHT_SYLNAR',  0.80));
define('LORA_WEIGHT_AERETH',  (float)  env_value('LORA_WEIGHT_AERETH',  0.80));
define('LORA_WEIGHT_KRYLTHA', (float)  env_value('LORA_WEIGHT_KRYLTHA', 0.90));
define('LORA_WEIGHT_ZHAREEN', (float)  env_value('LORA_WEIGHT_ZHAREEN', 0.85));
define('LORA_WEIGHT_VELAR',   (float)  env_value('LORA_WEIGHT_VELAR',   0.75));

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

// ── Projection / Read-Model ───────────────────────────────────────────────────
// Feature flag: when enabled the overview endpoint reads from projection_user_overview
// first and falls back to live computation only when the projection is absent/stale.
define('PROJECTION_OVERVIEW_ENABLED', (bool)(int) env_value('PROJECTION_OVERVIEW_ENABLED', 0));
// Max age (seconds) before a projection is considered stale and the fallback is used.
define('PROJECTION_OVERVIEW_MAX_AGE_SECONDS', (int) env_value('PROJECTION_OVERVIEW_MAX_AGE_SECONDS', 120));
// Projector worker: max dirty-queue entries to process per batch run.
define('PROJECTION_BATCH_SIZE', (int) env_value('PROJECTION_BATCH_SIZE', 50));
// Projector worker: base retry delay (seconds) after a failed projection attempt.
define('PROJECTION_RETRY_BACKOFF_SECONDS', (int) env_value('PROJECTION_RETRY_BACKOFF_SECONDS', 30));
// Projector worker: max processing attempts before a queue entry is promoted to dead-letter (status=failed).
define('PROJECTION_MAX_ATTEMPTS', (int) env_value('PROJECTION_MAX_ATTEMPTS', 10));

// Phase 2: System-Snapshot Projection for galaxy/stars range reads.
// Feature flag: when enabled, action=stars prefers snapshot reads and falls back to live query.
define('PROJECTION_GALAXY_STARS_ENABLED', (bool)(int) env_value('PROJECTION_GALAXY_STARS_ENABLED', 0));
// Max age (seconds) before a system snapshot is considered stale (fallback to live).
define('PROJECTION_SYSTEM_SNAPSHOT_MAX_AGE_SECONDS', (int) env_value('PROJECTION_SYSTEM_SNAPSHOT_MAX_AGE_SECONDS', 300));
// Projector worker: max system dirty-queue entries to process per batch run.
define('PROJECTION_SYSTEM_BATCH_SIZE', (int) env_value('PROJECTION_SYSTEM_BATCH_SIZE', 200));

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

// ── TTS (Text-to-Speech) ─────────────────────────────────────────────────────
// Feature flag: set to 1 to enable the TTS API endpoint.
define('TTS_ENABLED',         (int)    env_value('TTS_ENABLED', 0));
// Base URL of the Python TTS microservice (tts_service/).
define('TTS_SERVICE_URL',     (string) env_value('TTS_SERVICE_URL', 'http://localhost:5500'));
// Shared secret sent as X-Tts-Key header; empty string = no auth.
define('TTS_SECRET',          (string) env_value('TTS_SECRET', ''));
// Default voice name (Piper: e.g. de_DE-thorsten-high, XTTS: language code).
define('TTS_DEFAULT_VOICE',   (string) env_value('TTS_DEFAULT_VOICE', 'de_DE-thorsten-high'));
// Request timeout for the TTS microservice in seconds.
define('TTS_TIMEOUT_SECONDS', (int)    env_value('TTS_TIMEOUT_SECONDS', 30));
// Maximum allowed input characters (anti-abuse guard).
define('TTS_MAX_CHARS',       (int)    env_value('TTS_MAX_CHARS', 2000));
// Cache TTL for synthesised audio files (seconds); 0 = permanent.
define('TTS_CACHE_TTL',       (int)    env_value('TTS_CACHE_TTL', 0));

// ── ThemisDB (Migration Phase 0+) ───────────────────────────────────────────
// Feature flag: set to 1 to enable ThemisDB HTTP client and dual-write path.
define('THEMISDB_ENABLED',         (int)    env_value('THEMISDB_ENABLED',         0));
// Base URL of the ThemisDB HTTP/REST API (no trailing slash).
define('THEMISDB_BASE_URL',        (string) env_value('THEMISDB_BASE_URL',        'http://localhost:8090'));
// Request timeout for ThemisDB API calls in seconds.
define('THEMISDB_TIMEOUT_SECONDS', (int)    env_value('THEMISDB_TIMEOUT_SECONDS', 10));
// When 1, critical write operations are mirrored to both MySQL and ThemisDB (dual-write).
define('THEMISDB_DUAL_WRITE',      (int)    env_value('THEMISDB_DUAL_WRITE',      0));
// Bearer token for ThemisDB API authentication (empty = no auth, dev only).
define('THEMISDB_API_TOKEN',       (string) env_value('THEMISDB_API_TOKEN',       ''));
