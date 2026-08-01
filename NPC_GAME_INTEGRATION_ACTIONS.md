# NPC Game Integration - Actions & Consequences

## Overview

NPCs können jetzt Spielerfunktionen durch ihre Antworten direkt beeinflussen:
- Ressourcen/Credits gewähren
- Produktion anpassen
- Gebäude bauen
- Forschung vorantreiben
- Diplomatische Beziehungen ändern
- Spielereignisse auslösen

---

## Action Types & Syntax

### 1. Grant Credits
**Format:** `[grant_credits:AMOUNT]`  
**Constraint:** Max 100,000 pro Action, Max 300,000 pro Tag  
**Example:**
```
"Excellent work! Here's 50,000 credits [grant_credits:50000]"
```

### 2. Grant Resources
**Format:** `[grant_resources:RESOURCE1=AMOUNT,RESOURCE2=AMOUNT,...]`  
**Constraint:** Max 10,000 pro Ressource, Max 50,000 pro Tag pro Ressource  
**Example:**
```
"Accept this trade [grant_resources:food=1000,energy=500,minerals=250]"
```
**Valid Resources:** food, energy, minerals, water, credits, military_supplies

### 3. Modify Production
**Format:** `[modify_production:colony_id=ID,building_type=TYPE,multiplier=VALUE]`  
**Constraint:** Multiplier 0.5 - 1.5 (50%-150%)  
**Example:**
```
"I'll help optimize your farming [modify_production:colony_id=1,building_type=farm,multiplier=1.2]"
```

### 4. Adjust Standing (Diplomacy)
**Format:** `[adjust_standing:CHANGE]`  
**Constraint:** Max ±10 pro Action, Max ±20 pro Tag  
**Example:**
```
"This agreement strengthens our alliance! [adjust_standing:+5]"
```

### 5. Add Research Points
**Format:** `[add_research:POINTS]` or `[add_research:POINTS,tech_key=TECH]`  
**Constraint:** Max 5,000 pro Action, Max 10,000 pro Tag  
**Example:**
```
"Here's a research breakthrough [add_research:2000,tech_key=advanced_weaponry]"
```

### 6. Trigger Event
**Format:** `[trigger_event:EVENT_TYPE]`  
**Example:**
```
"This opens up a new opportunity [trigger_event:trade_opportunity]"
```
**Valid Event Types:**
- trade_opportunity
- military_threat
- diplomatic_incident
- colony_distress
- discovery

### 7. Build Building
**Format:** `[build_building:colony_id=ID,building_type=TYPE,level=LEVEL]`  
**Constraint:** Max 3 pro Tag pro Faction  
**Example:**
```
"I can help you build a research station [build_building:colony_id=1,building_type=research_lab,level=1]"
```

### 8. Unlock Technology
**Format:** `[unlock_tech:TECH_KEY]`  
**Constraint:** Max 1 pro Tag  
**Example:**
```
"This should accelerate your tech [unlock_tech:stellar_engineering]"
```

---

## Implicit Actions

NPCs können auch implicit Aktionen basierend auf ihrer Persönlichkeit und dem Inhalt ihrer Response auslösen:

### Merchant/Trader
- Keywords: "discount", "trade", "offer", "deal"
- → Grant small resources (1,000-5,000 credits)

### Diplomat
- Keywords: "alliance", "friend", "peace", "respect"  
- → Adjust standing positively (+1 to +5)

### Scientist
- Keywords: "discover", "research", "technology", "innovation"
- → Add research points (100-1,000)

### Commander/Military
- Keywords: "support", "military", "fleet", "defense"
- → Grant military supplies (500-2,000)

---

## API Integration

### Browser-Side Usage

```javascript
// Enhanced NPC API call with game consequences
const response = await fetch('/api/npc_chat_integration.php', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': getCsrfToken()
  },
  body: JSON.stringify({
    action: 'chat_with_consequences',
    npc_id: 'npc_commander_01',
    npc_name: 'Commander Vex',
    faction: 'Federation',
    message: 'Can you help me with military supplies?',
    game_context: {
      player_faction: 'Federation',
      colony_id: 1,
      standing: 50
    }
  })
});

const data = await response.json();

// Handle response
if (data.ok) {
  // Display NPC message
  displayNpcResponse(data.response);
  
  // Show executed actions
  data.actions.forEach(action => {
    if (action.ok) {
      showNotification(action.message, 'success');
    }
  });
  
  // Update game state based on game_changes
  if (data.game_changes.credits_gained > 0) {
    updatePlayerCredits(data.game_changes.credits_gained);
  }
  
  // Handle standing changes
  Object.entries(data.game_changes.standing_changes).forEach(([faction, change]) => {
    updateFactionStanding(faction, change);
  });
  
  // Trigger events
  data.game_changes.events_triggered.forEach(event => {
    triggerGameEvent(event);
  });
}
```

### Server-Side Usage (PHP)

