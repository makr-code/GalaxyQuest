# Game Guide NPC - Intelligenter Tutorial-Assistent

## Übersicht

Der **GameGuide NPC** (Advisor Tau) ist ein intelligenter Onboarding-Assistent, der:
- ✅ Neue Spieler durch das Spiel führt
- ✅ Kontextuelle Tipps bei Problemen gibt
- ✅ Spielfortschritt trackt
- ✅ Direkte Hilfe anbieten kann (Ressourcen, Technologie, etc.)
- ✅ Adaptive Hinweise basierend auf Spieler-Level

---

## Features

### 1. Intelligente Problemerkennung
Der Guide erkennt automatisch:
- 🚨 **Kritische Probleme**: Hungersnot, Pleite, Militärbedrohung
- ⚠️ **Warnungen**: Niedrige Produktion, fehlende Forschung, unterentwickelte Kolonie
- 💡 **Empfehlungen**: Optimierungstipps basierend auf Spielzustand

### 2. 9 Hilfekategorien
```
- getting_started          (Erste Schritte)
- resources_and_production (Ressourcen & Produktion)
- military_and_fleets      (Militär & Flotten)
- diplomacy_and_factions   (Diplomatie & Fraktionen)
- technology_and_research  (Technologie & Forschung)
- colonization             (Kolonisierung)
- market_and_trading       (Markt & Handel)
- events_and_quests        (Events & Quests)
- troubleshooting          (Probleme & Lösungen)
```

### 3. Tutorial Checkpoints
Automatisches Tracking von Fortschritt:
- Beginner Basics (erste Kolonie, Gebäude, Handel)
- Early Game (Technologie, Fleet, Diplomatie)
- Mid Game (Mehrere Kolonien, Produktionsketten)
- Advanced (Optimierung, Mastery, Dominanz)

### 4. Direkte Hilfe
Der Guide kann dem Spieler direkt helfen:
- Startressourcen für Anfänger
- Forschungs-Boost
- Notfall-Credits bei Pleite
- Gebäude für Schnellstart
- Technologie freischalten

---

## Backend-Architektur

### GameGuideNPC Klasse
```php
class GameGuideNPC {
    // Kern-Methoden
    public function getGreeting(int $user_id, array $player_data): array
    public function assessGameState(int $user_id, array $game_state): array
    public function getHelpTopic(string $category): array
    public function provideDirectHelp(int $user_id, string $help_type, array $game_state): array
    public function recordCheckpointCompletion(int $user_id, string $checkpoint): void
    public function getTutorialProgress(int $user_id): array
}
```

### Datenbankschema

**game_guide_state**
```
- user_id (PK)
- player_level, is_new_player
- time_played_hours
- current_issue_critical
- last_assessment_at
```

**game_guide_progress**
```
- id (PK)
- user_id, checkpoint_id (UNIQUE)
- completed_at
```

**game_guide_interactions**
```
- id (PK)
- user_id, interaction_type
- topic_category, question_asked
- guide_response, player_feedback
- created_at
```

---

## API Endpoints

### 1. GET `/api/game_guide.php?action=greeting`
**Beschreibung**: Initiales Greeting und Spieler-Assessment

**Response**:
```json
{
  "ok": true,
  "greeting": "Hallo! Ich bin Advisor Tau...",
  "player_level": 1,
  "is_new_player": true
}
```

### 2. POST `/api/game_guide.php?action=assess_game_state`
**Beschreibung**: Bewertet Spielzustand und gibt Empfehlungen

**Request**:
```json
{
  "game_state": {
    "resources": {"food": 100, "energy": 50},
    "production": {"food": 5},
    "population": 50,
    "colony_count": 1,
    "fleet_strength": 0,
    "technologies_researched": 0,
    "time_played_hours": 1.5
  }
}
```

**Response**:
```json
{
  "ok": true,
  "critical_issues": [
    {
      "type": "starvation_risk",
      "severity": "critical",
      "message": "Deine Bevölkerung hungert!"
    }
  ],
  "warnings": [],
  "tips": [
    {
      "type": "tip",
      "text": "Baue mehr Farmen...",
      "priority": "high"
    }
  ]
}
```

### 3. GET `/api/game_guide.php?action=help_topic&category=CATEGORY`
**Beschreibung**: Holt Hilfe zu einer spezifischen Kategorie

**Response**:
```json
{
  "ok": true,
  "category": "resources_and_production",
  "title": "Ressourcen & Produktion",
  "questions": [
    "Wie produziere ich Ressourcen?",
    "Welche Ressourcen brauche ich?"
  ],
  "tips": [
    "Jedes Produktionsgebäude hat eine Rate...",
    "Die Bevölkerung konsumiert Ressourcen..."
  ]
}
```

