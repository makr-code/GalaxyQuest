# NPC Quest Generation System

## Overview

The NPC Quest Generation System allows NPCs to autonomously create and offer quests to players. This system integrates:

1. **Behavior-Script Framework** — YAML-based decision scripts that NPCs follow
2. **Quest Template Catalog** — Reusable, parameterized quest patterns
3. **Quest Chain Management** — Parent-child quest relationships with reward escalation
4. **LLM Integration** — Optional LLM-driven quest personalization
5. **Generation Logging** — Audit trail for all quest creation events

## Architecture

### Core Flow

```
NPC Tick (npc_ai_tick)
    ↓
Behavior-Script Evaluator (NpcBehaviorScript)
    ├─ Evaluate Conditions
    ├─ Select Action (trade_offer, raid, diplomacy_shift, generate_quest)
    └─ Apply Personality Modifiers
        ↓
    If action = "generate_quest":
        ↓
    Quest Action Executor (npc_quest_action_executor.php)
        ├─ Select Quest Template
        ├─ Personalize with Seeded-Random
        ├─ Calculate Rewards
        └─ Insert to DB + Log
            ↓
        Quest Generated & Available for Player Discovery
```

### Components

#### 1. NpcBehaviorScript (`lib/NpcBehaviorScript.php`)

Parses and evaluates YAML-based behavior scripts.

**Features:**
- Condition evaluation (standing threshold, resources, time windows)
- Action selection with probability weighting
- Personality-based modifier application
- Fallback strategies (none, random, llm)

**Usage:**
```php
$script = new NpcBehaviorScript();
$script->parse($yamlContent);

if ($script->evaluateConditions($context)) {
    $action = $script->selectAction($context, $rng);
    if ($action && $action['type'] === 'generate_quest') {
        // Execute quest generation
    }
}
```

#### 2. Quest Templates (`scenarios/quest_templates/*.yaml`)

Pre-defined quest patterns with parameterized text and rewards.

**Templates:**
- `resource_delivery.yaml` — NPC requests player deliver resources
- `exploration_mission.yaml` — Scouting / intel gathering
- `combat_patrol.yaml` — Military missions
- `research_collaboration.yaml` — Tech research partnerships
- `diplomacy_mission.yaml` — Diplomatic negotiations
- `trading_chain.yaml` — Trade route establishment

#### 3. Quest Action Executor (`api/npc_quest_action_executor.php`)

Executes generate_quest decisions by:
1. Loading quest template
2. Personalizing with player/faction context
3. Calculating rewards
4. Inserting quest to database
5. Logging generation event

**Key Functions:**
- `npc_pve_apply_quest_action()` — Main action handler
- `npc_personalize_quest_from_template()` — Customize template
- `npc_insert_generated_quest()` — Save to DB
- `npc_calculate_quest_rewards()` — Compute rewards

#### 4. Quest Chain Manager (`api/npc_quest_chain_manager.php`)

Manages quest sequences and dependencies.

**Features:**
- DAG validation (detects cycles, validates sequences)
- Sequential vs parallel chains
- Reward escalation (later quests pay more)
- Progress tracking

**Usage:**
```php
$chainResult = npc_quest_chain_create($db, [
    'code' => 'iron_fleet_rise',
    'title' => 'Rise of the Iron Fleet',
    'quest_ids' => [123, 124, 125],
    'is_sequential' => true,
    'reward_escalation' => 1.3
]);

$nextQuest = npc_quest_chain_get_next($db, $userId, $chainId);
$progress = npc_quest_chain_progress($db, $userId, $chainId);
```

#### 5. Quest Trigger Log (`api/npc_quest_trigger_log.php`)

Records every quest generation event.

**Data Captured:**
- Faction + User
- Quest ID
- Trigger reason (daily_generator, contextual_trigger, llm_decision)
- Chain context
- Timestamp

**Analytics:**
```php
$stats = npc_quest_trigger_log_stats($db, $factionId);
// Returns: reason, count, avg_chain_length per trigger type
```

## Database Schema

### faction_quests (Extended)

```sql
ALTER TABLE faction_quests ADD:
  quest_chain_parent_id INT      -- Parent quest for chains
  quest_chain_position INT       -- Position in chain (0 = first)
  generated_by_npc TINYINT       -- 1 if generated dynamically
  generated_timestamp DATETIME   -- When it was generated
  llm_prompt_context TEXT        -- LLM context used
  quest_reward_seed VARCHAR(64)  -- Seeded RNG seed
  description_source ENUM        -- static, llm, hybrid
```

