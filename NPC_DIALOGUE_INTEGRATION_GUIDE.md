# NPC Dialogue Panel - Integration Guide

## Overview

The **NPC Dialogue Panel** is a modern, responsive component for integrating NPC conversations into the GalaxyQuest game interface. It handles messaging, caching, session management, and agent personality integration.

---

## Features

✅ **Multi-NPC Support** - Independent dialogue panels for different NPCs  
✅ **Session Management** - Persistent conversation context  
✅ **Response Caching** - Automatic caching with TTL and hit/miss tracking  
✅ **Agent Personalities** - 4 distinct agent types (commander, diplomat, merchant, scientist)  
✅ **Responsive Design** - Works on desktop, tablet, and mobile  
✅ **Real-time Indicators** - Cache status, response latency, typing indicators  
✅ **Error Handling** - Graceful fallbacks and user-friendly error messages  

---

## Installation

### 1. Add Files to Your Project

```bash
cp js/components/npc_dialogue_panel.js your-project/js/components/
cp css/npc_dialogue_panel.css your-project/css/
cp js/systems/npc_dialogue_system.js your-project/js/systems/
```

### 2. Import in HTML

```html
<!-- Stylesheets -->
<link rel="stylesheet" href="css/npc_dialogue_panel.css?v=1">

<!-- Scripts (in order) -->
<script src="js/systems/npc_dialogue_system.js"></script>
<script src="js/components/npc_dialogue_panel.js"></script>
```

---

## Basic Usage

### Simple Implementation

```html
<!-- Create a container -->
<div id="npc-panel-container"></div>

<!-- Initialize and open -->
<script>
const panel = new NPCDialoguePanel({
  containerId: 'npc-panel-container',
  npcId: 'npc_commander_01',
  npcName: 'Commander Vex',
  faction: 'Federation',
  playerId: '123',
  apiBaseUrl: '/api'
});

panel.render();
panel.open();
</script>
```

### Full Configuration

```javascript
const panel = new NPCDialoguePanel({
  // Required
  npcId: 'npc_commander_01',           // Unique NPC identifier
  npcName: 'Commander Vex',             // Display name
  faction: 'Federation',                 // Faction affiliation
  
  // Container
  containerId: 'npc-panel-container',    // HTML element ID
  
  // API
  apiBaseUrl: '/api',                   // Backend API endpoint
  
  // Behavior
  playerId: localStorage.getItem('player_id'),  // Current player ID
  autoLoadHistory: true,                // Auto-load previous messages
  maxHistoryItems: 50,                  // Max messages to keep
});
```

---

## Integration Patterns

### Pattern 1: Floating Window (Right Side)

```html
<!-- Floating panel -->
<div id="npc-panel" class="npc-panel-floating"></div>

<script>
const panel = new NPCDialoguePanel({
  containerId: 'npc-panel',
  npcId: 'npc_merchant_01',
  npcName: 'Trader Kess',
  faction: 'Neutral Traders'
});
panel.render();

// Open via button
document.getElementById('chat-btn').addEventListener('click', () => {
  panel.open();
});
</script>

<style>
.npc-panel-floating {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 380px;
  z-index: 9000;
}
</style>
```

### Pattern 2: Embedded in UI Panel

```html
<!-- Part of existing game panel -->
<div class="game-panel">
  <div class="panel-tabs">
    <button class="tab active">Info</button>
    <button class="tab">Dialogue</button>
  </div>

  <div class="tab-content">
    <!-- Dialogue panel embedded -->
    <div id="npc-dialogue-panel" style="height: 600px;"></div>
  </div>
</div>

<script>
const panel = new NPCDialoguePanel({
  containerId: 'npc-dialogue-panel',
  npcId: npcIdFromGameState,
  npcName: npcNameFromGameState,
  faction: currentFactionFromGameState,
  autoLoadHistory: true
});
panel.render();
panel.open(gameContext);
</script>
```

### Pattern 3: Modal Dialog

