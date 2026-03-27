<?php
// Database configuration – edit these values for your server
define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_NAME', 'galaxyquest');
define('DB_USER', 'galaxyquest_user');
define('DB_PASS', 'change_me_in_production');
define('DB_CHARSET', 'utf8mb4');

// Game configuration
define('GAME_SPEED', 1);          // Resource/fleet speed multiplier
define('GALAXY_MAX', 9);           // Max galaxies
define('SYSTEM_MAX', 499);         // Max systems per galaxy
define('POSITION_MAX', 15);        // Max planets per system
define('SESSION_LIFETIME', 3600);  // Seconds

// Session / security
define('CSRF_TOKEN_LENGTH', 32);