```php
require_once __DIR__ . '/api/llm_soc/NpcGameIntegration.php';

// Create integration instance
$game_integration = new NpcGameIntegration($db, $gameEngine, $logger);

// Parse actions from NPC response
$actions = $game_integration->parseActionsFromResponse(
  $npc_id,
  $faction,
  $user_id,
  $npc_response_text
);

// Execute actions with validation
foreach ($actions as $action) {
  $result = $game_integration->executeAction(
    $user_id,
    $npc_id,
    $faction,
    $action
  );
  
  if ($result['ok']) {
    // Action succeeded
    log_action($result);
  } else {
    // Action failed
    log_error($result['reason']);
  }
}
```

---

## Security & Constraints

### Rate Limiting
- Max 3 major actions per NPC per day
- Tracked by (user_id, npc_id, action_type)
- Per-action type daily limits enforced

### Amount Constraints
Each action type has maximum amounts:
```
grant_credits:       100,000 max per action, 300,000 per day
grant_resources:     10,000 max per resource, 50,000 per day
adjust_standing:     ±10 per action, ±20 per day
add_research:        5,000 per action, 10,000 per day
```

### Faction-Based Access Control
- Commander NPCs can't grant diplomat resources
- Merchant NPCs have lower grant limits
- Evil factions can't grant positive standing

### Audit Logging
All actions are logged in `npc_action_log`:
```
npc_action_log {
  user_id, npc_id, faction_code, action_type,
  action_params (JSON), result (JSON), created_at
}
```

---

## Response Format Examples

### Simple Response (No Actions)
```json
{
  "ok": true,
  "response": "I cannot help you at this time.",
  "actions": [],
  "game_changes": {
    "credits_gained": 0,
    "standing_changes": {},
    "resources_gained": {},
    "events_triggered": []
  }
}
```

### Complex Response (Multiple Actions)
```json
{
  "ok": true,
  "response": "Excellent! [grant_credits:50000] I'm impressed with your progress, strengthening our bond [adjust_standing:+5]. Here's additional support [grant_resources:military_supplies=1000]",
  "session_id": "sess_abc123",
  "latency_ms": 245,
  "from_cache": false,
  "actions": [
    {
      "type": "grant_credits",
      "amount": 50000,
      "ok": true,
      "message": "Received 50000 credits from NPC"
    },
    {
      "type": "adjust_standing",
      "change": 5,
      "ok": true,
      "message": "Faction standing improved: +5"
    },
    {
      "type": "grant_resources",
      "resources": {"military_supplies": 1000},
      "ok": true,
      "message": "Received military supplies"
    }
  ],
  "game_changes": {
    "credits_gained": 50000,
    "standing_changes": {"Federation": 5},
    "resources_gained": {"military_supplies": 1000},
    "events_triggered": []
  }
}
```

---

## NPC Personality Effects

### Commander Vex (Federation)
- Personality: Military, direct, supportive
- Actions: grant_credits, modify_production (military), grant_resources (weapons)
- Implicit: Provides military support keywords

### Envoy Salix (Empire)
- Personality: Diplomatic, elegant, political  
- Actions: adjust_standing, grant_credits, trigger_event
- Implicit: Alliance and friendship keywords

### Trader Kess (Neutral)
- Personality: Commercial, shrewd, helpful
- Actions: grant_resources, grant_credits
- Implicit: Trade and deal keywords

### Dr. Lythe (Federation)
- Personality: Academic, enthusiastic, innovative
- Actions: add_research, unlock_tech, trigger_event
- Implicit: Discovery and research keywords

---

## Testing & Debugging

### Enable Debug Logging
```javascript
window.GQNpcInteractionHandler.options.debug = true;
```

### Check Action Logs
```sql
SELECT * FROM npc_action_log 
WHERE user_id = ? 
ORDER BY created_at DESC 
LIMIT 20;
```

### Simulate Action Parsing
```php
$game_integration = new NpcGameIntegration($db, null, null);
$actions = $game_integration->parseActionsFromResponse(
  'npc_test',
  'Federation',
  1,
  'Test [grant_credits:5000] message [adjust_standing:+2]'
);
print_r($actions);
```

---

## Future Enhancements

Geplante Erweiterungen:
- [ ] Multi-step quests (komplexe Handlungsfolgen)
- [ ] Consequential dialogue (Entscheidungen beeinflussen Zukunft)
- [ ] NPC Relationen (NPCs können sich erinnern)
- [ ] Faction politics (NPCs beeinflussen sich gegenseitig)
- [ ] Trade contracts (Verträge über Zeit)
- [ ] Military alliances (Militärbündnisse)

---

## Troubleshooting

**Q: Aktionen werden nicht ausgeführt**
A: Prüfen Sie:
1. CSRF Token ist gesetzt
2. Nutzer authentifiziert
3. Aktionssyntax korrekt
4. Rate limiting nicht überschritten

**Q: Constraints zu streng**
A: Im Code anpassen:
```php
private $actionConstraints = [
  self::ACTION_GRANT_CREDITS => ['max' => 100000, ...],
  // ... erhöhen Sie die Werte hier
];
```

**Q: Keine Meldung von ausgeführten Aktionen**
A: Überprüfen Sie die `game_changes` in der Response