### 4. POST `/api/game_guide.php?action=provide_help`
**Beschreibung**: Bitte um direkte Hilfe (Ressourcen, Tech, Credits)

**Request**:
```json
{
  "help_type": "grant_starting_resources",
  "game_state": {...}
}
```

**Response**:
```json
{
  "ok": true,
  "action": {
    "type": "grant_resources",
    "resources": {"food": 500, "energy": 300},
    "message": "Starting resources..."
  }
}
```

### 5. POST `/api/game_guide.php?action=record_checkpoint`
**Beschreibung**: Trackt abgeschlossene Tutorial-Punkte

**Request**:
```json
{
  "checkpoint": "first_colony_created"
}
```

### 6. GET `/api/game_guide.php?action=get_progress`
**Beschreibung**: Holt Spieler-Tutorialprogress

**Response**:
```json
{
  "ok": true,
  "checkpoint_count": 3,
  "progress": [
    {
      "checkpoint_id": "first_colony_created",
      "completed_at": "2026-08-01 14:30:00"
    }
  ]
}
```

---

## Frontend-Nutzung

### Initialisierung
```javascript
// Auto-initialized with window.gameGuide
const guide = window.gameGuide;

// Oder manuell
const guide = new GameGuideSystem({
  userId: 123,
  apiBaseUrl: '/api',
  debug: true
});
```

### Greeting anzeigen
```javascript
const greeting = await guide.getGreeting();
console.log(greeting.greeting);
// → "Hallo! Ich bin Advisor Tau..."
```

### Spielzustand bewerten
```javascript
const assessment = await guide.assessGameState({
  resources: {food: 100, energy: 50},
  production: {food: 5},
  population: 50,
  colony_count: 1,
  fleet_strength: 0,
  technologies_researched: 0,
  time_played_hours: 1.5
});

// Formatierte Anzeige
const display = guide.formatAssessmentForDisplay(assessment);
```

### Hilfe-Topics laden
```javascript
const topic = await guide.getHelpTopic('resources_and_production');
// → {title, questions[], tips[]}

// Alle Kategorien
guide.getHelpCategories();
```

### Direkte Hilfe anfragen
```javascript
const help = await guide.requestDirectHelp(
  'grant_starting_resources',
  gameState
);

if (help.ok) {
  // Aktionen anwenden
  applyAction(help.action);
}
```

### Tutorial-Checkpoints tracken
```javascript
// Checkpoint aufzeichnen
await guide.recordCheckpoint('first_colony_created');

// Fortschritt abfragen
const progress = await guide.getProgress();
console.log(`${progress.checkpoint_count} checkpoints completed`);
```

---

## UI-Integration

### Beispiel: Guide-Panel in Spiel-UI
```html
<div id="game-guide-panel" class="guide-panel">
  <div class="guide-header">
    <span class="guide-name">Advisor Tau</span>
    <button class="close-btn">×</button>
  </div>
  
  <div class="guide-content">
    <div id="greeting" class="guide-greeting"></div>
    <div id="assessment" class="guide-assessment"></div>
    <div id="tips" class="guide-tips"></div>
  </div>
  
  <div class="guide-footer">
    <button id="help-btn">Hilf mir!</button>
    <select id="help-category">
      <option>Wähle Hilfethema...</option>
      <option value="getting_started">Erste Schritte</option>
      <option value="resources_and_production">Ressourcen</option>
    </select>
  </div>
</div>
```

### JavaScript-Integration
```javascript
document.getElementById('help-btn').addEventListener('click', async () => {
  const result = await window.gameGuide.getGreeting();
  document.getElementById('greeting').innerHTML = result.greeting;
});

document.getElementById('help-category').addEventListener('change', async (e) => {
  const topic = await window.gameGuide.getHelpTopic(e.target.value);
  document.getElementById('tips').innerHTML = topic.tips.join('<br>');
});
```

---

## Konfiguration

### config/npc_game_guide.yaml

Die YAML-Datei definiert:

**Persönlichkeit**
```yaml
guide_agent:
  name: "Advisor Tau"
  system_prompt: |
    Du bist Advisor Tau, der Lehr- und Ratgeber-NPC...
  personality:
    tone: "patient_educator"
    supportiveness: "high"
```

**Hilfethemen** (9 Kategorien mit Fragen & Tipps)
```yaml
help_topics:
  getting_started:
    title: "Erste Schritte"
    questions: [...]
    tips: [...]
  resources_and_production:
    ...
```

