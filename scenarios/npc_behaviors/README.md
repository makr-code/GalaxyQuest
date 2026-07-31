# NPC Behavior Scripts

Behavior Scripts are YAML-based decision trees that define how NPCs behave autonomously. They enable factions to generate quests, send messages, raid competitors, and engage in diplomacy without LLM intervention.

## Overview

**File Structure:**
```
scenarios/npc_behaviors/
├── README.md              (this file)
├── iron_fleet.yaml        (Trading faction)
├── void_collective.yaml   (Scientific faction)
└── [other factions].yaml
```

**Loading Order (at npc_faction_tick):**
1. Load behavior script from `scenarios/npc_behaviors/{faction_code}.yaml`
2. Evaluate conditions against player's standing, resources, time, etc.
3. If conditions met, randomly select an action based on probability
4. Execute action (generate quest, send message, etc.)
5. Fall back to LLM controller if behavior script returns no action

## Behavior Script Structure

```yaml
behavior: "unique_name"              # Script identifier (logging)
personality_key: "faction_type"      # Personality modifier key

conditions:                           # All must be true (AND logic)
  - type: "standing_threshold"
    comparison: ">="
    value: 5

actions:                              # Pick one based on probability
  - type: "generate_quest"
    probability: 0.7
    template: "resource_delivery"
    params: {...}

fallback: "none"                      # "none", "llm_controller", "random"
```

## Condition Types

### standing_threshold
Player faction standing vs threshold.

```yaml
- type: "standing_threshold"
  comparison: ">="  # >=, >, <=, <, ==, !=
  value: 5
  context_key: "standing"  # optional, default is "standing"
```

### time_window
Current hour must be within range.

```yaml
- type: "time_window"
  start_hour: 6    # 24-hour format
  end_hour: 22
```

### resource_threshold
Player resource (metal, crystal, credits) above/below value.

```yaml
- type: "resource_threshold"
  resource: "metal"  # metal, crystal, credits
  comparison: ">="
  value: 1000
```

### faction_count_threshold
Number of players in faction above/below threshold.

```yaml
- type: "faction_count_threshold"
  comparison: ">"
  value: 100
```

### day_of_week
Only on specific days.

```yaml
- type: "day_of_week"
  days: [1, 3, 5]  # 1=Monday, 7=Sunday
```

## Action Types

### generate_quest
Trigger quest generation from a template.

```yaml
- type: "generate_quest"
  template: "resource_delivery"      # quest template code
  probability: 0.7                   # 70% chance if selected
  condition_requires:                # optional: additional conditions
    standing_threshold: 5
  params:                            # template placeholders
    amount: 1000
    resource: "metal"
    deadline_days: 7
  reward_standing: 10                # bonus standing for completion
  personality_modifier: "aggression_x1_2"  # personality boost
```

### send_message
Send a faction message to the player.

```yaml
- type: "send_message"
  probability: 0.2
  condition_requires:
    standing_threshold: 10
  subject: "Trade Opportunity"
  message: "We have a lucrative offer..."
```

### raid
Initiate a pirate/military raid (future).

```yaml
- type: "raid"
  probability: 0.1
  target_faction: "pirates"
  difficulty_scale: 1.5
```

### diplomacy_shift
Attempt diplomatic shift (future).

```yaml
- type: "diplomacy_shift"
  probability: 0.05
  target_faction: "void_collective"
  direction: "ally"  # ally, enemy, neutral
```

### trade_offer
Generate trading opportunity (future).

```yaml
- type: "trade_offer"
  probability: 0.3
  template: "luxury_goods"
  profit_margin: 1.3
```

## Personality Modifiers

Modifiers multiply or boost action parameters based on NPC personality.

**Available modifiers:**
- `aggression_x1_5` — Increase rewards, difficulty by 50%
- `aggression_x1_2` — Increase by 20%
- `curiosity_x1_3` — Boost for research quests
- `academia_boost` — Favor scientific quests
- `trader_boost` — Favor trading quests

**Effect:**
```php
// In npc_quest_action_executor.php
$reward = $baseReward * (1 + $personalityModifier);
```

## Example Behavior Scripts

### Iron Fleet (Militaristic Trader)
File: `iron_fleet.yaml`

- Generates resource delivery quests (70% chance with standing >= 5)
- Combat patrols for standing >= 15
- Diplomatic messages for standing >= 10
- Uses "aggression" personality modifiers

### Void Collective (Scientific)
File: `void_collective.yaml`

- Exploration missions (60% chance with standing >= 5)
- Research collaboration (40% chance with standing >= 10)
- Uses "curiosity" personality modifiers

## Loading from Database

If `npc_faction_behavior_scripts` table exists, scripts can be stored in DB:

```sql
CREATE TABLE npc_faction_behavior_scripts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  faction_code VARCHAR(64),
  script_yaml LONGTEXT,
  active TINYINT,
  created_at DATETIME,
  updated_at DATETIME
);
```

Load priority:
1. File: `scenarios/npc_behaviors/{faction_code}.yaml`
2. Database: `npc_faction_behavior_scripts WHERE faction_code = ?`
3. None: Skip behavior script

## Condition Evaluation

All conditions must be `true` (AND logic) for the script to activate:

```yaml
conditions:
  - type: "standing_threshold"
    comparison: ">="
    value: 5
  - type: "time_window"
    start_hour: 6
    end_hour: 22
# Script only activates if BOTH are true
```

## Action Selection

When conditions are met, one action is randomly selected based on probability:

```yaml
actions:
  - type: "generate_quest"
    probability: 0.6  # 60% of selection
  - type: "send_message"
    probability: 0.3  # 30% of selection
  - type: "raid"
    probability: 0.1  # 10% of selection
```

Total probability: 0.6 + 0.3 + 0.1 = 1.0 (exactly 100%)

If probabilities don't sum to 1.0, the system normalizes them proportionally.

## Fallback Strategies

If conditions not met or no action selected:

- `"none"` — Do nothing, skip to default behavior (trade offers, raids, etc.)
- `"llm_controller"` — Delegate to LLM for decision
- `"random"` — Pick random action from the list

## Testing Behavior Scripts

### Unit Tests
- `tests/php/NpcBehaviorScriptTest.php` — Parser, conditions, actions
- `tests/php/NpcBehaviorScriptIntegrationTest.php` — Full workflows

### Manual Testing

In PHP:
```php
$script = new NpcBehaviorScript();
$script->parse(file_get_contents('scenarios/npc_behaviors/iron_fleet.yaml'));

$context = [
    'standing' => 10,
    'current_hour' => 14,
    'user_id' => 123,
    'faction' => 'iron_fleet'
];

if ($script->evaluateConditions($context)) {
    $action = $script->selectAction($context);
    echo "Selected action: " . $action['type'];
}
```

## Performance

- Parsing: ~1-2ms per script
- Evaluation: <1ms
- Action selection: <1ms
- Total per faction tick: <5ms

No database queries required (file-based scripts).

## Future Enhancements

- [ ] Nested conditions (OR logic)
- [ ] Time-based constraints (cooldowns, daily limits)
- [ ] Dynamic learning (faction adapts based on player behavior)
- [ ] Chained actions (execute multiple actions in sequence)
- [ ] Weighted decision history (learn preferred actions)