```html
<div id="dialogue-modal" class="modal">
  <div class="modal-content" style="width: 600px;">
    <div id="npc-panel-modal"></div>
  </div>
</div>

<script>
function showNPCDialogue(npcId, npcName, faction) {
  const modal = document.getElementById('dialogue-modal');
  const panel = new NPCDialoguePanel({
    containerId: 'npc-panel-modal',
    npcId, npcName, faction
  });
  
  panel.render();
  panel.open();
  modal.classList.add('active');

  // Close modal on panel close
  const originalClose = panel.close.bind(panel);
  panel.close = () => {
    originalClose();
    modal.classList.remove('active');
  };
}
</script>
```

---

## API Reference

### Constructor

```javascript
new NPCDialoguePanel(options: Object)
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `containerId` | string | 'npc-dialogue-panel' | HTML container element ID |
| `npcId` | string | 'npc_unknown' | Unique NPC identifier |
| `npcName` | string | 'Unknown NPC' | Display name |
| `faction` | string | 'Neutral' | Faction name |
| `playerId` | string | localStorage.player_id | Current player ID |
| `apiBaseUrl` | string | '/api' | Backend API base URL |
| `autoLoadHistory` | boolean | true | Auto-load conversation history |
| `maxHistoryItems` | number | 50 | Max messages to keep |

### Methods

#### `render() → HTMLElement`
Render the panel (called automatically via `setupElements`).

#### `open(gameContext?: Object) → Promise<void>`
Open the dialogue panel.

```javascript
panel.open({
  faction: 'Federation',
  tech_level: 7,
  relations: { 'Xylothian': -0.3 }
});
```

#### `close() → void`
Close the dialogue panel.

```javascript
panel.close();
```

#### `sendMessage(text: string) → Promise<void>`
Send a message manually (usually called via UI).

```javascript
await panel.sendMessage("Tell me about your faction.");
```

#### `addMessage(role: string, content: string, metadata?: Object) → void`
Add a message to the conversation.

```javascript
panel.addMessage('user', 'Hello!');
panel.addMessage('assistant', 'Greetings, commander.', { latency: 342 });
```

#### `loadHistory() → Promise<void>`
Load conversation history from server.

```javascript
await panel.loadHistory();
```

#### `loadAgentInfo() → Promise<void>`
Load NPC agent personality info.

```javascript
await panel.loadAgentInfo();
```

#### `destroy() → void`
Clean up and remove the panel.

```javascript
panel.destroy();
```

### Properties

```javascript
panel.state = {
  isOpen: boolean,              // Panel is currently open
  isLoading: boolean,           // Response is being generated
  messages: Array,              // Conversation messages
  sessionId: string | null,     // Current session ID
  agentInfo: Object | null,     // NPC agent configuration
  cacheStats: {                 // Cache hit/miss tracking
    hits: number,
    misses: number
  },
  error: string | null          // Last error message
};

panel.options = {               // Configuration options
  // ... all constructor options
};
```

---

## Backend Integration

### API Endpoints Required

The component expects the following API endpoints:

#### `POST /api/npc_chat_integration.php`

**Action: `chat`**
```json
{
  "action": "chat",
  "npc_id": "npc_commander_01",
  "user_id": 123,
  "message": "What is your mission?",
  "game_context": {
    "faction": "Federation",
    "tech_level": 7
  }
}
```

**Response:**
```json
{
  "ok": true,
  "response": "Our mission is to...",
  "session_id": "user_123_npc_xxx",
  "latency_ms": 342,
  "from_cache": false
}
```

#### `POST /api/npc_chat_integration.php?action=history`

**Request:**
```json
{
  "action": "history",
  "user_id": 123,
  "npc_id": "npc_commander_01"
}
```

**Response:**
```json
[
  { "role": "user", "content": "Hello", "timestamp": 1692345600 },
  { "role": "assistant", "content": "Greetings", "timestamp": 1692345610 }
]
```

---

## Styling Customization

### CSS Variables

Override default colors:

```css
.npc-dialogue-container {
  --npc-primary: #4fbf73;           /* Primary accent color */
  --npc-secondary: #2a5f4a;         /* Secondary color */
  --npc-bg: rgba(10, 25, 45, 0.95); /* Background */
  --npc-border: rgba(79, 191, 115, 0.3); /* Border color */
  --npc-text: #e8f4f8;              /* Text color */
  --npc-text-muted: #a8c5d1;        /* Muted text */
}
```

### Custom Themes

```css
/* Dark Mode */
@media (prefers-color-scheme: dark) {
  .npc-dialogue-container {
    --npc-bg: rgba(5, 15, 30, 0.98);
    --npc-text: #f0f8ff;
  }
}

