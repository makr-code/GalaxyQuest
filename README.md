# GalaxyQuest
a strategic massive online space game

## Tech Stack
- **Frontend**: Plain HTML5, CSS3, JavaScript (no build step)
- **Backend**: PHP 8.0+ with PDO
- **Database**: MySQL 8.0+

## Features
- 🔐 User registration & login with CSRF protection
- 🌌 Animated starfield UI
- 🏭 Buildings (14 types): mines, power plants, factory, lab, etc.
- 🔬 Research tree (16 technologies)
- 🚀 Shipyard (16 ship types)
- 🛸 Fleet dispatch: Attack, Transport, Colonize, Spy, Harvest
- ⚔️  Automated battle resolution
- 🗺️  Galaxy map browser
- 📨 In-game messaging system
- 🏆 Leaderboard

## Installation

### 1. Database setup
```bash
mysql -u root -p < sql/schema.sql
```

### 2. Configure database credentials
Edit `config/config.php`:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'galaxyquest');
define('DB_USER', 'your_user');
define('DB_PASS', 'your_password');
```

### 3. Web server
Point your web server document root to the project folder.

**Apache** – the included `.htaccess` handles routing.

**Nginx** example:
```nginx
server {
    root /var/www/galaxyquest;
    index index.html;

    location /api/ {
        try_files $uri $uri/ =404;
    }
}
```

### 4. PHP requirements
- PHP 8.0+
- `pdo_mysql` extension enabled

### 5. Open the game
Visit `http://your-server/` → register an account → start playing!

## Project Structure
```
/
├── index.html          # Login / register page
├── game.html           # Main game interface
├── css/
│   └── style.css       # Space-themed dark UI
├── js/
│   ├── starfield.js    # Animated star background
│   ├── auth.js         # Login/register logic
│   ├── api.js          # API client wrapper
│   └── game.js         # Game UI controller
├── api/
│   ├── helpers.php     # Shared request/response utilities
│   ├── auth.php        # Authentication endpoints
│   ├── game.php        # Overview / leaderboard
│   ├── game_engine.php # Production formulas, ship stats, constants
│   ├── buildings.php   # Building upgrade API
│   ├── research.php    # Research API
│   ├── shipyard.php    # Ship construction API
│   ├── fleet.php       # Fleet dispatch & battle resolution
│   ├── galaxy.php      # Galaxy map API
│   └── messages.php    # Messaging API
├── config/
│   ├── config.php      # Game & DB configuration
│   └── db.php          # PDO connection factory
└── sql/
    └── schema.sql      # Full database schema
```

## Game Mechanics

### Resources
Resources are produced continuously based on building levels. Each
planet tracks the last update timestamp; when queried the server
calculates how much was produced in the elapsed time.

| Resource   | Produced by        |
|------------|--------------------|
| Metal      | Metal Mine         |
| Crystal    | Crystal Mine       |
| Deuterium  | Deuterium Synthesizer |
| Energy     | Solar Plant / Fusion Reactor |

Production is throttled by available energy – if energy is negative,
mine efficiency drops proportionally.

### Buildings
All costs and build times scale with level using the OGame-style
formula: `cost = base_cost × factor^(level-1)`.

### Fleet travel
Travel time is derived from distance (coordinate-based) and the
slowest ship in the fleet:
```
travel_time = 35000 / GAME_SPEED × √(distance × 10 / speed) + 10
```

### Battle
Simplified resolution: attacker wins if their total attack exceeds
50% of the defender's total hull points. Winners loot 50% of
defender resources and destroy 30% of defender ships.
