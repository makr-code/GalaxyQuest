# Quest Templates

This directory contains **YAML-based quest templates** that drive NPC quest generation in GalaxyQuest.

## Overview

Each template defines a reusable quest pattern with:
- **Title & Description Templates**: Parameterized text with `{placeholders}`
- **Quest Type**: `deliver`, `explore`, `combat`, `research`, `diplomacy`, etc.
- **Default Parameters**: Baseline values (amount, location, enemy_count, etc.)
- **Reward Scaling**: How rewards scale based on difficulty, amount, threat level
- **Narrative Hooks**: Immersive flavor text to inject into descriptions

## Template Files

| File | Type | Use Case |
|------|------|----------|
| `resource_delivery.yaml` | deliver | NPCs request resources (metal, crystal, etc.) |
| `exploration_mission.yaml` | explore | NPCs ask players to scout regions |
| `combat_patrol.yaml` | combat | Military factions request enemy elimination |
| `research_collaboration.yaml` | research | Science factions offer tech collaboration |
| `diplomacy_mission.yaml` | diplomacy | Trade/Peace factions request negotiations |
| `trading_chain.yaml` | deliver | Trade factions create trade route quests |

## Template Structure

```yaml
code: unique_identifier
title_template: "Text with {placeholder}"
description_template: |
  Multiline description with {placeholders}.
  Uses YAML literal block (|) for readability.
quest_type: quest_type_name
difficulty_modifier: 1.0  # 0.8 = easier, 1.2 = harder
faction_types:
  - faction_type1
  - faction_type2
default_params:
  key: value
  amount: 1000
reward_scaling:
  base_metal: 500  # Base reward if no scaling
  base_standing: 5
  multipliers:
    by_amount: 0.001      # Reward += amount * 0.001
    by_difficulty: 1.0    # Total reward *= difficulty
narrative_hooks:
  - "Story line 1 with {placeholders}"
  - "Story line 2 for variety"
```

## Placeholders

Common placeholders across templates:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `{faction_name}` | NPC faction name | "Iron Fleet" |
| `{amount}` | Quantity requested | 1000 |
| `{resource}` | Resource type | "metal", "crystal" |
| `{location}` | System/station/sector | "Outer Rim Station 7" |
| `{deadline_days}` | Time to complete | 7 |
| `{enemy_count}` | Number of enemies | 5 |
| `{enemy_type}` | Enemy class | "pirate_corvette" |
| `{threat_level}` | Danger level | "high", "medium", "low" |
| `{tech_name}` | Technology name | "Jump Drive v3" |
| `{contact_faction}` | Diplomatic target | "Aereth" |
| `{profit}` | Expected profit | 5000 |

## Reward Scaling Example

For `resource_delivery`:
```
base_metal: 500
multipliers:
  by_amount: 0.001
  by_difficulty: 1.0

# If quest asks for 2000 metal with difficulty 1.2:
# reward = 500 + (2000 * 0.001) * 1.2
#        = 500 + 2 * 1.2
#        = 502.4 metal
```

## Faction Types

Templates support these faction types:
- `trade`: Commercial factions
- `military`: Combat-focused factions
- `science`: Research factions
- `pirate`: Criminal factions
- `ancient`: Mysterious factions
- `envoy`: Diplomatic messenger factions

## Adding New Templates

1. Create `your_template_name.yaml` in this directory
2. Define all required fields (code, title_template, quest_type)
3. Register in database via migration:
   ```sql
   INSERT INTO quest_templates (code, title_template, description_template, ...)
   VALUES (...)
   ```
4. Update NPC Behavior-Scripts to reference via `quest_template: your_template_name`

## LLM Personalization

When `npc_quest_description_generator.php` processes a template:
1. Replaces `{placeholders}` with actual values
2. Optionally calls LLM to narrativize further (if enabled)
3. Caches for 48 hours
4. Falls back to static template on LLM error

## See Also

- `api/npc_quest_personalizer.php` — How templates become quests
- `api/npc_quest_description_generator.php` — LLM integration
- `api/npc_quest_reward_calculator.php` — Reward computation