**Tutorial Checkpoints**
```yaml
tutorial_checkpoints:
  beginner_basics:
    - "Create first colony"
    - "Build first building"
    - "Produce first resource"
```

**Direkte Hilfe**
```yaml
direct_help:
  enabled: true
  max_per_session: 5
  available_actions:
    - "grant_starting_resources"
    - "grant_research_points"
    - "grant_credits_emergency"
```

---

## Datenbankmigrationen

### Ausführen
```bash
# Migration ausführen
docker compose exec -T db mysql < sql/migrate_game_guide_npc_v1.sql

# Tabellen verifizieren
docker compose exec -T db mysql -e "
  SHOW TABLES LIKE 'game_guide%';
  DESC game_guide_state;
  DESC game_guide_progress;
"
```

---

## Tests

### Tests ausführen
```bash
# Unit Tests
php vendor/bin/phpunit tests/GameGuideNPCTests.php

# Spezifischer Test
php vendor/bin/phpunit tests/GameGuideNPCTests.php --filter testNewPlayerGreeting

# Mit Verbosity
php vendor/bin/phpunit tests/GameGuideNPCTests.php -v
```

### Test-Coverage
- ✅ Greeting (new & returning players)
- ✅ Game state assessment
- ✅ Resource/production/military/research checks
- ✅ Help topic retrieval
- ✅ Direct help actions
- ✅ Checkpoint tracking
- ✅ Configuration loading

---

## Best Practices

### 1. **Regelmäßig Assessments laufen lassen**
```javascript
// Alle 60 Sekunden Assessment
setInterval(async () => {
  const assessment = await gameGuide.assessGameState(getCurrentGameState());
  if (assessment.critical_issues.length > 0) {
    showAlert(assessment.critical_issues[0].message);
  }
}, 60000);
```

### 2. **Checkpoints nach Meilensteinen aufzeichnen**
```javascript
// Nach wichtigen Events
game.on('colony-created', () => {
  gameGuide.recordCheckpoint('first_colony_created');
});

game.on('research-completed', () => {
  gameGuide.recordCheckpoint('first_research_completed');
});
```

### 3. **Hilfe kontextabhängig anbieten**
```javascript
// Wenn kritische Probleme erkannt
if (assessment.critical_issues.length > 0) {
  const issue = assessment.critical_issues[0];
  
  // Automatisches Angebot
  showGuideOffer(
    "Ich kann dir helfen! Soll ich " + issue.message + "?",
    async () => {
      await gameGuide.requestDirectHelp(helpType, gameState);
    }
  );
}
```

### 4. **Progressive Hilfe für neue Spieler**
```javascript
// Weniger Hilfe im Verlauf
const progress = await gameGuide.getProgress();
const isNewer = progress.checkpoint_count < 10;

if (isNewer) {
  // Mehr proaktive Tipps für sehr neue Spieler
} else {
  // Weniger aufdringliche Hilfe
}
```

---

## Fehlerbehebung

**Q: Tabellen sind nicht erstellt**
A: Führen Sie die Migration aus:
```bash
docker compose exec -T db mysql < sql/migrate_game_guide_npc_v1.sql
```

**Q: Greeting wird nicht angezeigt**
A: Prüfen Sie:
1. `window.gameGuide` ist initialisiert
2. CSRF-Token vorhanden
3. Benutzer authentifiziert

**Q: Assessment liefert "null" zurück**
A: Sicherstellen, dass `game_state` Parameter alle erforderlichen Felder hat

**Q: Checkpoints werden nicht gespeichert**
A: Prüfen Sie Datenbankverbindung und `game_guide_progress` Tabelle

---

## Roadmap

- [ ] Multiplayer-aware Tipps (andere Spieler ähnlich schwach)
- [ ] ML-basierte Personalisierung (lernt Spieler-Stil)
- [ ] Voice-Guide (Integration mit xTTS)
- [ ] Achievement-Hints
- [ ] Community-Tipps (beste Strategien anderer Spieler)
- [ ] Video-Tutorials (eingebettet in Guide)
- [ ] Adaptive Difficulty-Empfehlungen

---

## Support & Fragen

Für Fragen zur GameGuide NPC Integration siehe:
- `NPC_DIALOGUE_INTEGRATION_GUIDE.md` - NPC-Dialogsystem
- `NPC_GAME_INTEGRATION_ACTIONS.md` - Game Actions
- `API_NPC_GAME_INTEGRATION_GUIDE.md` - API-Integration