/* High Contrast */
.npc-dialogue-container.high-contrast {
  --npc-border: rgba(79, 191, 115, 0.8);
  --npc-text: #ffffff;
  --npc-bg: rgba(0, 0, 0, 1);
}
```

---

## Performance Considerations

### Caching Strategy

The component leverages multiple caching layers:

1. **Response Cache** - Backend caches Ollama responses
2. **Session Cache** - Player-NPC conversation history
3. **Local Cache** - Browser stores recent responses (via NpcDialogueSystem)

```javascript
// Cache hit ratio monitoring
if (response.from_cache) {
  console.log('✅ Served from cache:', response.latency_ms, 'ms');
} else {
  console.log('🔄 Generated fresh:', response.latency_ms, 'ms');
}
```

### Optimization Tips

1. **Lazy Load Panels** - Only create panels for visible NPCs
2. **Limit History** - Keep `maxHistoryItems` reasonable (default: 50)
3. **Debounce Input** - Throttle typing indicators
4. **Virtual Scrolling** - For very long conversations (200+ messages)

```javascript
// Example: Lazy load on hover
element.addEventListener('mouseenter', () => {
  if (!panel) {
    panel = new NPCDialoguePanel({ /* config */ });
    panel.render();
  }
});
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Container not found" | HTML element missing | Verify `containerId` exists |
| "Failed to generate response" | API unreachable | Check `/api` endpoint |
| "No agent info" | Agent type unknown | Add agent to `config/npc_agents.yaml` |
| "Session expired" | TTL exceeded | Reload history or start new session |

### Error Recovery

```javascript
panel.on('error', (error) => {
  console.error('Dialogue error:', error);
  
  // Fallback to cached response
  const lastMessage = panel.state.messages[panel.state.messages.length - 1];
  
  // Retry with exponential backoff
  setTimeout(() => panel.sendMessage(lastMessage.content), 1000);
});
```

---

## Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ⚠️ IE 11 (not supported)

---

## Testing

### Unit Tests

```bash
docker compose exec -T web php tests/NpcChatIntegrationTests.php
```

### E2E Tests (Playwright)

```bash
npx playwright test npc_dialogue_test
```

### Manual Testing

```bash
# Open test page
open http://localhost:8080/npc_dialogue_test.html
```

---

## Troubleshooting

### Panel doesn't open
```javascript
// Check state
console.log(panel.state.isOpen);

// Force render
panel.setupElements();
panel.open();
```

### Messages not persisting
```javascript
// Verify backend session table
docker compose exec -T db mysql galaxyquest \
  -e "SELECT * FROM npc_chat_sessions LIMIT 1;"
```

### Slow responses
```javascript
// Check cache stats
console.log(panel.state.cacheStats);

// Enable cache debug logging
localStorage.setItem('debug_npc_cache', 'true');
```

---

## Support & Resources

- **Documentation**: See [FINAL_AI_SYSTEM_STATUS.md](./FINAL_AI_SYSTEM_STATUS.md)
- **Test Page**: [npc_dialogue_test.html](./npc_dialogue_test.html)
- **Backend Tests**: `tests/NpcChatIntegrationTests.php`
- **API Endpoint**: `/api/npc_chat_integration.php`

---

## Changelog

### v1.0.0 (2026-08-01)
- ✅ Initial release
- ✅ All 67 backend tests passing
- ✅ Multi-tenant session support
- ✅ Response caching layer
- ✅ 4 agent personality types
- ✅ Responsive UI component