### quest_templates

```sql
CREATE TABLE quest_templates (
  id INT PRIMARY KEY,
  code VARCHAR(64) UNIQUE,
  title_template VARCHAR(255),        -- "{faction_name} needs {amount} {resource}"
  description_template TEXT,          -- Multiline template
  quest_type VARCHAR(32),             -- deliver, explore, combat, etc.
  requirements_template JSON,         -- {"resource": "{resource}", "amount": "{amount}"}
  reward_template JSON,               -- {"base_metal": 500, "multipliers": {...}}
  difficulty_modifier FLOAT,          -- 0.8 (easy) to 1.3 (hard)
  faction_types_json VARCHAR(255),    -- trade,military,science
  created_at DATETIME,
  updated_at DATETIME
)
```

### npc_quest_generation_log

```sql
CREATE TABLE npc_quest_generation_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  faction_id INT,
  user_id INT,
  quest_id INT,
  trigger_reason VARCHAR(255),         -- daily_generator, contextual_trigger, npc_decision
  trigger_context_json TEXT,           -- JSON details
  chain_parent_id INT,
  chain_position INT,
  generated_at DATETIME
)
```

### quest_chain_specs

```sql
CREATE TABLE quest_chain_specs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) UNIQUE,
  title VARCHAR(255),
  faction_id INT,
  quest_ids_ordered JSON,              -- [123, 124, 125]
  is_sequential TINYINT,               -- 1 = must do in order
  reward_escalation FLOAT,             -- Each quest pays 1.3x previous
  active TINYINT
)
```

## Configuration Constants

```php
// In config/constants.php
define('NPC_QUEST_GENERATION_ENABLED', 1);
define('NPC_QUEST_LLM_NARRATIVES_ENABLED', 1);
define('NPC_QUEST_AUTO_ASSIGN_TO_PLAYER', 0);  // 0 = discovery UI, 1 = auto-assign
define('NPC_QUEST_REWARD_SEED_MODE', 'seeded');  // 'seeded' or 'random'
define('NPC_QUEST_CACHE_TTL_HOURS', 48);
define('NPC_QUEST_MAX_ACTIVE_PER_FACTION', 10);
```

## Behavior-Script Example

```yaml
behavior: "faction_daily_strategy"
personality_key: "iron_fleet_aggressive"

conditions:
  - type: "faction_standing_threshold"
    operator: ">="
    value: 10
  - type: "resource_available"
    resource: "credits"
    min_value: 1000

actions:
  - type: "generate_quest"
    quest_template: "combat_patrol"
    target_resource: null
    amount: 5
    reward_standing: 8
    duration_hours: 72
    probability: 0.6
    personality_modifier: "aggression_boost"

fallback: "none"
```

## Integration Points

### With npc_ai.php

```php
// In npc_ai_tick()
// Behavior-scripts are evaluated during faction ticks
npc_faction_tick($db, $userId, $faction);  // May call quest generator
```

### With npc_llm_controller.php

```php
// If LLM decides to generate quest:
case 'generate_quest':
    $questResult = npc_pve_apply_quest_action($db, $userId, $faction, $decision);
    // Quest is created and logged
```

## Testing

**Unit Tests:**
- `tests/php/NpcBehaviorScriptTest.php` — Script parsing, conditions, actions
- `tests/php/NpcQuestActionExecutorTest.php` — Quest personalization, rewards
- `tests/php/NpcQuestChainManagerTest.php` — Chain validation, progress

**Integration Tests:**
- Quest generation from LLM decision
- Chain completion and reward escalation
- Quest discovery UI retrieval

## Future Enhancements

1. **Phase 2:** Seeded randomness for deterministic, reproducible quests
2. **Phase 3:** Contextual triggers (event-based quest generation)
3. **Phase 4:** Offline progression and quest backscripting
4. **Phase 5:** Leader personality profiles with custom quest variants

## Performance Considerations

**Database Indexes:**
- `npc_quest_generation_log(faction_id, user_id, generated_at)`
- `quest_templates(code)`
- `faction_quests(generated_by_npc, generated_timestamp)`

**Caching:**
- Quest templates loaded once per tick
- LLM descriptions cached 48 hours
- Generation logs rotated (keep 30 days)

**Load Estimates:**
- Single quest generation: ~10ms
- Daily quest generator (all factions): ~200ms
- Full tick cycle with quests: <50ms per user
