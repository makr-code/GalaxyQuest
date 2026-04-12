<?php

// Central combat tuning constants.
// Guard each constant to allow safe re-includes in mixed bootstrap contexts.

if (!defined('WAR_EXHAUSTION_PASSIVE_PER_DAY')) {
    define('WAR_EXHAUSTION_PASSIVE_PER_DAY', 0.5);
}
if (!defined('WAR_EXHAUSTION_LOST_BATTLE')) {
    define('WAR_EXHAUSTION_LOST_BATTLE', 5);
}
if (!defined('WAR_EXHAUSTION_LOST_COLONY')) {
    define('WAR_EXHAUSTION_LOST_COLONY', 15);
}
if (!defined('WAR_EXHAUSTION_BLOCKADE_PER_DAY')) {
    define('WAR_EXHAUSTION_BLOCKADE_PER_DAY', 3);
}
if (!defined('WAR_EXHAUSTION_FORCED_PEACE')) {
    define('WAR_EXHAUSTION_FORCED_PEACE', 100);
}
if (!defined('WAR_SCORE_OCCUPY_PER_DAY')) {
    define('WAR_SCORE_OCCUPY_PER_DAY', 2);
}
if (!defined('WAR_COOLDOWN_TICKS')) {
    define('WAR_COOLDOWN_TICKS', 30);
}

if (!defined('TACTIC_AGGRESSIVE_DAMAGE_BONUS')) {
    define('TACTIC_AGGRESSIVE_DAMAGE_BONUS', 0.15);
}
if (!defined('TACTIC_DEFENSIVE_SHIELD_REGEN')) {
    define('TACTIC_DEFENSIVE_SHIELD_REGEN', 0.10);
}
if (!defined('TACTIC_EVASIVE_RETREAT_THRESHOLD')) {
    define('TACTIC_EVASIVE_RETREAT_THRESHOLD', 0.50);
}
if (!defined('FORMATION_WALL_SHIELD_BONUS')) {
    define('FORMATION_WALL_SHIELD_BONUS', 0.20);
}
if (!defined('FORMATION_PINCER_DAMAGE_BONUS')) {
    define('FORMATION_PINCER_DAMAGE_BONUS', 0.15);
}
if (!defined('SURPRISE_ATTACK_FREE_ROUNDS')) {
    define('SURPRISE_ATTACK_FREE_ROUNDS', 1);
}

if (!defined('BOMBARDMENT_SURGICAL_GARRISON_LOSS')) {
    define('BOMBARDMENT_SURGICAL_GARRISON_LOSS', 0.20);
}
if (!defined('BOMBARDMENT_HEAVY_FORTIF_LOSS')) {
    define('BOMBARDMENT_HEAVY_FORTIF_LOSS', 0.30);
}
if (!defined('BOMBARDMENT_CARPET_GARRISON_LOSS')) {
    define('BOMBARDMENT_CARPET_GARRISON_LOSS', 0.50);
}
if (!defined('BOMBARDMENT_CARPET_POP_LOSS')) {
    define('BOMBARDMENT_CARPET_POP_LOSS', 0.30);
}
if (!defined('BOMBARDMENT_CARPET_EXHAUSTION')) {
    define('BOMBARDMENT_CARPET_EXHAUSTION', 20);
}
if (!defined('FORTIFICATION_LVL3_DEFENSE_MULT')) {
    define('FORTIFICATION_LVL3_DEFENSE_MULT', 2.0);
}
if (!defined('FORTIFICATION_LVL4_DEFENSE_MULT')) {
    define('FORTIFICATION_LVL4_DEFENSE_MULT', 2.5);
}

if (!defined('WAR_DEFAULT_PEACE_OFFER_TTL_SECONDS')) {
    define('WAR_DEFAULT_PEACE_OFFER_TTL_SECONDS', 86400);
}

// Exhaustion level at which peace pressure begins (NPC diplomats active, player can force status quo).
if (!defined('WAR_EXHAUSTION_PRESSURE_THRESHOLD')) {
    define('WAR_EXHAUSTION_PRESSURE_THRESHOLD', 80);
}

// How long (in seconds) a recently-ended war stays visible in the active-wars list.
if (!defined('WAR_ENDED_VISIBILITY_SECONDS')) {
    define('WAR_ENDED_VISIBILITY_SECONDS', 172800); // 48 hours
}
